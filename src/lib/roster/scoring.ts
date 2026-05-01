/**
 * Talent-adjusted category scoring for roster decisions.
 *
 * Roster moves are 3-month decisions: what matters is a player's true
 * talent level, not the noise in their last three weeks of box scores.
 * This module regresses each chased category to a Bayesian blend of
 * current-season + prior-season + league-mean (per-PA), then normalises
 * each category onto a 0-1 scale so scores sum comparably.
 *
 * All per-category config lives in `src/lib/mlb/categoryBaselines.ts`,
 * which is also consumed by the lineup/matchup rating so the two surfaces
 * agree on "what's elite vs floor" for each stat.
 */

import type { BatterSeasonStats, PlayerStatLine } from '@/lib/mlb/types';
import { toBatterSeasonStats } from '@/lib/mlb/adapters';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import {
  blendedBaselineForCategory,
  normalizeRate,
  supportsStatId,
} from '@/lib/mlb/categoryBaselines';

/**
 * Migration-era helper. Accepts either the new stratified `PlayerStatLine`
 * or the legacy flat `BatterSeasonStats` and returns the flat shape that
 * the existing scoring math operates on. New code in this file targets
 * `PlayerStatLine`; the adapter keeps existing call-sites working.
 */
function asBatterStats(
  input: PlayerStatLine | BatterSeasonStats | null,
): BatterSeasonStats | null {
  if (!input) return null;
  // PlayerStatLine has an `identity` block; BatterSeasonStats has `mlbId`
  // at the top level. Use that to discriminate without extra metadata.
  if ('identity' in input) return toBatterSeasonStats(input);
  return input;
}

export { supportsStatId };

/**
 * Return the Bayesian-blended per-PA rate (or native rate for AVG) for one
 * category. Returns null if the stat isn't supported.
 *
 * Accepts either the new `PlayerStatLine` or the legacy `BatterSeasonStats`
 * during migration.
 */
export function blendedRateForCategory(
  stats: PlayerStatLine | BatterSeasonStats,
  statId: number,
): number | null {
  const flat = asBatterStats(stats);
  if (!flat) return null;
  const baseline = blendedBaselineForCategory(flat, statId);
  return baseline ? baseline.rate : null;
}

/**
 * Compute a talent-adjusted score summed across the given categories,
 * tilted toward current-season Statcast quality of contact.
 *
 * Three components:
 *
 *  1. **Category score** (existing): Bayesian-blended per-PA rates for each
 *     league-defined category, summed. Heavy past-weight by design — keeps
 *     April small samples from going off the rails.
 *
 *  2. **Quality bonus** (`statcastQualityScore`): normalises a current-tilted
 *     blend of xwOBA so a hot start with quality contact gets credit the
 *     strict Bayesian talent model would smooth away. See helper for the
 *     blending math.
 *
 *  3. **Rising bonus** (`risingBonus`): explicit bump when current xwOBA
 *     materially exceeds prior-only talent xwOBA, with a minimum BIP gate.
 *     This is the "skill genuinely up, not BABIP luck" signal — picks up
 *     hitters whose underlying contact has stepped forward this year.
 *
 * The bonuses are weighted relative to the category total so they tilt
 * rankings without overwhelming the categories. See QUALITY_WEIGHT_FACTOR
 * and RISING_WEIGHT_FACTOR for the calibration knobs.
 *
 * `ptf` (playing-time factor, 0..1) multiplies the whole thing so part-time
 * bats stay dampened relative to everyday regulars.
 */

/** Quality bonus contribution, as a fraction of categories.length.
 *  At 0.4, max possible quality bonus is ~40% of the max category sum,
 *  meaning quality can account for ~28% of the final score. */
const QUALITY_WEIGHT_FACTOR = 0.4;

/** Rising bonus contribution, as a fraction of categories.length.
 *  At 0.15, max possible rising bonus is ~15% of the max category sum
 *  — small enough that it tilts close calls without dominating. */
const RISING_WEIGHT_FACTOR = 0.15;

/** Multiplier applied to a category's normalised contribution when the
 *  user has marked it as `chase`. 2× lets a chased category roughly
 *  double-count without entirely overwhelming the rest of the line. */
const CHASE_WEIGHT = 2.0;

export type CategoryFocus = 'neutral' | 'chase' | 'punt';

export function blendedCategoryScore(
  input: PlayerStatLine | BatterSeasonStats | null,
  categories: EnrichedLeagueStatCategory[],
  ptf: number = 1,
  isOnIL: boolean = false,
  focusMap: Record<number, CategoryFocus> = {},
): number {
  const stats = asBatterStats(input);
  if (!stats || categories.length === 0) return 0;
  let score = 0;
  for (const cat of categories) {
    // User focus on this category: punt → skip entirely (the user
    // doesn't care, so don't credit the player for it); chase → weight
    // double so candidates strong in the chased cat surface above
    // those who win on punted cats.
    const focus = focusMap[cat.stat_id] ?? 'neutral';
    if (focus === 'punt') continue;
    const rate = blendedRateForCategory(stats, cat.stat_id);
    if (rate === null) continue;
    const weight = focus === 'chase' ? CHASE_WEIGHT : 1.0;
    score += normalizeRate(rate, cat.stat_id, cat.betterIs) * weight;
  }

  // Quality is gated on current-year contact for healthy players: no
  // current BIP → no Statcast credit, since the prior-heavy talent xwOBA
  // would otherwise inflate a benched / demoted vet who isn't actually
  // generating contact this year. IL players are exempt because their
  // prior xwOBA *is* the relevant signal — we're pricing in what they
  // bring back when they return.
  const qualityGate = isOnIL
    ? 1
    : Math.min(1, stats.xwobaCurrentBip / QUALITY_BIP_GATE);
  const quality = statcastQualityScore(stats) * qualityGate;

  // Rising requires real current-year role. A part-time vet with 50 BIP
  // and a hot 30-PA stretch shouldn't trigger the bonus on top of his
  // already-elite prior. Gate on current PA so we only celebrate
  // breakouts from players actually playing.
  const rising = stats.pa >= RISING_MIN_CURRENT_PA ? risingBonus(stats) : 0;

  score += quality * categories.length * QUALITY_WEIGHT_FACTOR;
  score += rising * categories.length * RISING_WEIGHT_FACTOR;
  return score * ptf;
}

/** BIP threshold at which the quality bonus reaches full weight for
 *  healthy players. Below this, quality is linearly dampened toward 0
 *  so the prior-heavy talent xwOBA can't carry a player who isn't
 *  actually making contact this year. */
const QUALITY_BIP_GATE = 40;

/** Minimum current PA before the rising bonus can fire. ~80 PA ≈ three
 *  weeks of regular play — enough role to call any underlying skill jump
 *  meaningful. Below this, rising signals are noise. */
const RISING_MIN_CURRENT_PA = 80;

// ---------------------------------------------------------------------------
// Statcast quality / rising bonuses
// ---------------------------------------------------------------------------

/**
 * Lower / upper xwOBA bounds for the 0-1 Quality normalisation.
 * .290 ≈ replacement-level offence; .380 ≈ MVP-tier. Values outside the
 * window clamp at 0 or 1.
 */
const QUALITY_XWOBA_LO = 0.290;
const QUALITY_XWOBA_HI = 0.380;

/** Maximum weight given to the raw current-season xwOBA in the Quality
 *  blend. Capped below 1 so a tiny BIP can never *fully* override the
 *  talent estimate, but high enough that a real hot stretch shines. */
const QUALITY_MAX_CURRENT_WEIGHT = 0.7;
/** BIP at which current-season xwOBA reaches `QUALITY_MAX_CURRENT_WEIGHT`.
 *  ~80 BIP ≈ four weeks of regular play. */
const QUALITY_BIP_FULL_WEIGHT = 80;

/**
 * 0-1 quality-of-contact score that intentionally over-weights
 * current-season xwOBA relative to the strict Bayesian talent model.
 * A player with elite current xwOBA over a real sample (e.g. 60-80 BIP)
 * gets near-full credit even if his talent xwOBA is being dragged down
 * by a stale prior season. Returns 0 when we have neither current nor
 * talent xwOBA on hand.
 */
export function statcastQualityScore(input: PlayerStatLine | BatterSeasonStats): number {
  const stats = asBatterStats(input);
  if (!stats) return 0;
  const current = stats.xwobaCurrent;
  const talent = stats.xwoba;
  if (current === null && talent === null) return 0;

  // Current weight ramps from 0 (no BIP) to QUALITY_MAX_CURRENT_WEIGHT
  // around QUALITY_BIP_FULL_WEIGHT. Below 80 BIP we still mostly trust
  // the regressed talent figure; above it we lean current-heavy.
  const currentWeight =
    current === null
      ? 0
      : Math.min(QUALITY_MAX_CURRENT_WEIGHT, stats.xwobaCurrentBip / QUALITY_BIP_FULL_WEIGHT);
  const talentWeight = talent === null ? 0 : 1 - currentWeight;

  let blended: number;
  if (currentWeight === 0) {
    blended = talent!;
  } else if (talentWeight === 0) {
    blended = current!;
  } else {
    blended = current! * currentWeight + talent! * talentWeight;
  }

  const norm = (blended - QUALITY_XWOBA_LO) / (QUALITY_XWOBA_HI - QUALITY_XWOBA_LO);
  return Math.max(0, Math.min(1, norm));
}

/** Minimum current-season BIP before we'll trust the rising delta —
 *  smaller samples are just noise. ~30 BIP ≈ two weeks of regular play. */
const RISING_MIN_BIP = 30;
/** Threshold delta (current xwOBA − prior talent xwOBA) below which the
 *  bonus is zero. .020 of wOBA is roughly a 1-tier improvement. */
const RISING_DELTA_FLOOR = 0.020;
/** Delta at which the bonus saturates at 1.0. .080 = a 4-tier jump
 *  (e.g. average → MVP) — not realistic season-over-season but gives
 *  the bonus a smooth ramp through the realistic range. */
const RISING_DELTA_CEIL = 0.080;

/**
 * 0-1 bump that fires when current-season xwOBA meaningfully exceeds
 * the player's prior-only talent xwOBA. This is the explicit "rising"
 * signal — a player whose underlying skill has genuinely stepped
 * forward this year, not just a fluky hot stretch.
 *
 * Returns 0 when:
 *   - no current xwOBA or no prior talent baseline
 *   - current sample is below `RISING_MIN_BIP`
 *   - delta is below `RISING_DELTA_FLOOR`
 */
export function risingBonus(input: PlayerStatLine | BatterSeasonStats): number {
  const stats = asBatterStats(input);
  if (!stats) return 0;
  if (stats.xwobaCurrent === null || stats.xwobaTalentPrior === null) return 0;
  if (stats.xwobaCurrentBip < RISING_MIN_BIP) return 0;
  const delta = stats.xwobaCurrent - stats.xwobaTalentPrior;
  if (delta <= RISING_DELTA_FLOOR) return 0;
  return Math.max(0, Math.min(1, (delta - RISING_DELTA_FLOOR) / (RISING_DELTA_CEIL - RISING_DELTA_FLOOR)));
}

// ---------------------------------------------------------------------------
// Playing-time factor
// ---------------------------------------------------------------------------
//
// Per-PA rates tell you *how good* a player is when he bats; they say nothing
// about *how often* he bats. A 4th outfielder with elite prior-year per-PA
// rates still won't contribute 2 HR and 3 SB in a week if he starts twice.
// This factor scales the blended category score by the player's expected
// workload relative to a full-time regular (1.0 = everyday starter).
//
// Signals:
//   - Current-season PA  vs `fullTimePaceRef` (≈ p90 PA across the pool)
//   - Current-season GP  vs `fullTimeGpRef`   (≈ p90 GP across the pool)
//   - Prior-season PA    vs FULL_TIME_PRIOR_PA (600)
//   - Prior-season GP    vs FULL_TIME_PRIOR_GP (140)
//   - PA / GP            (≥ 3.5 → regular starter minutes when in lineup)
//
// Blending: Bayesian with weights ~40. At 0 current PA, PTF = prior share.
// At 40+ current PA, the two sources contribute roughly equally.
//
// IL-stint detection (the "Soto is back" case): when the player's
// prior-year role was regular (GP share ≥ 0.8) but his current-year GP
// share is well below full-time AND his PA-per-GP is full-time starter
// level, we infer he missed a block of games to injury and fall back to
// prior-year share — even if he's no longer flagged IL by Yahoo. This
// correctly handles both:
//   - Currently on IL (Polanco)  → `isOnIL` path, prior only.
//   - Just off IL, playing daily (Soto) → inferred stint, prior only.
//   - True part-time role (Rojas/Hill/McLain) → low PA/GP, not flagged,
//     standard blend pulls them down.
// As the returnee accumulates current-season PA post-return, his current
// GP share climbs back toward full-time and the inferred stint resolves,
// so the blend naturally takes over.

const FULL_TIME_PRIOR_PA = 600;
const FULL_TIME_PRIOR_GP = 140;
const ROOKIE_DEFAULT_PTF = 0.5;
const MIN_PTF = 0.15;
/** League pace (p90 PA) below which we're in true early-season territory
 *  and current samples are too thin to trust. Above this we use
 *  currentShare directly. */
const EARLY_SEASON_PACE_THRESHOLD = 30;

// IL-stint heuristic thresholds.
const IL_STINT_PRIOR_GP_SHARE = 0.8;     // was a regular last year
const IL_STINT_CURRENT_GP_SHARE = 0.7;   // has played materially fewer games
const IL_STINT_MIN_PA_PER_GP = 3.5;      // when he plays, he plays full games
const IL_STINT_MIN_PERCENT_OWNED = 35;   // market still values him → probably IL,
                                         // not a demotion (Goldschmidt check).

export interface PlayingTimeContext {
  /** League-wide full-time pace reference (≈ p90 of current-season PA
   *  across the batter pool). Use `estimateFullTimePaceRef()`. When 0,
   *  the factor falls back to prior-year share only. */
  fullTimePaceRef: number;
  /** League-wide full-time GP reference (≈ p90 of current-season GP).
   *  Use `estimateFullTimeGpRef()`. Used for IL-stint detection. When 0,
   *  detection is skipped and only the PA blend is used. */
  fullTimeGpRef?: number;
  /** True when the player is on IL / disabled list. Current-season stats
   *  are then ignored and the factor is driven by prior-year workload. */
  isOnIL?: boolean;
  /** Yahoo `percent_owned`. Used as a sanity guard on the inferred-IL-stint
   *  path: a former regular who's been widely dropped by the league is more
   *  likely demoted (Goldschmidt-style) than injured (Soto-style). When
   *  `undefined`, the guard is skipped and the heuristic behaves as before. */
  percentOwned?: number;
}

/**
 * Compute a playing-time factor in [MIN_PTF, 1] suitable for multiplying
 * the blended category score. Returns 1 when we have no signal at all
 * (conservative no-op) so callers never accidentally zero out a player.
 */
export function playingTimeFactor(
  input: PlayerStatLine | BatterSeasonStats | null,
  ctx: PlayingTimeContext,
): number {
  const stats = asBatterStats(input);
  if (!stats) return 1;

  const priorPA = stats.priorSeason?.pa ?? 0;
  const priorGP = stats.priorSeason?.gp ?? 0;
  const priorPAShare = priorPA > 0 ? Math.min(1, priorPA / FULL_TIME_PRIOR_PA) : null;
  const priorGPShare = priorGP > 0 ? Math.min(1, priorGP / FULL_TIME_PRIOR_GP) : null;

  if (ctx.isOnIL) {
    return priorPAShare ?? ROOKIE_DEFAULT_PTF;
  }

  const pace = ctx.fullTimePaceRef;
  if (!pace || pace <= 0) {
    return priorPAShare ?? ROOKIE_DEFAULT_PTF;
  }

  // IL-stint inference: a regular last year who's missed games this year
  // but plays full games when in the lineup is almost likely an IL
  // returnee. But we also need to rule out the aging-vet-demotion case
  // (Goldschmidt 2026 — full-time last year, now a sparsely-used bench bat,
  // still bats 4 times when he starts) which looks identical on stats
  // alone. We use Yahoo's `percent_owned` as the tie-breaker: owners keep
  // rostering IL'd studs (Soto stays ~85% owned); they cut demoted vets
  // fast (Goldschmidt dropped to 2% in the screenshot). When the market
  // has already walked away, trust the current-season role *and* apply
  // a hard demotion penalty — without it the standard blend still gives
  // prior PA roughly equal weight at small currentPA, leaving a benched
  // vet looking like a 0.66 PTF when his role share is closer to 0.30.
  const gpRef = ctx.fullTimeGpRef ?? 0;
  const marketStillValues =
    ctx.percentOwned === undefined ||
    ctx.percentOwned >= IL_STINT_MIN_PERCENT_OWNED;
  const ilStintShape =
    priorGPShare !== null &&
    priorGPShare >= IL_STINT_PRIOR_GP_SHARE &&
    gpRef > 0 &&
    stats.gp > 0 &&
    stats.gp / gpRef < IL_STINT_CURRENT_GP_SHARE &&
    stats.pa / stats.gp >= IL_STINT_MIN_PA_PER_GP;

  if (ilStintShape && marketStillValues) {
    return priorPAShare ?? ROOKIE_DEFAULT_PTF;
  }

  const currentShare = Math.min(1, stats.pa / pace);

  // Early-season fallback: when the league as a whole has barely played,
  // every player's currentShare is unreliable noise. Trust prior role
  // until the season matures.
  if (pace < EARLY_SEASON_PACE_THRESHOLD && priorPAShare !== null) {
    return priorPAShare;
  }

  if (priorPAShare === null) {
    // Rookie / no prior history — lean on the current pace once it's
    // meaningfully stable, otherwise default to a conservative rookie PTF.
    if (stats.pa < 20) return ROOKIE_DEFAULT_PTF;
    return Math.max(MIN_PTF, currentShare);
  }

  // Mature season: trust currentShare directly. This naturally captures
  // demoted vets (currentShare ≈ actual role), part-timers, and freshly-
  // dropped players who never accumulated real PA — without needing a
  // separate demotion penalty or blend weight. The IL-stint and IL-flag
  // branches above already protect Soto-style returnees and stash
  // candidates, so the only remaining cases are players whose current
  // role IS their best predictor of going-forward role.
  return Math.max(MIN_PTF, currentShare);
}

/**
 * Estimate the "full-time pace" reference for the current season from a
 * list of batter stats. Uses the 90th percentile of non-zero current-season
 * PA so a few outliers (hot-start leadoff types) don't distort the baseline
 * and benched players don't pull it down. Returns 0 when the pool is empty
 * or no one has batted yet (Opening Day); callers should treat 0 as "fall
 * back to prior-year share".
 */
export function estimateFullTimePaceRef(
  inputs: Array<PlayerStatLine | BatterSeasonStats>,
): number {
  const paList = inputs
    .map(input => asBatterStats(input)?.pa ?? 0)
    .filter(pa => pa > 0)
    .sort((a, b) => a - b);
  if (paList.length === 0) return 0;
  const idx = Math.min(paList.length - 1, Math.floor(paList.length * 0.9));
  return paList[idx];
}

/**
 * Estimate the "full-time games played" reference (p90 of current-season
 * GP across the batter pool). Used by the IL-stint heuristic to decide
 * whether a player's missed games look like a block (injury) or just a
 * part-time role. Returns 0 when the pool is empty.
 */
export function estimateFullTimeGpRef(
  inputs: Array<PlayerStatLine | BatterSeasonStats>,
): number {
  const gpList = inputs
    .map(input => asBatterStats(input)?.gp ?? 0)
    .filter(gp => gp > 0)
    .sort((a, b) => a - b);
  if (gpList.length === 0) return 0;
  const idx = Math.min(gpList.length - 1, Math.floor(gpList.length * 0.9));
  return gpList[idx];
}
