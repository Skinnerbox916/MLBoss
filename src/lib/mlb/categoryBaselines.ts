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
 * For batters with sufficient Savant sample, the talent-derived rate
 * (xBA, regressed K%/BB%) takes precedence over the raw-rate blend on
 * cats with strong Statcast signal (AVG / H / K / BB). This is the
 * canonical path described in [docs/unified-rating-model.md] — raw
 * blend remains as a fallback for thin-sample / no-Savant players.
 *
 * This is the canonical mapping of Yahoo batter `stat_id` → per-PA rate.
 * Adding a new category is a one-entry change here; both the roster
 * scoring and the lineup rating pick it up automatically.
 */

import { blendRate } from './talentModel';
import type { BatterSeasonStats } from './types';

export type CategoryStatId = 3 | 7 | 8 | 10 | 11 | 12 | 13 | 16 | 18 | 20 | 21 | 23;

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
  3: { // AVG — leagueMean refreshed 2026 mid-season from MLB Stats API
       //       (was 0.243 from 2024; reality is ~0.239 in 2026).
    label: 'AVG',
    leagueMean: 0.239,
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
  8: { // H — leagueMean refreshed 2026 (was 0.215).
    label: 'H',
    leagueMean: 0.212,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.hits / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.hits / p.pa : null),
    normRange: [0.195, 0.265],
    betterIs: 'higher',
  },
  10: { // 2B — doubles per PA. League ~0.044 (MLB ~8.2k doubles / ~185k PA).
        //      Optional-field getters: `doubles` is absent on stale cached
        //      lines; null routes the blend to prior + league mean.
    label: '2B',
    leagueMean: 0.044,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 && typeof s.doubles === 'number' ? s.doubles / s.pa : null),
    getPrior: p => (p.pa > 0 && typeof p.doubles === 'number' ? p.doubles / p.pa : null),
    normRange: [0.025, 0.070],
    betterIs: 'higher',
  },
  11: { // 3B — triples per PA. Rare, speed/park-driven; league ~0.0045.
        //      Tight prior (stabilises slowly, but the absolute rates are
        //      tiny — the blend mostly separates the 8-triple burners from
        //      the zeros).
    label: '3B',
    leagueMean: 0.0045,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 && typeof s.triples === 'number' ? s.triples / s.pa : null),
    getPrior: p => (p.pa > 0 && typeof p.triples === 'number' ? p.triples / p.pa : null),
    normRange: [0, 0.015],
    betterIs: 'higher',
  },
  12: { // HR — leagueMean refreshed 2026 (was 0.028). HR rates have
        //      compressed; the 2026 league HR/PA is ~0.0275.
    label: 'HR',
    leagueMean: 0.0275,
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
  20: { // HBP — hit-by-pitch per PA. League ~0.009; plate-crowders run
        //      3x that and the trait is among the most persistent batter
        //      skills year-to-year. Included for points leagues (2.6 pts
        //      each in Yahoo default); ~1.3 pts/wk at the archetype extreme.
    label: 'HBP',
    leagueMean: 0.009,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 && typeof s.hbp === 'number' ? s.hbp / s.pa : null),
    getPrior: p => (p.pa > 0 && typeof p.hbp === 'number' ? p.hbp / p.pa : null),
    normRange: [0, 0.025],
    betterIs: 'higher',
  },
  18: { // BB — stabilises ~120 PA. leagueMean refreshed 2026 (was 0.084).
        //      BB rate has climbed notably; 2026 league BB/PA is ~0.094.
    label: 'BB',
    leagueMean: 0.094,
    leaguePriorN: 80,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.walks / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.walks / p.pa : null),
    normRange: [0.055, 0.140],
    betterIs: 'higher',
  },
  21: { // K — stabilises ~60 PA; tighter prior cap so a diverging current K% isn't drowned.
        //     leagueMean refreshed 2026 (was 0.223 → 0.221, essentially stable).
    label: 'K',
    leagueMean: 0.221,
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

/**
 * PA at which a prior season is treated as fully reliable. Below this,
 * `blendRate` shrinks the prior's effective weight by `priorN / FULL_SAMPLE_PA`
 * so a partial-season call-up / IL-shortened year / mid-season trade
 * doesn't get the same authority as a full ~600-PA season.
 *
 * Anchor: ~⅔ of a full MLB season. Full-season regulars sit at 600+ PA;
 * 400 PA is the smallest "you played a real role" sample that empirically
 * still tracks well year-to-year. Below that, sample noise plus selection
 * effects (the player only batted that little for a reason) dominate.
 */
const FULL_SAMPLE_PA = 400;

export interface BlendedBaseline {
  /** Bayesian-blended per-PA rate (or native rate for AVG). */
  rate: number;
  /** Effective sample size behind the estimate (current + capped prior). */
  effectivePA: number;
}

/**
 * Effective-PA gate: below this the talent regression is dominated by
 * league priors, so the raw-rate blend (which keys off the player's
 * actual current + prior PA) is a better signal. Above this the talent
 * vector has enough sample behind it to genuinely beat raw rates by
 * stripping BABIP/luck noise. ~30 GP for a regular starter.
 * See docs/unified-rating-model.md#per-cat-batter-baselines.
 */
const TALENT_GATE_EFFECTIVE_PA = 100;

/**
 * Talent-derived rate for cats with strong Statcast signal. Returns null
 * for cats where talent doesn't help (R/RBI/SB depend on lineup context,
 * not pure batter skill; HR has no Savant expected primary — xSLG − xBA
 * can't isolate the HR share of extra bases) or when the talent vector
 * isn't available.
 *
 * The rates returned here are PA-denominated per-PA outcome rates —
 * comparable to the raw `s.hits / s.pa` shape — so the downstream
 * normalize step doesn't need to know whether it got a talent or raw
 * input.
 *
 * For AVG (Yahoo stat_id 3) the function returns the H/AB rate (xBA
 * directly), matching the raw-rate getter which returns `s.avg`. The
 * other rate cats return per-PA.
 */
function talentRateForCategory(
  stats: BatterSeasonStats,
  statId: number,
): number | null {
  const kRate = stats.kRate;
  const bbRate = stats.bbRate;
  const xba = stats.xba;
  const xslg = stats.xslg;
  switch (statId) {
    case 3: // AVG — xBA is the deserved H/AB
      return xba;
    case 8: // H — xBA × (AB/PA); AB/PA ≈ (1 − bbRate)
      return xba !== null && bbRate !== null ? xba * (1 - bbRate) : null;
    case 23: // TB — xSLG × (AB/PA); SLG is TB/AB, so TB/PA ≈ xSLG × (1 − bbRate)
      return xslg !== null && bbRate !== null ? xslg * (1 - bbRate) : null;
    case 21: // K — regressed K%
      return kRate;
    case 18: // BB — regressed BB%
      return bbRate;
    // HR, R, RBI, SB stay on the raw-rate blend (lineup-context-dominated
    // or no expected-stat primary).
    default:
      return null;
  }
}

/**
 * Cats whose talent rate comes from a Statcast *expected-stat model*
 * (xBA / xSLG) rather than from regressed actual outcomes. These blend
 * with the raw actual-rate path at `XSTAT_BLEND_WEIGHT` instead of
 * replacing it — see `blendedBaselineForCategory`. K/BB are NOT in this
 * set: their talent rates are Bayesian-regressed actual K%/BB%, so there
 * is no expected-vs-actual gap to hedge.
 */
const XSTAT_MODELED_CATS = new Set([3, 8, 23]);

/**
 * Weight on the expected-stat-modeled rate when blending with the raw
 * actual blend for `XSTAT_MODELED_CATS`. Expected stats predict future
 * rates better than actuals, but only modestly (next-season wOBA:
 * xwOBA r ≈ .57 vs wOBA r ≈ .54; blends beat both at r ≈ .59–.61), and
 * they systematically shortchange speed/contact archetypes whose
 * actual-vs-expected residual is persistent skill. Full replacement
 * over-trusts the model; 60/40 tracks the literature.
 * See docs/unified-rating-model.md#calibration-anchors.
 */
const XSTAT_BLEND_WEIGHT = 0.6;

/**
 * Bayesian-blended per-PA (or native) rate for one category. Returns null
 * when the stat isn't in the baseline config.
 *
 * Three-path:
 *   1. **Regressed-actual talent** (K / BB): batter has Savant talent with
 *      effectivePA ≥ TALENT_GATE_EFFECTIVE_PA. These talent rates are
 *      Bayesian-regressed actual outcomes — surfaced directly, no second
 *      blend and nothing to hedge against.
 *   2. **Expected-stat blend** (AVG / H / TB): the talent rate comes from
 *      a Statcast expected model (xBA / xSLG), which predicts future rates
 *      only modestly better than actuals and systematically shortchanges
 *      speed/contact archetypes. Blend at `XSTAT_BLEND_WEIGHT` with the
 *      raw actual blend — the actual side implicitly carries each player's
 *      persistent actual-vs-expected residual.
 *   3. **Raw path** (everything else, and the fallback for thin-sample /
 *      no-Savant players): the legacy Bayesian blend of raw current +
 *      prior + league.
 */
export function blendedBaselineForCategory(
  stats: BatterSeasonStats,
  statId: number,
): BlendedBaseline | null {
  const cfg = CATEGORY_BASELINE_CONFIG[statId];
  if (!cfg) return null;

  const eff = stats.xwobaEffectivePA;
  const talentRate =
    eff >= TALENT_GATE_EFFECTIVE_PA ? talentRateForCategory(stats, statId) : null;

  // Regressed-actual talent rates (K%/BB%) stand alone.
  if (talentRate !== null && !XSTAT_MODELED_CATS.has(statId)) {
    return { rate: talentRate, effectivePA: eff };
  }

  // Raw path: Bayesian blend of raw current + prior + league. Needed both
  // as the fallback and as the actual side of the expected-stat blend.
  const cur = cfg.getCurrent(stats);
  const prior = stats.priorSeason ? cfg.getPrior(stats.priorSeason) : null;
  const raw = blendRate({
    current: cur,
    currentN: stats.pa,
    prior,
    priorN: stats.priorSeason?.pa ?? 0,
    leagueMean: cfg.leagueMean,
    leaguePriorN: cfg.leaguePriorN,
    priorCap: cfg.priorCap,
    priorReliabilityN: FULL_SAMPLE_PA,
  });

  if (talentRate !== null) {
    const w = XSTAT_BLEND_WEIGHT;
    return {
      rate: w * talentRate + (1 - w) * raw.value,
      effectivePA: Math.round(w * eff + (1 - w) * raw.effectiveN),
    };
  }

  return { rate: raw.value, effectivePA: raw.effectiveN };
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
