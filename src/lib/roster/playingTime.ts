/**
 * Playing-time factor — the role-share model for batters.
 *
 * Per-PA rates tell you *how good* a player is when he bats; they say
 * nothing about *how often* he bats. This factor scales weekly volume by
 * the player's expected workload relative to a full-time regular
 * (1.0 = everyday starter). Consumed by the L6 forecast route (per-player
 * neutral-week values + RUPM inputs). Extracted from `roster/scoring.ts`
 * when `blendedCategoryScore` was retired — see
 * [docs/roster-value-proposal.md](../../../docs/roster-value-proposal.md).
 *
 * Signals:
 *   - Current-season PA  vs `fullTimePaceRef` (~p90 PA across the pool)
 *   - Current-season GP  vs `fullTimeGpRef`   (~p90 GP across the pool)
 *   - Prior-season PA/GP vs full-time constants
 *   - IL-stint inference (the "Soto is back" case) with a percent-owned
 *     market guard against the demoted-vet false positive.
 */

import type { BatterSeasonStats, PlayerStatLine } from '@/lib/mlb/types';
import { toBatterSeasonStats } from '@/lib/mlb/adapters';

function asBatterStats(
  input: PlayerStatLine | BatterSeasonStats | null,
): BatterSeasonStats | null {
  if (!input) return null;
  if ('identity' in input) return toBatterSeasonStats(input);
  return input;
}
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
