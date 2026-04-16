import type { BatterSplits, BatterSeasonStats, SplitLine, MLBGame, ParkData, ProbablePitcher } from './types';

// ---------------------------------------------------------------------------
// Park verdict thresholds
//
// Use the handedness-split park factor when the batter's side is known
// (parkFactorL / parkFactorR), falling back to overall for switch hitters.
// Only surface truly extreme parks — 108+ / 92- catches Coors and handedness
// outliers like Fenway for LHB, T-Mobile for RHB. Anything less is noise.
// ---------------------------------------------------------------------------

const PARK_EXTREME_HITTER = 108;
const PARK_EXTREME_PITCHER = 92;

// ---------------------------------------------------------------------------
// Matchup context for a single batter
// ---------------------------------------------------------------------------

export interface MatchupContext {
  game: MLBGame;
  isHome: boolean;
  opposingPitcher: MLBGame['homeProbablePitcher']; // nullable
  park: ParkData | null;
}

/**
 * Given all of the day's games and a batter's team, produce the matchup context.
 * Returns null if the team has no game today.
 */
export function resolveMatchup(
  games: MLBGame[],
  park: ParkData | null,
  teamAbbr: string,
): MatchupContext | null {
  const abbr = teamAbbr.toUpperCase();
  const game = games.find(
    g =>
      g.homeTeam.abbreviation.toUpperCase() === abbr ||
      g.awayTeam.abbreviation.toUpperCase() === abbr,
  );
  if (!game) return null;

  const isHome = game.homeTeam.abbreviation.toUpperCase() === abbr;
  const opposingPitcher = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;

  return { game, isHome, opposingPitcher, park };
}

// ---------------------------------------------------------------------------
// Favorability verdicts
// ---------------------------------------------------------------------------

export type Verdict = 'strong' | 'neutral' | 'weak' | 'unknown';

export interface VerdictLabel {
  verdict: Verdict;
  label: string;
  detail?: string;
}

/**
 * Compare a split line to season totals. Uses OPS delta as the primary signal.
 * Returns 'strong' if split OPS is ≥ .050 above season, 'weak' if ≥ .050 below.
 */
function compareToSeason(split: SplitLine | null, season: SplitLine | null, minPA: number): Verdict {
  if (!split || !season || split.ops === null || season.ops === null) return 'unknown';
  if (split.plateAppearances < minPA) return 'unknown';

  const delta = split.ops - season.ops;
  if (delta >= 0.05) return 'strong';
  if (delta <= -0.05) return 'weak';
  return 'neutral';
}

/**
 * Pick the batter's split line relevant to the current matchup's pitcher handedness.
 */
export function getHandednessSplit(
  splits: BatterSplits | null,
  pitcherThrows: 'L' | 'R' | 'S' | undefined,
): { split: SplitLine | null; label: string } {
  if (!splits || !pitcherThrows) return { split: null, label: '' };
  if (pitcherThrows === 'L') return { split: splits.vsLeft, label: 'vs LHP' };
  return { split: splits.vsRight, label: 'vs RHP' };
}

/**
 * Compute a verdict for the handedness matchup.
 *
 * Requires 30+ PA in the split — a pragmatic floor that's achievable by
 * mid-April for everyday players while still filtering the worst noise.
 * The population-level platoon advantage is real; 30 PA gives enough signal
 * to surface strong individual tendencies.
 */
export function getHandednessVerdict(
  splits: BatterSplits | null,
  pitcherThrows: 'L' | 'R' | 'S' | undefined,
): VerdictLabel {
  const { split, label } = getHandednessSplit(splits, pitcherThrows);
  if (!splits || !split) return { verdict: 'unknown', label: '' };
  const verdict = compareToSeason(split, splits.seasonTotals, 30);

  const ops = split.ops !== null ? split.ops.toFixed(3).replace(/^0\./, '.') : '—';
  const detail = `${label}: ${ops} OPS`;

  if (verdict === 'strong') return { verdict, label: `Crushes ${pitcherThrows === 'L' ? 'L' : 'R'}`, detail };
  if (verdict === 'weak') return { verdict, label: `Weak vs ${pitcherThrows === 'L' ? 'L' : 'R'}`, detail };
  return { verdict: 'unknown', label: '' };
}

/**
 * Determine whether a game is a day or night game from its start time.
 *
 * MLB API gameDate is UTC. During the baseball season (EDT, UTC-4), day
 * games typically start between ~1 PM ET (17:00 UTC) and ~4 PM ET (20:00
 * UTC). Night games start at ~6:30–7:10 PM ET (22:30–23:10 UTC) or later.
 * West coast night games can start at 9–10 PM ET, which rolls past midnight
 * into the small hours of the next UTC day.
 *
 * We classify as "day" anything whose ET hour (UTC − 4) is before 5 PM (17h).
 * This correctly handles west coast night games that wrap past midnight UTC.
 */
function isDayGame(gameDateIso: string): boolean {
  const d = new Date(gameDateIso);
  const etHour = (d.getUTCHours() - 4 + 24) % 24;
  return etHour < 17;
}

/**
 * Compute a verdict for day/night relative to season totals.
 *
 * Requires 40+ PA — day/night is a weaker signal than handedness but still
 * meaningful for players with documented tendencies. 40 PA is achievable
 * for everyday players by late April.
 */
export function getDayNightVerdict(
  splits: BatterSplits | null,
  gameDateIso: string,
): VerdictLabel {
  if (!splits) return { verdict: 'unknown', label: '' };
  const dayGame = isDayGame(gameDateIso);
  const split = dayGame ? splits.day : splits.night;
  const verdict = compareToSeason(split, splits.seasonTotals, 40);
  if (verdict === 'unknown' || verdict === 'neutral') return { verdict, label: '' };

  const ops = split?.ops !== null && split?.ops !== undefined ? split.ops.toFixed(3).replace(/^0\./, '.') : '—';
  const label = dayGame
    ? (verdict === 'strong' ? 'Day hitter' : 'Weak in day')
    : (verdict === 'strong' ? 'Night owl' : 'Weak at night');
  return { verdict, label, detail: `${ops} OPS` };
}

/**
 * Decide whether to surface a park pill for this batter.
 *
 * Picks the park factor matching the batter's side (parkFactorL for LHB,
 * parkFactorR for RHB, overall for switch hitters). Only fires on true
 * outliers — handedness-aware thresholds catch Yankee Stadium for LHB (short
 * RF porch), T-Mobile for RHB (marine air), etc., without polluting the row
 * with every park that's mildly off-average.
 */
export function getParkVerdict(
  park: ParkData | null | undefined,
  bats: 'L' | 'R' | 'S' | undefined,
): { verdict: 'strong' | 'weak'; label: string } | null {
  if (!park) return null;

  const pf =
    bats === 'L' ? park.parkFactorL :
    bats === 'R' ? park.parkFactorR :
    park.parkFactor;

  if (pf >= PARK_EXTREME_HITTER) {
    // Show the factor to convey magnitude — Coors (115) vs Chase (108) is a big difference
    return { verdict: 'strong', label: pf >= 113 ? `Hitter park (${pf})` : 'Hitter park' };
  }
  if (pf <= PARK_EXTREME_PITCHER) {
    return { verdict: 'weak', label: pf <= 88 ? `Pitcher park (${pf})` : 'Pitcher park' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pitcher quality pill
// ---------------------------------------------------------------------------

/**
 * Translate a probable pitcher's quality into a display pill for the batter's row.
 *
 * Tier-based (from classifyPitcherTier):
 * - ace:     red   (weak for the batter — facing a shutdown arm)
 * - tough:   muted neutral (informational — above-average SP)
 * - bad:     green (strong for the batter)
 * - weak:    green (strong for the batter, slightly less emphatic than bad)
 *
 * ERA fallback (when tier is average/unknown but ERA is available):
 * - ERA ≥ 4.50:  green (hittable pitcher, even if tier classification is muddled)
 * - ERA ≤ 3.00:  red   (strong pitcher by results)
 *
 * This ensures most rows have at least one context pill when the opposing
 * pitcher is known — the tier may be "average" but the ERA can still be
 * informative at the extremes.
 */
export function getPitcherQualityPill(
  pitcher: ProbablePitcher | null | undefined,
): { verdict: Verdict; label: string } | null {
  if (!pitcher) return null;

  const q = pitcher.quality;
  if (q && q.tier !== 'unknown' && q.tier !== 'average') {
    switch (q.tier) {
      case 'ace':
        return { verdict: 'weak', label: 'Facing Ace' };
      case 'tough':
        return { verdict: 'neutral', label: 'Tough SP' };
      case 'weak':
        return { verdict: 'strong', label: 'Weak SP' };
      case 'bad':
        return { verdict: 'strong', label: 'Bad SP' };
    }
  }

  // xERA fallback — prefer Statcast over actual ERA. xERA strips out luck
  // and team defense, so a 0.51 ERA with 4.20 xERA shows as average, not elite.
  // Only use xERA when Savant has a real sample (enforced upstream via bip ≥ 10).
  const xera = pitcher.xera;
  if (xera !== null) {
    if (xera >= 6.00) return { verdict: 'strong', label: `Hittable (x${xera.toFixed(1)})` };
    if (xera >= 4.50) return { verdict: 'strong', label: 'Hittable SP' };
    if (xera <= 3.00) return { verdict: 'weak', label: `${xera.toFixed(2)} xERA` };
    // xERA between 3.00–4.50 = average, no pill needed
    return null;
  }

  // Raw ERA fallback — only trust when enough innings for stabilisation.
  // A 0.51 ERA in 15 IP is noise; a 5.80 ERA in 40 IP means something.
  const ip = pitcher.inningsPitched;
  const era = pitcher.era;

  if (ip < 25) {
    // Unproven pitcher (callup, spot starter, early season) — surface this
    // so the manager knows there is no reliable scouting report.
    return { verdict: 'neutral', label: 'Unproven SP' };
  }

  if (era !== null) {
    if (era >= 6.00) return { verdict: 'strong', label: `Hittable (${era.toFixed(1)})` };
    if (era >= 4.50) return { verdict: 'strong', label: 'Hittable SP' };
    if (era <= 3.00) return { verdict: 'weak', label: `${era.toFixed(2)} ERA` };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pitcher K-rate pill
// ---------------------------------------------------------------------------

/**
 * Surface a pill when the opposing pitcher has an extreme strikeout rate.
 * High-K pitchers (≥ 10 K/9) suppress fantasy counting stats even when
 * their ERA is mediocre — more Ks mean fewer balls in play, fewer hits,
 * fewer runs batted in. Low-K pitchers (≤ 6 K/9) put more balls in play,
 * creating more opportunities for offense.
 *
 * Only fires at IP ≥ 15 to avoid noise from one-inning relief appearances.
 */
export function getPitcherKRatePill(
  pitcher: ProbablePitcher | null | undefined,
): { verdict: Verdict; label: string } | null {
  if (!pitcher) return null;
  const k9 = pitcher.strikeoutsPer9;
  if (k9 === null || pitcher.inningsPitched < 15) return null;

  if (k9 >= 11.0) return { verdict: 'weak', label: `${k9.toFixed(1)} K/9` };
  if (k9 >= 10.0) return { verdict: 'weak', label: 'High K rate' };
  if (k9 <= 6.5) return { verdict: 'strong', label: 'Low K rate' };
  return null;
}

// ---------------------------------------------------------------------------
// Opposing team staff quality
// ---------------------------------------------------------------------------

/**
 * Surface a pill when the opposing team's overall pitching staff is notably
 * strong or weak. This captures bullpen depth + team defense — factors
 * the SP-specific pill doesn't cover. Only fires on the extremes (~top/bottom
 * 5 teams in a typical year).
 *
 * Typical MLB team ERA range: 3.20 (elite) to 5.00+ (terrible).
 * Thresholds: ≤ 3.50 = elite staff, ≥ 4.60 = weak staff.
 */
export function getOpposingStaffPill(
  context: MatchupContext | null,
): { verdict: Verdict; label: string } | null {
  if (!context) return null;
  const { game, isHome } = context;
  const opposingTeam = isHome ? game.awayTeam : game.homeTeam;
  const era = opposingTeam.staffEra;
  if (era == null) return null;

  if (era >= 4.60) return { verdict: 'strong', label: 'Weak staff' };
  if (era <= 3.50) return { verdict: 'weak', label: 'Elite staff' };
  return null;
}

// ---------------------------------------------------------------------------
// Recent form
// ---------------------------------------------------------------------------

export type FormTrend = 'hot' | 'cold' | 'neutral' | 'unknown';

export interface FormLabel {
  trend: FormTrend;
  label: string;
  detail?: string;
}

/**
 * Assess current production level using OPS over a meaningful sample.
 *
 * Short-term "streaks" (L7/L14) are statistically non-predictive — a batter
 * hitting .400 over 7 games has no better chance of getting a hit tomorrow
 * than their season line suggests. We only surface this signal when the sample
 * is large enough (50+ PA) to reflect a genuine production-level shift, not
 * random variance.
 *
 * Source priority:
 *   1. currentSeason when ≥ 30 PA (primary — most stable available window;
 *      achievable for everyday players by ~10 games into the season)
 *   2. last30 when ≥ 50 PA (mid-season fallback when YTD is unavailable)
 *
 * Strong production:
 *   - OPS ≥ .900 (absolute — elite output regardless of baseline)
 *   - OPS ≥ baseline + .100 AND ≥ .750 (significantly above expectation)
 *
 * Poor production:
 *   - OPS ≤ .550 (absolute — severe underperformance)
 *   - OPS ≤ baseline − .100 AND ≤ .650 (significantly below expectation)
 */
export function getFormTrend(splits: BatterSplits | null): FormLabel {
  if (!splits) return { trend: 'unknown', label: '' };

  let recent: SplitLine | null = null;
  let window = '';
  if (splits.currentSeason && splits.currentSeason.plateAppearances >= 30 && splits.currentSeason.ops !== null) {
    recent = splits.currentSeason;
    window = 'YTD';
  } else if (splits.last30 && splits.last30.plateAppearances >= 50 && splits.last30.ops !== null) {
    recent = splits.last30;
    window = 'L30';
  }

  if (!recent || recent.ops === null) return { trend: 'unknown', label: '' };

  const avgStr = recent.avg !== null ? recent.avg.toFixed(3).replace(/^0\./, '.') : '—';
  const opsStr = recent.ops.toFixed(3).replace(/^0\./, '.');
  const detail = `${opsStr} OPS (${window}, ${recent.plateAppearances} PA)`;

  const baseline = splits.seasonTotals?.ops ?? null;
  const delta = baseline !== null ? recent.ops - baseline : null;

  if (recent.ops >= 0.900) {
    return { trend: 'hot', label: `Raking ${avgStr}`, detail };
  }
  if (delta !== null && delta >= 0.100 && recent.ops >= 0.750) {
    return { trend: 'hot', label: `Producing ${avgStr}`, detail };
  }

  if (recent.ops <= 0.550) {
    return { trend: 'cold', label: `Struggling ${avgStr}`, detail };
  }
  if (delta !== null && delta <= -0.100 && recent.ops <= 0.650) {
    return { trend: 'cold', label: `Scuffling ${avgStr}`, detail };
  }

  return { trend: 'neutral', label: '', detail };
}

// ---------------------------------------------------------------------------
// Stolen base indicator
// ---------------------------------------------------------------------------

/**
 * Surface a steal-threat pill when the batter has meaningful SB production.
 * Uses current season totals first, falls back to season baseline (may be
 * prior year in early April). Threshold: ≥ 5 SB with a reasonable rate
 * (≥ 1 SB per 30 PA) to avoid rewarding pure volume.
 */
export function getStealPill(
  splits: BatterSplits | null,
): { verdict: 'strong'; label: string } | null {
  if (!splits) return null;

  const line = splits.currentSeason ?? splits.seasonTotals;
  if (!line || line.plateAppearances < 30) return null;

  const sbPer600 = (line.stolenBases / line.plateAppearances) * 600;
  if (line.stolenBases >= 5 && sbPer600 >= 20) {
    return { verdict: 'strong', label: `${line.stolenBases} SB` };
  }
  if (line.stolenBases >= 10) {
    return { verdict: 'strong', label: `${line.stolenBases} SB` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Career vs pitcher pill
// ---------------------------------------------------------------------------

/**
 * Surface a pill when the batter has a meaningful career line vs the day's
 * opposing pitcher. Requires ≥ 8 PA to filter noise. Uses OPS thresholds
 * rather than relative-to-season since the sample is small and contextual.
 *
 * Career batter-vs-pitcher is one of the few genuinely predictive small-sample
 * stats — it captures specific mechanical matchups (pitch mix, arm angle).
 */
export function getCareerVsPitcherPill(
  careerVsPitcher: SplitLine | null,
  pitcherName: string | undefined,
): { verdict: Verdict; label: string } | null {
  if (!careerVsPitcher || !pitcherName) return null;
  if (careerVsPitcher.plateAppearances < 8) return null;

  const ops = careerVsPitcher.ops;
  if (ops === null) return null;

  const shortName = pitcherName.split(' ').pop() ?? pitcherName;
  // Only show AVG when it reinforces the message — a .250 AVG with high OPS
  // (walks + power) is genuinely good but looks misleading in a pill.
  const avg = careerVsPitcher.avg !== null && careerVsPitcher.avg >= 0.300
    ? careerVsPitcher.avg.toFixed(3).replace(/^0\./, '.')
    : null;

  if (ops >= 0.850) {
    return { verdict: 'strong', label: `Owns ${shortName}${avg ? ` ${avg}` : ''}` };
  }
  if (ops <= 0.500) {
    const weakAvg = careerVsPitcher.avg !== null && careerVsPitcher.avg < 0.200
      ? careerVsPitcher.avg.toFixed(3).replace(/^0\./, '.')
      : null;
    return { verdict: 'weak', label: `Can't hit ${shortName}${weakAvg ? ` ${weakAvg}` : ''}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Composite matchup score
//
// Weighted blend of all available signals → 0–1 where higher = better start.
// Follows the same invertNorm pattern as PitchingManager's overallScore.
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function norm(value: number | null, low: number, high: number): number {
  if (value === null) return 0.5;
  return clamp01((value - low) / (high - low));
}

export type BatterMatchupFactorKey =
  | 'platoonTalent'
  | 'pitcher'
  | 'career'
  | 'kRate'
  | 'park'
  | 'luck'
  | 'staff'
  | 'weather'
  | 'form'
  | 'battingOrder';

export interface BatterMatchupFactor {
  /** Stable identifier for the factor. */
  key: BatterMatchupFactorKey;
  /** Display label (e.g. "Talent", "Platoon vs RHP"). */
  label: string;
  /** Weight in the composite (0–1; factor weights sum to 1). */
  weight: number;
  /** Factor score normalised to 0–1 (0.5 = neutral). */
  normalized: number;
  /** Whether the underlying data was actually available — false means we defaulted to neutral. */
  available: boolean;
  /** Short raw-value display (e.g. ".372 xwOBA", "6.2 K/9", "—"). */
  display: string;
  /** Qualitative summary (e.g. "Elite bat", "Small sample", "Hittable arm"). */
  summary: string;
}

export interface BatterMatchupScore {
  score: number;
  tier: 'great' | 'good' | 'neutral' | 'poor' | 'bad';
  /** Per-factor breakdown in weight order — drives the expanded rating card. */
  factors: BatterMatchupFactor[];
}

function fmt3(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toFixed(3).replace(/^0\./, '.').replace(/^-0\./, '-.');
}

function fmtSignedDelta(v: number): string {
  const abs = Math.abs(v).toFixed(3).replace(/^0\./, '.');
  if (v > 0) return `+${abs}`;
  if (v < 0) return `−${abs}`;
  return abs;
}

// ---------------------------------------------------------------------------
// Platoon-adjusted talent
// ---------------------------------------------------------------------------

/**
 * Population-level OPS ratio of a batter's split OPS to their overall OPS
 * when facing a given hand. Sourced from The Book / FanGraphs platoon skill
 * research:
 *   - Opposite-hand batter (e.g. LHB vs RHP): ~1.04 — the standard platoon
 *     advantage all batters enjoy against opposite-handed arms.
 *   - Same-hand batter (e.g. RHB vs RHP):     ~0.96 — the corresponding
 *     disadvantage vs same-handed arms.
 *   - Switch hitters:                         ~1.00 — they turn around to
 *     face opposite-hand, so there's no sustained platoon disadvantage.
 */
const POP_OPP_HAND_RATIO = 1.04;
const POP_SAME_HAND_RATIO = 0.96;
const POP_SWITCH_RATIO = 1.00;

/**
 * Bayesian regression priors for individual platoon-skill deviation. From
 * FanGraphs' hitter platoon skill research (Mitchel Lichtman):
 *   - LHB need ~1000 PA vs LHP for individual split to stabilise.
 *   - RHB need ~2200 PA vs LHP — their true-talent platoon spread is narrow,
 *     so observed splits are mostly noise and get heavy regression.
 *   - SHB: less studied; use a moderate prior.
 *
 * The prior pulls the observed split ratio toward the population ratio. Large
 * priors (RHB) mean we trust the population more; small priors (LHB) mean we
 * trust the observed data sooner.
 */
const PRIOR_LHB = 1000;
const PRIOR_RHB = 2200;
const PRIOR_SHB = 500;

export interface PlatoonTalent {
  /** Regressed xwOBA (or OPS-equivalent) vs the pitcher's hand today. */
  talentVsHand: number | null;
  /** Unit the value is in — drives downstream normalisation. */
  unit: 'xwoba' | 'ops' | null;
  /** Observed OPS in the split, or null when unavailable. */
  observedOPS: number | null;
  /** Observed PA in the split (0 when unknown). */
  observedPA: number;
  /** Regression ratio applied to overall talent (split/overall). */
  regressedRatio: number;
  /** Hand the batter is facing today. */
  facingHand: 'L' | 'R' | null;
}

/**
 * Compute a regressed platoon-adjusted talent value for a batter. Uses
 * observed split OPS relative to the player's overall OPS, regressed
 * toward population platoon norms with handedness-appropriate priors,
 * then scaled onto overall xwOBA when available.
 */
export function getPlatoonAdjustedTalent(
  stats: BatterSeasonStats | null,
  pitcherThrows: 'L' | 'R' | 'S' | undefined,
): PlatoonTalent {
  if (!stats || !pitcherThrows || pitcherThrows === 'S') {
    const unit: PlatoonTalent['unit'] = stats?.xwoba != null ? 'xwoba' : stats?.ops != null ? 'ops' : null;
    return {
      talentVsHand: unit === 'xwoba' ? stats!.xwoba : unit === 'ops' ? stats!.ops : null,
      unit,
      observedOPS: null,
      observedPA: 0,
      regressedRatio: 1.0,
      facingHand: null,
    };
  }

  const facingHand: 'L' | 'R' = pitcherThrows === 'L' ? 'L' : 'R';
  const observedOPS = facingHand === 'L' ? stats.opsVsL : stats.opsVsR;
  const observedPA = facingHand === 'L' ? stats.paVsL : stats.paVsR;
  const overallOPS = stats.ops;
  const overallXwoba = stats.xwoba;

  // Decide the population ratio for this matchup.
  let popRatio: number;
  if (stats.bats === 'S') {
    popRatio = POP_SWITCH_RATIO;
  } else if (stats.bats === facingHand) {
    popRatio = POP_SAME_HAND_RATIO;
  } else if (stats.bats === 'L' || stats.bats === 'R') {
    popRatio = POP_OPP_HAND_RATIO;
  } else {
    popRatio = 1.0; // unknown handedness
  }

  // Prior weight (PA) for regression.
  const prior =
    stats.bats === 'L' ? PRIOR_LHB :
    stats.bats === 'R' ? PRIOR_RHB :
    stats.bats === 'S' ? PRIOR_SHB :
    PRIOR_RHB;

  // Observed ratio — only computable with a real sample and a baseline OPS.
  let observedRatio: number | null = null;
  if (observedOPS != null && overallOPS != null && overallOPS > 0 && observedPA > 0) {
    observedRatio = observedOPS / overallOPS;
  }

  const regressedRatio = observedRatio != null
    ? (observedPA * observedRatio + prior * popRatio) / (observedPA + prior)
    : popRatio;

  // Apply to best-available talent baseline.
  let talentVsHand: number | null = null;
  let unit: PlatoonTalent['unit'] = null;
  if (overallXwoba != null) {
    talentVsHand = overallXwoba * regressedRatio;
    unit = 'xwoba';
  } else if (overallOPS != null) {
    talentVsHand = overallOPS * regressedRatio;
    unit = 'ops';
  }

  return {
    talentVsHand,
    unit,
    observedOPS,
    observedPA,
    regressedRatio,
    facingHand,
  };
}

/**
 * Compute a composite 0–1 "expected value" score for a batter.
 *
 *   Platoon-adjusted talent 0.56 — regressed xwOBA vs this pitcher's hand.
 *                                  Dominant signal: MLB teams actually sit
 *                                  players on the wrong side of a big split.
 *                                  Observed split OPS ratio is regressed
 *                                  toward population platoon norms with
 *                                  handedness-appropriate priors (LHB: 1000
 *                                  PA, RHB: 2200 PA) per FanGraphs research.
 *   Opposing SP              0.22 — tier + direct xwOBA-vs-xwOBA matchup.
 *   Park factor              0.07 — handedness-aware park factor.
 *   SP K-rate                0.05 — secondary pitcher signal, suppresses H/R/RBI.
 *   Luck regression          0.04 — xwOBA − wOBA delta tailwind/headwind.
 *   Career vs SP             0.02 — 20+ PA threshold; research is clear this
 *                                   is mostly noise below ~50 PA.
 *   Weather                  0.02 — wind and temperature extremes.
 *   Bullpen / staff          0.01 — opposing team staff ERA.
 *   Recent form              0.01 — token; short-term hot/cold not predictive.
 */
export function getBatterMatchupScore(
  splits: BatterSplits | null,
  careerVsPitcher: SplitLine | null,
  context: MatchupContext | null,
  bats: 'L' | 'R' | 'S' | undefined,
  baselineOPS: number | null = null,
  batterStats: BatterSeasonStats | null = null,
  battingOrder: number | null = null,
): BatterMatchupScore {
  if (!context) return { score: 0.5, tier: 'neutral', factors: [] };

  const { opposingPitcher, isHome, game, park } = context;
  const xwoba = batterStats?.xwoba ?? null;

  // ── Platoon-adjusted talent ──
  // A single factor that combines baseline talent with the handedness-
  // specific platoon adjustment, regressed toward population platoon norms.
  // This is the biggest single-game signal — who this batter is TODAY vs.
  // who they are on average. Extreme platoon splits (Pederson, Schwarber
  // type profiles) get meaningfully different ratings across hands.
  const platoon = getPlatoonAdjustedTalent(batterStats, opposingPitcher?.throws);
  let ptVal: number;
  let ptAvailable: boolean;
  let ptDisplay: string;
  let ptSummary: string;
  const handLabel = platoon.facingHand === 'L' ? ' vs LHP' : platoon.facingHand === 'R' ? ' vs RHP' : '';

  if (platoon.talentVsHand !== null && platoon.unit === 'xwoba') {
    ptVal = clamp01((platoon.talentVsHand - 0.250) / 0.150);
    ptDisplay = `${fmt3(platoon.talentVsHand)} xwOBA${handLabel}`;
    ptAvailable = true;
  } else if (platoon.talentVsHand !== null && platoon.unit === 'ops') {
    ptVal = clamp01((platoon.talentVsHand - 0.600) / 0.300);
    ptDisplay = `${fmt3(platoon.talentVsHand)} OPS${handLabel}`;
    ptAvailable = true;
  } else if (baselineOPS !== null) {
    // Last-resort: no season stats at all, use caller-provided OPS baseline
    // with only the population platoon ratio applied.
    const popRatio = opposingPitcher?.throws === 'S' || !opposingPitcher
      ? 1.0
      : batterStats?.bats === 'S' ? POP_SWITCH_RATIO
      : batterStats?.bats === opposingPitcher.throws ? POP_SAME_HAND_RATIO
      : POP_OPP_HAND_RATIO;
    const adj = baselineOPS * popRatio;
    ptVal = clamp01((adj - 0.600) / 0.300);
    ptDisplay = `${fmt3(adj)} OPS${handLabel} (est)`;
    ptAvailable = true;
  } else {
    ptVal = 0.4;
    ptAvailable = false;
    ptDisplay = '—';
  }

  // Annotate the summary with sample context — regression-heavy (big popRatio
  // tilt, tiny observedPA) is noted so the user knows the number is leaning
  // on the population prior rather than this specific player.
  const isHeavyRegression = platoon.observedPA < 50 && ptAvailable;
  if (!ptAvailable) ptSummary = 'No talent baseline';
  else if (ptVal >= 0.80) ptSummary = isHeavyRegression ? 'Elite bat (regressed)' : 'Elite bat vs hand';
  else if (ptVal >= 0.60) ptSummary = isHeavyRegression ? 'Strong bat (regressed)' : 'Strong bat vs hand';
  else if (ptVal >= 0.40) ptSummary = 'Average bat vs hand';
  else if (ptVal >= 0.20) ptSummary = 'Weak vs this hand';
  else ptSummary = 'Avoid vs this hand';

  // ── Pitcher matchup (tier + xwOBA head-to-head) ──
  let pitcherVal: number;
  let pitcherAvailable = true;
  let pitcherDisplay: string;
  let pitcherSummary: string;
  const pitcherXwoba = opposingPitcher?.xwoba ?? null;
  if (xwoba !== null && pitcherXwoba !== null) {
    const xwobaDelta = xwoba - pitcherXwoba;
    pitcherVal = clamp01(0.5 + xwobaDelta / 0.160);
    pitcherDisplay = `${fmt3(pitcherXwoba)} xwOBA-a`;
  } else {
    const pitcherTier = opposingPitcher?.quality?.tier;
    if (pitcherTier === 'ace') { pitcherVal = 0.0; pitcherDisplay = 'Ace SP'; }
    else if (pitcherTier === 'tough') { pitcherVal = 0.25; pitcherDisplay = 'Tough SP'; }
    else if (pitcherTier === 'weak') { pitcherVal = 0.75; pitcherDisplay = 'Weak SP'; }
    else if (pitcherTier === 'bad') { pitcherVal = 1.0; pitcherDisplay = 'Bad SP'; }
    else {
      pitcherVal = 0.5;
      pitcherAvailable = !!opposingPitcher;
      pitcherDisplay = opposingPitcher ? 'Average SP' : 'TBD';
    }
  }
  if (!pitcherAvailable) pitcherSummary = 'No probable SP';
  else if (pitcherVal >= 0.70) pitcherSummary = 'Hittable arm';
  else if (pitcherVal >= 0.55) pitcherSummary = 'Favorable SP';
  else if (pitcherVal >= 0.45) pitcherSummary = 'Neutral SP';
  else if (pitcherVal >= 0.30) pitcherSummary = 'Tough SP';
  else pitcherSummary = 'Shutdown SP';

  // ── Pitcher K rate ──
  const kPer9 = opposingPitcher?.strikeoutsPer9 ?? null;
  const kIp = opposingPitcher?.inningsPitched ?? 0;
  const kAvailable = kPer9 !== null && kIp >= 15;
  const kVal = kAvailable
    ? clamp01(1 - (kPer9! - 5.0) / 8.0)
    : 0.5;
  const kDisplay = kAvailable ? `${kPer9!.toFixed(1)} K/9` : (kPer9 !== null ? `${kPer9.toFixed(1)} K/9 (SSS)` : '—');
  const kSummary = !kAvailable ? (kPer9 !== null ? 'Small sample' : 'No K data')
    : kVal >= 0.70 ? 'Low whiff rate'
    : kVal >= 0.55 ? 'Below-avg Ks'
    : kVal >= 0.45 ? 'Avg Ks'
    : kVal >= 0.30 ? 'High K risk'
    : 'Elite K arm';

  // ── Career vs pitcher (20+ PA threshold) ──
  // Research (Elias, FanGraphs) is consistent: BvP under ~50 PA has no
  // predictive edge over the batter's overall line. We keep it as a small
  // token factor above 20 PA — enough for specific-arm mechanical edges
  // (pitch mix, arm angle) to surface without drowning in 6-for-12 noise.
  const cvpAvailable = !!careerVsPitcher && careerVsPitcher.plateAppearances >= 20 && careerVsPitcher.ops !== null;
  const cvpVal = cvpAvailable
    ? norm(careerVsPitcher!.ops, 0.400, 1.000)
    : 0.5;
  const cvpDisplay = !careerVsPitcher || careerVsPitcher.plateAppearances === 0
    ? '—'
    : `${fmt3(careerVsPitcher.ops)} (${careerVsPitcher.plateAppearances} PA)`;
  const cvpSummary = !careerVsPitcher || careerVsPitcher.plateAppearances === 0 ? 'No history'
    : !cvpAvailable ? 'Small sample'
    : cvpVal >= 0.75 ? 'Owns this arm'
    : cvpVal >= 0.55 ? 'Favorable history'
    : cvpVal >= 0.45 ? 'Neutral history'
    : cvpVal >= 0.25 ? 'Struggles vs arm'
    : 'Dominated historically';

  // ── Park factor (handedness-aware) ──
  const pf = bats === 'L' ? park?.parkFactorL
    : bats === 'R' ? park?.parkFactorR
    : park?.parkFactor;
  const parkAvailable = pf != null;
  const parkVal = parkAvailable ? clamp01((pf! - 85) / 30) : 0.5;
  const parkSideLabel = bats === 'L' ? ' (LHB)' : bats === 'R' ? ' (RHB)' : '';
  const parkDisplay = parkAvailable ? `${pf}${parkSideLabel}` : '—';
  const parkSummary = !parkAvailable ? 'No park data'
    : parkVal >= 0.70 ? 'Hitter-friendly park'
    : parkVal >= 0.55 ? 'Slight hitter tilt'
    : parkVal >= 0.45 ? 'Neutral park'
    : parkVal >= 0.30 ? 'Slight pitcher tilt'
    : 'Pitcher-friendly park';

  // ── Luck regression (xwOBA − wOBA delta) ──
  let luckVal = 0.5;
  let luckAvailable = false;
  let luckDisplay = '—';
  let luckSummary = 'No luck data';
  if (batterStats?.xwoba !== null && batterStats?.xwoba !== undefined &&
      batterStats?.woba !== null && batterStats?.woba !== undefined) {
    const luckDelta = batterStats.xwoba - batterStats.woba;
    luckVal = clamp01(0.5 + luckDelta / 0.120);
    luckAvailable = true;
    luckDisplay = `${fmtSignedDelta(luckDelta)} xwOBA−wOBA`;
    if (luckDelta >= 0.030) luckSummary = 'Running unlucky';
    else if (luckDelta >= 0.010) luckSummary = 'Slightly unlucky';
    else if (luckDelta <= -0.030) luckSummary = 'Running lucky';
    else if (luckDelta <= -0.010) luckSummary = 'Slightly lucky';
    else luckSummary = 'Results match quality';
  }

  // ── Staff quality ──
  const opposingTeam = isHome ? game.awayTeam : game.homeTeam;
  const staffEra = opposingTeam.staffEra;
  const staffAvailable = staffEra != null;
  const staffVal = staffAvailable
    ? clamp01(1 - (staffEra! - 3.0) / 2.5)
    : 0.5;
  const staffDisplay = staffAvailable ? `${staffEra!.toFixed(2)} ERA` : '—';
  const staffSummary = !staffAvailable ? 'No staff data'
    : staffVal >= 0.70 ? 'Weak staff'
    : staffVal >= 0.55 ? 'Below-avg staff'
    : staffVal >= 0.45 ? 'Avg staff'
    : staffVal >= 0.30 ? 'Above-avg staff'
    : 'Elite staff';

  // ── Weather (continuous) ──
  const wxVal = getWeatherScore(game, park);
  const wxFlag = getWeatherFlag(game, park);
  const wxDisplay = wxFlag.label || (park?.roof === 'dome' ? 'Dome' : 'Normal');
  const wxAvailable = wxFlag.kind !== 'none' || park?.roof === 'dome' || park?.roof === 'retractable';
  const wxSummary = wxFlag.kind === 'boost' ? 'Offense boost'
    : wxFlag.kind === 'suppress' ? 'Offense suppressed'
    : wxFlag.kind === 'neutral' ? 'Controlled env'
    : 'Neutral conditions';

  // ── Recent form (token weight) ──
  const form = getFormTrend(splits);
  const formVal = form.trend === 'hot' ? 1.0
    : form.trend === 'cold' ? 0.0
    : 0.5;
  const formAvailable = form.trend !== 'unknown';
  const formDisplay = form.detail ?? '—';
  const formSummary = form.trend === 'hot' ? 'Hot'
    : form.trend === 'cold' ? 'Cold'
    : form.trend === 'neutral' ? 'Steady'
    : 'No form data';

  // ── Batting order ──
  // Higher in the order = more PAs, more RBI/R opportunities, better lineup
  // protection. Linear scale: #1 → 1.0, #9 → 0.0. Neutral when unknown.
  const boAvailable = battingOrder !== null && battingOrder >= 1 && battingOrder <= 9;
  const boVal = boAvailable ? 1.0 - (battingOrder! - 1) / 8.0 : 0.5;
  const boDisplay = boAvailable ? `#${battingOrder}` : '—';
  const boSummary = !boAvailable ? 'No lineup data'
    : battingOrder! <= 2 ? 'Top of the order'
    : battingOrder! <= 5 ? 'Middle of the order'
    : 'Bottom of the order';

  // Weight rationale (total = 1.00):
  //
  // Platoon-adjusted talent (56%) — the player's regressed xwOBA vs this
  // pitcher's hand. This is the dominant single-game signal and the one
  // MLB front offices use to make actual start/sit decisions.
  //
  // Opposing SP (22%) — biggest game-day variable after the bat itself.
  // The SP controls the majority of at-bats.
  //
  // Park (6%) — stable environmental signal, handedness-aware.
  // SP K-rate (4%) — secondary pitcher signal; high-K arms suppress H/R/RBI.
  // Batting order (3%) — higher slot = more PAs, better protection.
  // Luck regression (3%) — xwOBA−wOBA delta; mild tailwind/headwind.
  // Career vs SP (2%) — small token at 20+ PA threshold. Research is clear
  // this is mostly noise below ~50 PA, so we keep it small.
  // Weather (2%), staff (1%), form (1%) — tiebreakers.
  //
  // Removed: Day/night (research shows ~zero predictive power).
  const factors: BatterMatchupFactor[] = [
    { key: 'platoonTalent', label: `Talent${handLabel}`,      weight: 0.56, normalized: ptVal,      available: ptAvailable,      display: ptDisplay,      summary: ptSummary },
    { key: 'pitcher',       label: 'Opposing SP',             weight: 0.22, normalized: pitcherVal, available: pitcherAvailable, display: pitcherDisplay, summary: pitcherSummary },
    { key: 'park',          label: 'Park factor',             weight: 0.06, normalized: parkVal,    available: parkAvailable,    display: parkDisplay,    summary: parkSummary },
    { key: 'kRate',         label: 'SP strikeout rate',       weight: 0.04, normalized: kVal,       available: kAvailable,       display: kDisplay,       summary: kSummary },
    { key: 'battingOrder',  label: 'Batting order',           weight: 0.03, normalized: boVal,      available: boAvailable,      display: boDisplay,      summary: boSummary },
    { key: 'luck',          label: 'Luck regression',         weight: 0.03, normalized: luckVal,    available: luckAvailable,    display: luckDisplay,    summary: luckSummary },
    { key: 'career',        label: 'Career vs SP',            weight: 0.02, normalized: cvpVal,     available: cvpAvailable,     display: cvpDisplay,     summary: cvpSummary },
    { key: 'weather',       label: 'Weather',                 weight: 0.02, normalized: wxVal,      available: wxAvailable,      display: wxDisplay,      summary: wxSummary },
    { key: 'staff',         label: 'Bullpen / staff',         weight: 0.01, normalized: staffVal,   available: staffAvailable,   display: staffDisplay,   summary: staffSummary },
    { key: 'form',          label: 'Recent form',             weight: 0.01, normalized: formVal,    available: formAvailable,    display: formDisplay,    summary: formSummary },
  ];

  const score = factors.reduce((acc, f) => acc + f.normalized * f.weight, 0);

  const tier: BatterMatchupScore['tier'] =
    score >= 0.70 ? 'great'
    : score >= 0.55 ? 'good'
    : score >= 0.45 ? 'neutral'
    : score >= 0.30 ? 'poor'
    : 'bad';

  return { score: Math.round(score * 100) / 100, tier, factors };
}

/**
 * Lightweight context-only sort score for ordering the roster list without
 * splits data. Uses pitcher quality, park factor, team staff ERA, pitcher
 * K rate, and weather — the external matchup conditions available immediately
 * from the game-day API. Returns 0.5 when no context exists.
 */
export function getBatterContextScore(
  context: MatchupContext | null,
  bats?: 'L' | 'R' | 'S',
): number {
  if (!context) return 0.5;
  const { opposingPitcher, isHome, game, park } = context;

  const pitcherTier = opposingPitcher?.quality?.tier;
  const pitcherVal = pitcherTier === 'ace' ? 0.0
    : pitcherTier === 'tough' ? 0.25
    : pitcherTier === 'weak' ? 0.75
    : pitcherTier === 'bad' ? 1.0
    : 0.5;

  // Use xERA when available (Savant bip ≥ 10 gate enforced upstream).
  // Fall back to actual ERA only when IP ≥ 25 — raw ERA is noise at small samples.
  const effectiveEra = opposingPitcher?.xera
    ?? (opposingPitcher?.inningsPitched != null && opposingPitcher.inningsPitched >= 25
      ? opposingPitcher.era
      : null);
  const eraVal = effectiveEra !== null
    ? clamp01(1 - (effectiveEra - 2.0) / 4.0)
    : 0.5;

  const pf = bats === 'L' ? park?.parkFactorL
    : bats === 'R' ? park?.parkFactorR
    : park?.parkFactor;
  const parkVal = pf != null ? clamp01((pf - 85) / 30) : 0.5;

  const opposingTeam = isHome ? game.awayTeam : game.homeTeam;
  const staffEra = opposingTeam.staffEra;
  const staffVal = staffEra != null
    ? clamp01(1 - (staffEra - 3.0) / 2.5)
    : 0.5;

  // Pitcher K rate — high K/9 = bad for batters
  const kPer9 = opposingPitcher?.strikeoutsPer9 ?? null;
  const kVal = kPer9 !== null
    ? clamp01(1 - (kPer9 - 5.0) / 8.0)
    : 0.5;

  const wxVal = getWeatherScore(game, park);

  return pitcherVal * 0.30 + eraVal * 0.15 + kVal * 0.15 + parkVal * 0.12 + staffVal * 0.15 + wxVal * 0.13;
}

// ---------------------------------------------------------------------------
// Weather scoring + notability
// ---------------------------------------------------------------------------

/**
 * Compute a continuous 0–1 weather score for the composite matchup model.
 *
 * Combines wind and temperature effects with magnitude scaling:
 * - Wind out: scaled linearly from 10→25 mph (0.6→1.0)
 * - Wind in:  scaled linearly from 10→25 mph (0.4→0.0)
 * - Temp ≥ 80°F: slight boost, scaling up to 0.7 at 100°F
 * - Temp ≤ 55°F: slight suppression, scaling down to 0.3 at 35°F
 * - Dome with no weather data: 0.5 (neutral)
 *
 * Wind dominates when both wind and temperature are extreme because the
 * wind effect is larger and more researched.
 */
export function getWeatherScore(game: MLBGame, park: ParkData | null): number {
  if (park && (park.roof === 'dome' || park.roof === 'retractable')) {
    if (!game.weather.wind && !game.weather.temperature) {
      return 0.5; // controlled environment
    }
  }

  const { temperature, windSpeed, windDirection } = game.weather;
  let score = 0.5;

  // Wind effect (overrides temperature when present — larger effect size)
  if (windSpeed !== null && windSpeed >= 10 && windDirection) {
    const dir = windDirection.toLowerCase();
    if (dir.includes('out')) {
      // 10 mph out → 0.6, 25 mph out → 1.0
      score = clamp01(0.5 + (windSpeed - 5) / 40);
    } else if (dir.includes('in')) {
      // 10 mph in → 0.4, 25 mph in → 0.0
      score = clamp01(0.5 - (windSpeed - 5) / 40);
    }
    // Crosswinds: stay at 0.5 (ambiguous effect)
  }

  // Temperature effect — additive nudge on top of wind
  if (temperature !== null) {
    if (temperature >= 80) {
      // 80°F → +0.02, 100°F → +0.10
      score += clamp01((temperature - 80) / 200) * 0.5;
    } else if (temperature <= 55) {
      // 55°F → −0.02, 35°F → −0.10
      score -= clamp01((55 - temperature) / 200) * 0.5;
    }
  }

  return clamp01(score);
}

export interface WeatherFlag {
  kind: 'boost' | 'suppress' | 'neutral' | 'none';
  label: string;
}

export function getWeatherFlag(game: MLBGame, park: ParkData | null): WeatherFlag {
  if (park && (park.roof === 'dome' || park.roof === 'retractable')) {
    if (!game.weather.wind && !game.weather.temperature) {
      return { kind: 'neutral', label: 'Dome' };
    }
  }

  const { temperature, windSpeed, windDirection } = game.weather;

  if (windSpeed !== null && windSpeed >= 10 && windDirection) {
    const dir = windDirection.toLowerCase();
    if (dir.includes('out')) {
      return { kind: 'boost', label: `${windSpeed}mph out` };
    }
    if (dir.includes('in')) {
      return { kind: 'suppress', label: `${windSpeed}mph in` };
    }
  }

  if (temperature !== null) {
    if (temperature >= 90) return { kind: 'boost', label: `${temperature}°F hot` };
    if (temperature <= 50) return { kind: 'suppress', label: `${temperature}°F cold` };
  }

  return { kind: 'none', label: '' };
}
