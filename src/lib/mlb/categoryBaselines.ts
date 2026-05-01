/**
 * Per-category Bayesian baseline configuration — shared by:
 *   - `src/lib/roster/scoring.ts` (multi-week roster decisions, no matchup)
 *   - `src/lib/mlb/batterRating.ts` (single-game matchup rating)
 *
 * Each config entry knows how to:
 *   1. Extract the current-season rate from `BatterSeasonStats` and the
 *      prior-season rate from the optional `priorSeason` block.
 *   2. Blend current + prior + league mean using Bayesian regression
 *      (via the shared `blendRate` helper), with per-stat stabilisation
 *      priors drawn from sabermetric literature.
 *   3. Normalise the blended rate onto a 0-1 scale using a (floor, elite)
 *      window so contributions across categories are comparable.
 *
 * This is the canonical mapping of Yahoo batter `stat_id` → per-PA rate.
 * Adding a new category is a one-entry change here; both the roster
 * scoring and the lineup rating pick it up automatically.
 */

import { blendRate } from './talentModel';
import type { BatterSeasonStats } from './types';

export type CategoryStatId = 3 | 7 | 8 | 12 | 13 | 16 | 18 | 21;

export interface CategoryBaselineConfig {
  /** Short display label (e.g. "AVG", "HR"). */
  label: string;
  /** League-average rate (per PA, or native rate for AVG). */
  leagueMean: number;
  /** Regression strength — larger = heavier pull toward league mean. */
  leaguePriorN: number;
  /** Cap on prior-season PA so stale years don't over-count. Tighter for
   *  fast-stabilising stats (K%) where a diverging current sample is meaningful. */
  priorCap: number;
  /** Pull the current per-PA rate (or native rate for AVG). */
  getCurrent: (s: BatterSeasonStats) => number | null;
  /** Pull the prior per-PA rate (or native rate for AVG). */
  getPrior: (p: NonNullable<BatterSeasonStats['priorSeason']>) => number | null;
  /** (floor, elite) rate bounds for 0-1 normalisation. Clamped. */
  normRange: [number, number];
  /** Which direction is "good"? AVG/HR/R/RBI/SB/BB/H higher = better; K lower = better. */
  betterIs: 'higher' | 'lower';
}

/**
 * Per-category config. Bounds chosen so elite (top-20-ish) players normalise
 * near 1.0 and clearly-below-average normalise near 0. League means pulled
 * from 2024 MLB rates.
 *
 * Priors are tuned for *predictive* fantasy decisions (3-week horizon),
 * not strict true-talent estimation. True-talent stabilisation for AVG is
 * famously slow (~910 PA), so a Bayesian-strict prior would smooth out
 * even 200 current PA. For roster decisions we want current performance
 * over a real sample to genuinely move the rank — a guy hitting .178
 * over 50 PA should not be projected as a .240 hitter just because that's
 * his career line. The priors here are roughly half the true-talent
 * stabilisation point, splitting the difference between "pure current"
 * (overreacts to small samples) and "pure prior" (ignores what's actually
 * happening this year).
 */
export const CATEGORY_BASELINE_CONFIG: Record<number, CategoryBaselineConfig> = {
  3: { // AVG
    label: 'AVG',
    leagueMean: 0.243,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => s.avg,
    getPrior: p => p.avg,
    normRange: [0.220, 0.300],
    betterIs: 'higher',
  },
  7: { // R
    label: 'R',
    leagueMean: 0.115,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.runs / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.runs / p.pa : null),
    normRange: [0.090, 0.155],
    betterIs: 'higher',
  },
  8: { // H
    label: 'H',
    leagueMean: 0.215,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.hits / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.hits / p.pa : null),
    normRange: [0.195, 0.265],
    betterIs: 'higher',
  },
  12: { // HR
    label: 'HR',
    leagueMean: 0.028,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.hr / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.hr / p.pa : null),
    normRange: [0.015, 0.055],
    betterIs: 'higher',
  },
  13: { // RBI
    label: 'RBI',
    leagueMean: 0.110,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.rbi / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.rbi / p.pa : null),
    normRange: [0.085, 0.155],
    betterIs: 'higher',
  },
  16: { // SB
    label: 'SB',
    leagueMean: 0.010,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.sb / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.sb / p.pa : null),
    normRange: [0.005, 0.050],
    betterIs: 'higher',
  },
  18: { // BB — stabilises ~120 PA
    label: 'BB',
    leagueMean: 0.084,
    leaguePriorN: 80,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.walks / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.walks / p.pa : null),
    normRange: [0.055, 0.140],
    betterIs: 'higher',
  },
  21: { // K — stabilises ~60 PA; tighter prior cap so a diverging current K% isn't drowned
    label: 'K',
    leagueMean: 0.223,
    leaguePriorN: 50,
    priorCap: 150,
    getCurrent: s => (s.pa > 0 ? s.strikeouts / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.strikeouts / p.pa : null),
    normRange: [0.140, 0.300],
    betterIs: 'lower',
  },
  23: { // TB — total bases per PA. League-mean TB/PA ≈ AVG × bases-per-hit ×
        // AB/PA → roughly 0.34 in 2024 MLB. Elite power+contact hitters land
        // near 0.50; punchless hitters near 0.25.
    label: 'TB',
    leagueMean: 0.340,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.totalBases / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.totalBases / p.pa : null),
    normRange: [0.260, 0.470],
    betterIs: 'higher',
  },
};

export function supportsStatId(statId: number): boolean {
  return statId in CATEGORY_BASELINE_CONFIG;
}

export interface BlendedBaseline {
  /** Bayesian-blended per-PA rate (or native rate for AVG). */
  rate: number;
  /** Effective sample size behind the estimate (current + capped prior). */
  effectivePA: number;
}

/**
 * Bayesian-blended per-PA (or native) rate for one category. Returns null
 * when the stat isn't in the baseline config.
 */
export function blendedBaselineForCategory(
  stats: BatterSeasonStats,
  statId: number,
): BlendedBaseline | null {
  const cfg = CATEGORY_BASELINE_CONFIG[statId];
  if (!cfg) return null;
  const cur = cfg.getCurrent(stats);
  const prior = stats.priorSeason ? cfg.getPrior(stats.priorSeason) : null;
  const result = blendRate({
    current: cur,
    currentN: stats.pa,
    prior,
    priorN: stats.priorSeason?.pa ?? 0,
    leagueMean: cfg.leagueMean,
    leaguePriorN: cfg.leaguePriorN,
    priorCap: cfg.priorCap,
  });
  return { rate: result.value, effectivePA: result.effectiveN };
}

/**
 * Normalise a rate onto 0-1 using the category's (floor, elite) window.
 * Caller supplies `betterIs` because roster and matchup pipelines may
 * flip the sign of a category independently (e.g. K is "good" in an
 * AVG-chaser context but "bad" in the rating composite).
 */
export function normalizeRate(
  rate: number,
  statId: number,
  betterIs: 'higher' | 'lower',
): number {
  const cfg = CATEGORY_BASELINE_CONFIG[statId];
  if (!cfg) return 0;
  const [lo, hi] = cfg.normRange;
  if (hi <= lo) return 0;
  let norm = (rate - lo) / (hi - lo);
  if (betterIs === 'lower') norm = 1 - norm;
  return Math.max(0, Math.min(1, norm));
}
