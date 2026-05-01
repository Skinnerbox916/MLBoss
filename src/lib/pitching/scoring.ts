/**
 * Per-category pitcher streaming rating.
 *
 * Mirrors [src/lib/mlb/batterRating.ts](../mlb/batterRating.ts). For each
 * pitcher fantasy category the league scores (QS / K / W / ERA / WHIP)
 * we build a 0–1 sub-score driven by the inputs that actually move that
 * category, weight each sub-score by the user's chase/punt focus map,
 * and multiply the composite by global matchup multipliers (velocity
 * trend, platoon vulnerability).
 *
 * Design goals (see plan `streaming_80_20_plus_savant`):
 *   1. Sub-scores are causally motivated. The K sub-score actually moves
 *      when K-driving inputs change; the QS sub-score does not.
 *   2. Talent resolution is hierarchical: blended Run Value per 100
 *      (Savant pitch-model proxy) when available → component xwOBA-a
 *      from `talentModel.ts` → tier fallback → neutral.
 *   3. Velocity year-over-year trend is a GLOBAL multiplier — a velocity
 *      drop typically signals fatigue/injury that drags every category,
 *      so we don't want to hide it inside a single cat sub-score.
 *   4. Back-compat: the legacy `overallScore` + `computeBreakdown` +
 *      `getStreamPills` exports still work. `overallScore` with no
 *      `scoredCategories` / empty `focusMap` degrades to even weights
 *      across the five pitcher cats.
 */

import { getWeatherScore } from '@/lib/mlb/analysis';
import { pitcherTalentScore } from '@/lib/pitching/quality';
import type { ProbablePitcher, ParkData, PitcherTier, GameWeather, MLBGame } from '@/lib/mlb/types';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Yahoo stat_ids for the five streaming-relevant pitcher categories. */
export const PITCHER_CATEGORY_STAT_IDS = {
  QS: 83,
  K: 42,
  W: 28,
  ERA: 26,
  WHIP: 27,
} as const;

export type StreamGoal = keyof typeof PITCHER_CATEGORY_STAT_IDS;

const STAT_ID_TO_GOAL: Record<number, StreamGoal> = {
  83: 'QS',
  42: 'K',
  28: 'W',
  26: 'ERA',
  27: 'WHIP',
};

export interface StreamPill {
  goal: StreamGoal;
  verdict: 'strong' | 'weak';
}

export interface ScoreComponent {
  label: string;
  detail: string;
  val: number;    // 0-1 sub-score (higher = better for the pitcher)
  weight: number; // contribution weight (sum = 1.0 across rendered components)
  /** Optional: overrides the auto-computed left-column label. Used for
   *  non-±% multipliers (e.g. Experience ×45%) where the default
   *  weight-pct / velocity-pct formulas would mislead. */
  labelOverride?: string;
}

export interface ScoredBreakdown {
  total: number;
  components: ScoreComponent[];
}

/** Shared input bag — same shape as the legacy `PillInput` plus (optional)
 *  scored categories + focus map for the new per-category rating. */
export interface PillInput {
  pp: ProbablePitcher;
  oppOffense: TeamOffense | null;
  park: ParkData | null;
  weather: GameWeather;
  isHome: boolean;
  game: MLBGame;
  /** Optional: league-scored pitcher categories (to restrict & weight the
   *  composite). When omitted, getPitcherRating assumes all five default
   *  pitcher cats are scored with even weights. */
  scoredCategories?: EnrichedLeagueStatCategory[];
  /** Optional: chase/punt focus per stat_id. Missing ids default to
   *  'neutral'. Only consulted when `scoredCategories` is present. */
  focusMap?: Record<number, Focus>;
}

export interface PitcherCategoryContribution {
  statId: number;
  goal: StreamGoal;
  label: string;
  /** 0-1 where 1 = best possible for this category. */
  subScore: number;
  weight: number;
  contribution: number; // weight * (subScore - 0.5)
  focus: Focus;
  /** Short display like ".295 BAA · 5.8 IP/GS". */
  detail: string;
}

export interface PitcherRatingMultiplier {
  multiplier: number;    // e.g. 1.035 for +3.5%
  deltaPct: number;      // multiplier - 1, in percent (+3.5)
  display: string;       // e.g. "+1.2 mph", "vs LHP"
  summary: string;       // e.g. "Velo trending up"
  available: boolean;
}

/**
 * Data-credibility multiplier. Unlike velocity / platoon this is a
 * downweight-only signal (0-1, never above 1) reflecting how much
 * background we have on the pitcher. Applied multiplicatively on the
 * composite so a debut pitcher with an elite Statcast sample can't
 * score his way onto the board.
 */
export interface PitcherCredibility {
  /** 0-1. 1.0 = fully trusted, values below indicate thinner sample. */
  multiplier: number;
  /** Current-season IP fed into the formula (for display). */
  currentIp: number;
  /** Prior-classification IP fed into the formula (for display). */
  priorIp: number;
  /** Short human-readable reason, e.g. "6 IP, unclassified". */
  reason: string;
}

export interface PitcherRating {
  /** Final 0-1 composite (same scale as the old overallScore). */
  score: number;
  /** Raw pre-multiplier composite (useful for debugging). */
  base: number;
  /** Global (per-matchup) multipliers applied on top of the weighted sum. */
  velocity: PitcherRatingMultiplier;
  platoon: PitcherRatingMultiplier;
  /** Sample-size downweight. Multiplier ≤ 1.0 — applied last. */
  credibility: PitcherCredibility;
  /** Per-category sub-scores + contributions, in input order. */
  categories: PitcherCategoryContribution[];
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const DEFAULT_STAT_IDS: number[] = Object.values(PITCHER_CATEGORY_STAT_IDS);

// --- Data credibility -------------------------------------------------------
// Current-IP ramp. For unclassified pitchers, this is the whole signal.
const IP_FULL_TRUST = 40;

// Debut cap: thin current-season sample AND no classifiable prior tier ⇒
// we simply don't know this pitcher. Hard-cap credibility so even a
// perfect 6-IP cameo lands in the "don't stream" range.
const DEBUT_CAP = 0.40;
const DEBUT_CURRENT_IP_CEILING = 20;

// Credibility threshold below which the pitcher loses category pills —
// no confident pill assignment when we don't trust the underlying score.
const MIN_CRED_FOR_PILLS = 0.60;

// League anchors used for a few sub-score normalisations.
const LEAGUE_OPS = 0.710;

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function clamp(x: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, x)); }

/**
 * Sample-size trust score for a pitcher.
 *
 * Two cases:
 *   - **Classified pitcher (proven tier).** The classifier already vouched
 *     for them (25+ current IP OR 60+ prior IP). Being classified IS the
 *     credibility signal — we trust the rating as-is. The previous 15%
 *     haircut for "early-season thinness" was crushing every established
 *     starter through April, since most sit in the 25-40 current-IP band.
 *   - **Unclassified.** No baseline to lean on. Ramp on current IP, with
 *     a hard `DEBUT_CAP` floor when sample is below `DEBUT_CURRENT_IP_CEILING`
 *     so a perfect 6-IP cameo can't score into the streaming range.
 *
 * Returns a multiplier in [0, 1]; 1.0 means "trust the composite as-is".
 */
function dataCredibility(pp: ProbablePitcher): PitcherCredibility {
  const currentIp = pp.inningsPitched;
  const hasProvenTier = !!pp.quality && pp.quality.tier !== 'unknown';

  if (hasProvenTier) {
    return {
      multiplier: 1.0,
      currentIp,
      priorIp: 0,
      reason: `${currentIp.toFixed(0)} IP, classified`,
    };
  }

  const raw = clamp01(currentIp / IP_FULL_TRUST);
  if (currentIp < DEBUT_CURRENT_IP_CEILING) {
    const reason = currentIp <= 0.1
      ? 'no MLB sample'
      : `${currentIp.toFixed(1)} IP, unclassified`;
    return {
      multiplier: Math.min(raw, DEBUT_CAP),
      currentIp,
      priorIp: 0,
      reason,
    };
  }
  return {
    multiplier: raw,
    currentIp,
    priorIp: 0,
    reason: `${currentIp.toFixed(0)} IP, unclassified`,
  };
}

function effectiveEra(pp: ProbablePitcher): number | null {
  if (pp.xera !== null) return pp.xera;
  if (pp.era !== null && pp.inningsPitched >= 25) return pp.era;
  return null;
}

function tierToEra(tier: PitcherTier | undefined): number | null {
  switch (tier) {
    case 'ace': return 2.90;
    case 'tough': return 3.50;
    case 'average': return 4.10;
    case 'weak': return 4.70;
    case 'bad': return 5.30;
    default: return null;
  }
}

export function tierLabel(tier: PitcherTier): string {
  switch (tier) {
    case 'ace': return 'ACE';
    case 'tough': return 'Tough';
    case 'average': return 'Avg';
    case 'weak': return 'Weak';
    case 'bad': return 'Bad';
    default: return '?';
  }
}

function oppOpsVsHand(pp: ProbablePitcher, opp: TeamOffense | null): number | null {
  if (!opp) return null;
  if (pp.throws === 'L') return opp.vsLeft?.ops ?? opp.ops ?? null;
  return opp.vsRight?.ops ?? opp.ops ?? null;
}

function oppKRateVsHand(pp: ProbablePitcher, opp: TeamOffense | null): number | null {
  if (!opp) return null;
  if (pp.throws === 'L') return opp.vsLeft?.strikeOutRate ?? opp.strikeOutRate ?? null;
  return opp.vsRight?.strikeOutRate ?? opp.strikeOutRate ?? null;
}

// ---------------------------------------------------------------------------
// Talent resolution
// ---------------------------------------------------------------------------
//
// Streaming code consumes the same `pitcherTalentScore` that powers the
// batter-rating engine — RV/100 → xwOBA-a → tier → neutral. The call
// site projects the result down to the legacy `ResolvedTalent` shape so
// the rest of the file (which expects `source: 'rv' | 'xwoba' | ...`)
// keeps working unchanged. See `src/lib/pitching/quality.ts` for the
// canonical definition.

type ResolvedTalent = Pick<
  import('@/lib/pitching/quality').PitcherTalentResult,
  'score' | 'source' | 'display' | 'available'
>;

function resolveTalent(pp: ProbablePitcher): ResolvedTalent {
  const r = pitcherTalentScore(pp);
  return {
    score: r.score,
    source: r.source,
    display: r.display,
    available: r.available,
  };
}

// ---------------------------------------------------------------------------
// Sub-score builders (one per streaming category)
//
// Each returns { subScore ∈ [0,1], detail } where 1 = best outcome for
// that category from the pitcher's perspective.
// ---------------------------------------------------------------------------

interface SubScoreResult {
  subScore: number;
  detail: string;
}

interface SharedInputs {
  pp: ProbablePitcher;
  oppOps: number | null;         // opponent OPS vs pitcher hand
  oppK: number | null;           // opponent K-rate vs pitcher hand
  talent: ResolvedTalent;        // 0-1
  parkFactor: number;            // 100 = neutral
  parkHR: number;                // 100 = neutral
  weatherSuppress: number;       // 1 - getWeatherScore; high = suppresses offense
  isHome: boolean;
  eraProxy: number | null;       // effective ERA or tier-derived ERA
  /** Opposing starter's talent (already on the game object — MLB schedule
   *  enriches BOTH probables). 0-1 from the opposing pitcher's perspective:
   *  1 = he's elite. We invert this inside scoreW because facing an ace
   *  collapses W odds. Falls back to neutral 0.5 with available=false when
   *  the opposing probable is TBD or missing. */
  oppPitcher: ResolvedTalent;
  /** Pitcher-team's staff ERA — used as a bullpen-quality proxy in scoreW.
   *  This is overall (SP+RP) team ERA, not relief-only; correlates ~0.7
   *  with true bullpen ERA. Upgrade path: fetch sitCodes=rp split if the
   *  proxy isn't sharp enough. Null when missing → neutral. */
  ownStaffEra: number | null;
}

/**
 * QS sub-score. Quality Start needs depth AND effectiveness: 6+ IP with
 * ≤3 ER. Three dominant inputs:
 *   - Inningsperstart (can they even get to 6?)
 *   - Talent / ERA proxy (can they hold runs?)
 *   - Opponent strength (tough lineup drives pitch count + runs)
 */
function scoreQS(inp: SharedInputs): SubScoreResult {
  const { pp, oppOps, talent, eraProxy } = inp;
  // IPGS → 0..1 linear between 4.5 (low-end) and 6.5 (elite workhorse).
  const ipgs = pp.inningsPerStart;
  const ipgsVal = ipgs !== null ? clamp01((ipgs - 4.5) / 2.0) : 0.45;

  // Talent drives "can you actually pitch 6 innings well?" — direct use.
  const talentVal = talent.score;

  // ERA proxy: convert expected ERA to 0-1 between 5.50 (bad) → 2.50 (elite).
  const eraVal = eraProxy !== null ? clamp01((5.50 - eraProxy) / 3.00) : 0.5;

  // Opponent OPS: 0.650 (weak) → 0.810 (strong). Stronger lineups run up
  // pitch count AND score runs, both of which kill QS.
  const oppVal = oppOps !== null ? clamp01(1 - (oppOps - 0.650) / 0.160) : 0.5;

  // Weights: depth is a hard gate (35%), effectiveness 40%, matchup 25%.
  const sub =
    ipgsVal * 0.35 +
    talentVal * 0.25 +
    eraVal * 0.15 +
    oppVal * 0.25;

  const detailParts: string[] = [];
  if (ipgs !== null) detailParts.push(`${ipgs.toFixed(1)} IP/GS`);
  detailParts.push(talent.display);
  if (oppOps !== null) detailParts.push(`opp ${oppOps.toFixed(3).replace(/^0\./, '.')} OPS`);
  return { subScore: clamp01(sub), detail: detailParts.join(' · ') };
}

/**
 * K sub-score. Strikeouts are driven by a combination of pitcher
 * swing-and-miss ability (K/9 + talent) and opponent propensity to
 * strike out (K/PA vs hand).
 */
function scoreK(inp: SharedInputs): SubScoreResult {
  const { pp, oppK, talent } = inp;
  // K/9: 6.0 (low) → 12.0 (elite).
  const k9 = pp.strikeoutsPer9;
  const k9Val = k9 !== null ? clamp01((k9 - 6.0) / 6.0) : 0.5;

  // Talent bolsters when Savant signals (RV/100) are available, since
  // elite RV/100 guys typically have whiff tools even when their raw
  // K/9 is noisy early.
  const talentVal = talent.score;

  // Opponent K-rate: 0.180 (low) → 0.265 (high). Higher = more Ks for
  // this pitcher.
  const oppVal = oppK !== null ? clamp01((oppK - 0.180) / 0.085) : 0.5;

  const sub = k9Val * 0.50 + talentVal * 0.25 + oppVal * 0.25;

  const parts: string[] = [];
  if (k9 !== null) parts.push(`${k9.toFixed(1)} K/9`);
  parts.push(talent.display);
  if (oppK !== null) parts.push(`opp ${(oppK * 100).toFixed(1)}% K`);
  return { subScore: clamp01(sub), detail: parts.join(' · ') };
}

/**
 * W sub-score. Wins are noisy by nature, but four signals carry real
 * predictive weight on a per-game basis:
 *   1. Our pitcher's quality (talent).
 *   2. The OPPOSING starter's quality — facing an ace collapses W odds
 *      regardless of how good our guy is. Equal-magnitude signal to #1.
 *   3. Opposing lineup OPS-vs-hand (run-scoring environment).
 *   4. Our team's bullpen — a starter who hands a 3-run lead to a 5.00-ERA
 *      bullpen has visibly worse W odds than the same start in front of
 *      a 3.40-ERA pen.
 * Home advantage stays as a small (~10%) tilt.
 *
 * Weights total 1.0. Talent and oppPitcher are roughly symmetric (35/25)
 * because facing an ace dampens but doesn't fully cancel a great start —
 * run support and bullpen still matter.
 */
function scoreW(inp: SharedInputs): SubScoreResult {
  const { oppOps, talent, oppPitcher, ownStaffEra, isHome } = inp;
  const talentVal = talent.score;
  // Opposing starter: invert (their talent = our W headwind). Falls back
  // to neutral 0.5 when oppPitcher.available is false (TBD / unmatched).
  const oppPitcherVal = oppPitcher.available ? 1 - oppPitcher.score : 0.5;
  const oppVal = oppOps !== null ? clamp01(1 - (oppOps - 0.650) / 0.160) : 0.5;
  // Bullpen: 5.00 ERA → 0, 3.40 ERA → 1. League-average pen sits ~4.10,
  // so neutral teams land near 0.55. Null → 0.5 (neutral).
  const bullpenVal = ownStaffEra !== null ? clamp01((5.00 - ownStaffEra) / 1.60) : 0.5;
  const homeVal = isHome ? 0.55 : 0.45; // ~.540 vs .460 home winrate in MLB

  const sub =
    talentVal * 0.35 +
    oppPitcherVal * 0.25 +
    oppVal * 0.20 +
    bullpenVal * 0.10 +
    homeVal * 0.10;

  const parts: string[] = [];
  parts.push(talent.display);
  if (oppPitcher.available) parts.push(`vs ${oppPitcher.display}`);
  if (oppOps !== null) parts.push(`opp ${oppOps.toFixed(3).replace(/^0\./, '.')} OPS`);
  if (ownStaffEra !== null) parts.push(`pen ${ownStaffEra.toFixed(2)}`);
  parts.push(isHome ? 'home' : 'away');
  return { subScore: clamp01(sub), detail: parts.join(' · ') };
}

/**
 * ERA sub-score. Core drivers: talent (xERA / RV/100), park HR factor,
 * and weather. Opponent OPS matters secondarily — a great pitcher often
 * suppresses talented lineups almost as well as average ones, but park
 * and weather have non-negotiable run-environment effects.
 */
function scoreERA(inp: SharedInputs): SubScoreResult {
  const { pp, oppOps, talent, parkHR, weatherSuppress, eraProxy } = inp;
  // Talent as the baseline.
  const talentVal = talent.score;

  // ERA proxy: 5.50 → 0, 2.50 → 1.
  const eraVal = eraProxy !== null ? clamp01((5.50 - eraProxy) / 3.00) : 0.5;

  // Park HR factor: 85 = great for pitcher (1.0), 115 = terrible (0.0).
  const parkVal = clamp01(1 - (parkHR - 85) / 30);

  // Weather: 0 (boost offense) → 1 (suppress offense); direct use.
  const weatherVal = weatherSuppress;

  // Opponent OPS: same mapping as in QS.
  const oppVal = oppOps !== null ? clamp01(1 - (oppOps - 0.650) / 0.160) : 0.5;

  // GB bonus — a groundball arm in a hitters' park is less hurt by the
  // park than a flyball arm (HRs are the ERA killer). Up to +4% when
  // GB rate ≥ 0.55 AND parkHR ≥ 108.
  const gbBump = pp.gbRate !== null && pp.gbRate >= 0.55 && parkHR >= 108 ? 0.04 : 0;

  const sub =
    talentVal * 0.35 +
    eraVal * 0.25 +
    oppVal * 0.15 +
    parkVal * 0.15 +
    weatherVal * 0.10 +
    gbBump;

  const parts: string[] = [];
  parts.push(talent.display);
  if (eraProxy !== null) parts.push(`${eraProxy.toFixed(2)} ERA`);
  parts.push(`park HR ${parkHR}`);
  return { subScore: clamp01(sub), detail: parts.join(' · ') };
}

/**
 * WHIP sub-score. Walks + hits per inning. Dominated by walk rate
 * (fastest-stabilising pitcher stat after K-rate) and BAA/contact-
 * quality talent. Opponent OBP-ish context comes from OPS-vs-hand.
 */
function scoreWHIP(inp: SharedInputs): SubScoreResult {
  const { pp, oppOps, talent } = inp;
  // BB/9: 1.5 (elite command) → 5.0 (awful). Same anchor as old module.
  const bb9 = pp.bb9;
  const bbVal = bb9 !== null ? clamp01(1 - (bb9 - 1.5) / 3.5) : 0.5;

  // WHIP directly: 0.95 (elite) → 1.55 (bad).
  const whipVal = pp.whip !== null ? clamp01((1.55 - pp.whip) / 0.60) : 0.5;

  // Talent catches contact-quality (lower xwOBA-a → fewer hits).
  const talentVal = talent.score;

  // Opponent OPS: weak opponents = fewer baserunners.
  const oppVal = oppOps !== null ? clamp01(1 - (oppOps - 0.650) / 0.160) : 0.5;

  const sub =
    bbVal * 0.35 +
    whipVal * 0.25 +
    talentVal * 0.20 +
    oppVal * 0.20;

  const parts: string[] = [];
  if (pp.whip !== null) parts.push(`${pp.whip.toFixed(2)} WHIP`);
  if (bb9 !== null) parts.push(`${bb9.toFixed(1)} BB/9`);
  parts.push(talent.display);
  return { subScore: clamp01(sub), detail: parts.join(' · ') };
}

// ---------------------------------------------------------------------------
// Multipliers — velocity trend + platoon vulnerability
// ---------------------------------------------------------------------------

/**
 * Velocity-delta multiplier. Year-over-year fastball velocity change is
 * one of the strongest early-season health/decline signals: a sustained
 * 1+ mph drop is a top-quartile predictor of ERA regression across the
 * MLB pitcher population.
 *
 * Scale: ±2 mph → ±7%. Losses hurt slightly more than gains reward
 * (asymmetric), matching the empirical distribution where drops reliably
 * predict injury but gains are often small mechanical tweaks.
 */
function buildVelocityMultiplier(pp: ProbablePitcher): PitcherRatingMultiplier {
  const cur = pp.avgFastballVelo;
  const prior = pp.avgFastballVeloPrior;

  if (cur === null || cur === undefined || prior === null || prior === undefined) {
    return {
      multiplier: 1.0,
      deltaPct: 0,
      display: '—',
      summary: 'No velo history',
      available: false,
    };
  }

  const delta = cur - prior;
  const clampedDelta = clamp(delta, -2.0, 2.0);
  // Asymmetric: losses = 4%/mph, gains = 3%/mph.
  const pct = clampedDelta < 0 ? clampedDelta * 0.04 : clampedDelta * 0.03;
  const multiplier = clamp(1 + pct, 0.92, 1.06);

  const summary =
    delta >= 1.0 ? 'Velo trending up'
    : delta >= 0.3 ? 'Velo uptick'
    : delta <= -1.0 ? 'Velo red flag'
    : delta <= -0.3 ? 'Velo slipping'
    : 'Velo stable';

  const sign = delta >= 0 ? '+' : '';
  return {
    multiplier,
    deltaPct: (multiplier - 1) * 100,
    display: `${sign}${delta.toFixed(1)} mph`,
    summary,
    available: true,
  };
}

/**
 * Platoon-vulnerability multiplier. The opposing team stacks the
 * pitcher's weaker platoon side — we factor this into the whole rating
 * instead of baking it into each category (same reason the batter page
 * treats platoon as a matchup-wide multiplier).
 */
function buildPitcherPlatoonMultiplier(pp: ProbablePitcher): PitcherRatingMultiplier {
  const weakSideOps = pp.throws === 'L' ? pp.platoonOpsVsRight : pp.platoonOpsVsLeft;
  if (weakSideOps === null || weakSideOps === undefined) {
    return {
      multiplier: 1.0,
      deltaPct: 0,
      display: '—',
      summary: 'No platoon data',
      available: false,
    };
  }
  // 0.650 OPS = +5% multiplier (clean split), 0.900 = -5% (vulnerable).
  const raw = 1 - (weakSideOps - LEAGUE_OPS) * 0.4;
  const multiplier = clamp(raw, 0.93, 1.05);
  return {
    multiplier,
    deltaPct: (multiplier - 1) * 100,
    display: `${weakSideOps.toFixed(3).replace(/^0\./, '.')} OPS`,
    summary: weakSideOps <= 0.700 ? 'Clean split'
           : weakSideOps <= 0.770 ? 'Mild platoon'
           : 'Platoon vulnerable',
    available: true,
  };
}

// ---------------------------------------------------------------------------
// Weight vector (mirrors batterRating.buildWeightVector)
// ---------------------------------------------------------------------------

function buildPitcherWeightVector(
  scoredStatIds: number[],
  focusMap: Record<number, Focus>,
): Record<number, number> {
  if (scoredStatIds.length === 0) return {};
  const active = scoredStatIds.filter(id => (focusMap[id] ?? 'neutral') !== 'punt');
  if (active.length === 0) {
    const empty: Record<number, number> = {};
    for (const id of scoredStatIds) empty[id] = 0;
    return empty;
  }

  const raw: Record<number, number> = {};
  let total = 0;
  for (const id of scoredStatIds) {
    const f = focusMap[id] ?? 'neutral';
    const w = f === 'punt' ? 0 : f === 'chase' ? 2 : 1;
    raw[id] = w;
    total += w;
  }
  const out: Record<number, number> = {};
  for (const id of scoredStatIds) {
    out[id] = total > 0 ? raw[id] / total : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core: getPitcherRating
// ---------------------------------------------------------------------------

/**
 * Build the shared-input bundle once per matchup. All sub-scores and
 * breakdowns draw from this bag, keeping the numbers in lockstep.
 */
function buildSharedInputs(input: PillInput): SharedInputs {
  const { pp, oppOffense, park, game, isHome } = input;
  // The opposing probable is already enriched (xwoba / RV/100 / quality
  // tier) by the same getGameDay pipeline that enriched our pitcher, so
  // resolveTalent gives us a directly comparable 0-1 score.
  const opposingProbable = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;
  const ownStaffEra = (isHome ? game.homeTeam.staffEra : game.awayTeam.staffEra) ?? null;
  return {
    pp,
    oppOps: oppOpsVsHand(pp, oppOffense),
    oppK: oppKRateVsHand(pp, oppOffense),
    talent: resolveTalent(pp),
    parkFactor: park?.parkFactor ?? 100,
    parkHR: park?.parkFactorHR ?? park?.parkFactor ?? 100,
    weatherSuppress: 1 - getWeatherScore(game, park),
    isHome,
    eraProxy: effectiveEra(pp) ?? tierToEra(pp.quality?.tier),
    oppPitcher: opposingProbable ? resolveTalent(opposingProbable) : {
      score: 0.5, source: 'none', display: 'TBD opp SP', available: false,
    },
    ownStaffEra,
  };
}

/**
 * Dispatch to the right sub-score builder by stat_id. Unknown ids get
 * neutral so a league with exotic pitcher categories (e.g. Holds) doesn't
 * crash — the composite just ignores them.
 */
function subScoreFor(statId: number, shared: SharedInputs): SubScoreResult | null {
  const goal = STAT_ID_TO_GOAL[statId];
  if (!goal) return null;
  switch (goal) {
    case 'QS':   return scoreQS(shared);
    case 'K':    return scoreK(shared);
    case 'W':    return scoreW(shared);
    case 'ERA':  return scoreERA(shared);
    case 'WHIP': return scoreWHIP(shared);
  }
}

function labelFor(goal: StreamGoal): string {
  switch (goal) {
    case 'QS': return 'QS';
    case 'K': return 'Strikeouts';
    case 'W': return 'Wins';
    case 'ERA': return 'ERA';
    case 'WHIP': return 'WHIP';
  }
}

/**
 * Per-category streaming rating for a single pitcher matchup.
 *
 * When `scoredCategories` is omitted, assumes a default 5-cat pitcher
 * league (QS/K/W/ERA/WHIP) with even weights — this is the shape the
 * legacy `overallScore` + `computeBreakdown` use, so back-compat is
 * preserved.
 */
export function getPitcherRating(input: PillInput): PitcherRating {
  const shared = buildSharedInputs(input);
  const credibility = dataCredibility(input.pp);

  // Resolve which stat_ids to score against. Preserve the order
  // scoredCategories gave us so the UI can render in a stable order.
  const statIds: number[] = input.scoredCategories
    ? input.scoredCategories
        .filter(c => STAT_ID_TO_GOAL[c.stat_id])
        .map(c => c.stat_id)
    : DEFAULT_STAT_IDS;

  const weights = buildPitcherWeightVector(statIds, input.focusMap ?? {});
  const activeWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const categories: PitcherCategoryContribution[] = [];
  let composite = 0;

  for (const statId of statIds) {
    const result = subScoreFor(statId, shared);
    if (!result) continue;
    const goal = STAT_ID_TO_GOAL[statId]!;
    const weight = weights[statId] ?? 0;
    const focus = input.focusMap?.[statId] ?? 'neutral';
    categories.push({
      statId,
      goal,
      label: labelFor(goal),
      subScore: result.subScore,
      weight,
      contribution: weight * (result.subScore - 0.5),
      focus,
      detail: result.detail,
    });
    composite += weight * result.subScore;
  }

  // When every active cat is punted, composite = 0 but we want a
  // meaningful score — degrade to an unweighted average of sub-scores
  // so the UI has something sane to show.
  const base = activeWeight > 0 ? composite : categories.length > 0
    ? categories.reduce((sum, c) => sum + c.subScore, 0) / categories.length
    : 0.5;

  const velocity = buildVelocityMultiplier(input.pp);
  const platoon = buildPitcherPlatoonMultiplier(input.pp);

  // Apply multipliers only when there's positive active weight. In the
  // all-punt degenerate case the fallback average already reflects raw
  // pitcher quality; multiplier inflation would just be misleading.
  const raw = activeWeight > 0
    ? base * velocity.multiplier * platoon.multiplier
    : base;

  // Credibility always applies — even in the all-punt case — because the
  // "we don't know this pitcher" signal is orthogonal to categories.
  const score = clamp01(raw * credibility.multiplier);

  return { score, base, velocity, platoon, credibility, categories };
}

// ---------------------------------------------------------------------------
// Back-compat wrappers
//
// Old consumers import `overallScore` + `computeBreakdown`; those keep
// working by delegating to `getPitcherRating` with default (even) cat
// weights.
// ---------------------------------------------------------------------------

export function overallScore(input: PillInput): number {
  return getPitcherRating(input).score;
}

export function computeBreakdown(input: PillInput): ScoredBreakdown {
  const rating = getPitcherRating(input);
  const components: ScoreComponent[] = rating.categories.map(cat => ({
    label: cat.label,
    detail: cat.detail,
    val: cat.subScore,
    weight: cat.weight,
  }));
  // Velocity + platoon render as trailing "matchup multiplier" rows so
  // users see WHY the composite differs from the weighted sub-score sum.
  if (rating.velocity.available) {
    components.push({
      label: 'Velocity',
      detail: `${rating.velocity.display} · ${rating.velocity.summary}`,
      val: clamp01(0.5 + rating.velocity.deltaPct / 14), // ±7% → 0..1
      weight: 0,
    });
  }
  if (rating.platoon.available) {
    components.push({
      label: 'Platoon',
      detail: `${rating.platoon.display} · ${rating.platoon.summary}`,
      val: clamp01(0.5 + rating.platoon.deltaPct / 10),
      weight: 0,
    });
  }
  // Credibility downweight — only render when it's actually biting, so
  // we don't clutter the breakdown for established starters.
  if (rating.credibility.multiplier < 0.999) {
    const pct = Math.round(rating.credibility.multiplier * 100);
    components.push({
      label: 'Experience',
      detail: rating.credibility.reason,
      val: rating.credibility.multiplier,
      weight: 0,
      labelOverride: `×${pct}%`,
    });
  }
  return { total: rating.score, components };
}

// ---------------------------------------------------------------------------
// Stream-for category pills (rebuilt against sub-scores)
// ---------------------------------------------------------------------------

/**
 * Category pills now fire off the same sub-scores that drive the
 * composite, so a pitcher tagged with a strong K pill really is a
 * strong K bet — no more thresholds drifting from the ranking logic.
 *
 * Strong ≥ 0.72, Weak ≤ 0.35. A few cat-specific tweaks:
 *   - QS pill always weak if IP/GS < 5.0 regardless of sub-score (hard
 *     depth gate — a 4.6-IP opener simply cannot QS).
 *   - ERA/WHIP weak pills additionally require a real negative signal,
 *     not just "missing data" pushing sub-score to neutral 0.5.
 */
export function getStreamPills(input: PillInput): StreamPill[] {
  const pills: StreamPill[] = [];
  if (dataCredibility(input.pp).multiplier < MIN_CRED_FOR_PILLS) return pills;

  const rating = getPitcherRating({ ...input, focusMap: {}, scoredCategories: undefined });
  const byGoal = new Map<StreamGoal, PitcherCategoryContribution>();
  for (const c of rating.categories) byGoal.set(c.goal, c);

  for (const goal of ['QS', 'K', 'W', 'ERA', 'WHIP'] as const) {
    const cat = byGoal.get(goal);
    if (!cat) continue;

    // Hard depth gate on QS — unaffected by whatever talent / matchup
    // signals are screaming "stream him", a non-6IP pitcher doesn't QS.
    if (goal === 'QS' && input.pp.inningsPerStart !== null && input.pp.inningsPerStart < 5.0) {
      pills.push({ goal, verdict: 'weak' });
      continue;
    }

    if (cat.subScore >= 0.72) {
      pills.push({ goal, verdict: 'strong' });
    } else if (cat.subScore <= 0.35) {
      pills.push({ goal, verdict: 'weak' });
    }
  }

  return pills;
}
