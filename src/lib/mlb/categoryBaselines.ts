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
  /**
   * 0-1 normalisation window, `center ± halfWidth`, clamped. `center` is the
   * league mean, so a league-average rate normalises to exactly 0.5 and the
   * composite's "50 = neutral" contract holds by construction. `halfWidth`
   * is 2.5 standard deviations of the forecast layer's own per-PA output
   * over the full-season retro cohort — one SD of forecast movement is
   * worth the same score points in every category, and ~1% of batter-days
   * clip at either end. See docs/unified-rating-model.md#batter-score-scale.
   */
  norm: { center: number; halfWidth: number };
  /** Which direction is "good"? AVG/HR/R/RBI/SB/BB/H higher = better; K lower = better. */
  betterIs: 'higher' | 'lower';
}

/**
 * Per-category config. `leagueMean` values are 2026 season-to-date MLB rates
 * (MLB Stats API `/teams/stats?group=hitting&stats=season`, 30 teams summed,
 * 163,893 PA, fetched 2026-09-08) — refresh per
 * docs/league-baselines.md#updating-these and keep the `batterForecast.ts`
 * log5 anchors in step. `norm` windows are centred on those means; see the
 * field doc above.
 *
 * `leaguePriorN` is how many plate appearances of league-average the blend
 * mixes in — the regression strength. It is fitted per category, not chosen:
 * `scripts/retro-talent-shrinkage-fit.ts` searches, out of sample, for the N
 * that best predicts a held-out later window (2026-09, ~300 batters at each
 * of three split dates; see docs/history.md).
 *
 * The values order themselves the way the stabilisation literature says they
 * should — K fastest, then BB, then power, then rate stats, with the
 * context-dependent counting stats slowest and doubles barely stabilising at
 * all. K's fitted value came back at its existing 50 and SB inside its
 * existing 100, which is the check that the fit is measuring something real
 * rather than just preferring more regression.
 *
 * WHAT THIS REPLACED, and why it is not a matter of taste: every category
 * used to sit at 100 (bar SB and K), on the reasoning that priors should be
 * "roughly half the true-talent stabilisation point" so that current
 * performance over a real sample would genuinely move the rank — the worry
 * being that a Bayesian-strict prior would project a .178-over-50-PA hitter
 * as a .240 hitter. That is a claim about PREDICTION, and the fit measures
 * prediction directly over exactly the horizon the app plans on. It is wrong
 * by a factor of 4-9x for every category except the two already correct. The
 * cost of the old values was real: the per-knob fit read the talent layer's
 * spread at 0.67 for R and 0.65 for RBI, where 1.00 is calibrated, and the
 * gradient across categories tracked precisely how much of each one leaned on
 * this raw path.
 *
 * The consequence to expect, and it is the intended one: players look more
 * alike than they used to, and a hot or cold stretch moves a projection less.
 */
export const CATEGORY_BASELINE_CONFIG: Record<number, CategoryBaselineConfig> = {
  3: { // AVG — 2026 season-to-date .2437 (was .239 from a mid-season pull).
    label: 'AVG',
    leagueMean: 0.244,
    leaguePriorN: 700,
    priorCap: 250,
    getCurrent: s => s.avg,
    getPrior: p => p.avg,
    norm: { center: 0.244, halfWidth: 0.044 },
    betterIs: 'higher',
  },
  7: { // R
    label: 'R',
    leagueMean: 0.118,
    leaguePriorN: 650,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.runs / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.runs / p.pa : null),
    norm: { center: 0.118, halfWidth: 0.033 },
    betterIs: 'higher',
  },
  8: { // H — 2026 season-to-date .2164.
    label: 'H',
    leagueMean: 0.216,
    leaguePriorN: 600,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.hits / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.hits / p.pa : null),
    norm: { center: 0.216, halfWidth: 0.039 },
    betterIs: 'higher',
  },
  10: { // 2B — doubles per PA. 2026 season-to-date .0410.
        //      Optional-field getters: `doubles` is absent on stale cached
        //      lines; null routes the blend to prior + league mean.
    label: '2B',
    leagueMean: 0.041,
    leaguePriorN: 1500,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 && typeof s.doubles === 'number' ? s.doubles / s.pa : null),
    getPrior: p => (p.pa > 0 && typeof p.doubles === 'number' ? p.doubles / p.pa : null),
    norm: { center: 0.041, halfWidth: 0.005 },
    betterIs: 'higher',
  },
  11: { // 3B — triples per PA. Rare, speed/park-driven; 2026 season-to-date .0035.
        //      Tight prior (stabilises slowly, but the absolute rates are
        //      tiny — the blend mostly separates the 8-triple burners from
        //      the zeros).
    label: '3B',
    leagueMean: 0.0035,
    leaguePriorN: 700,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 && typeof s.triples === 'number' ? s.triples / s.pa : null),
    getPrior: p => (p.pa > 0 && typeof p.triples === 'number' ? p.triples / p.pa : null),
    norm: { center: 0.0035, halfWidth: 0.0035 },
    betterIs: 'higher',
  },
  12: { // HR — 2026 season-to-date .0302 (a mid-season pull read .0275).
    label: 'HR',
    leagueMean: 0.030,
    leaguePriorN: 425,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.hr / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.hr / p.pa : null),
    norm: { center: 0.030, halfWidth: 0.0185 },
    betterIs: 'higher',
  },
  13: { // RBI
    label: 'RBI',
    leagueMean: 0.113,
    leaguePriorN: 800,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.rbi / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.rbi / p.pa : null),
    norm: { center: 0.113, halfWidth: 0.0355 },
    betterIs: 'higher',
  },
  16: { // SB — 2026 season-to-date .0178. The .010 it carried was a pre-2023 rate;
        //      the bigger bases roughly doubled it and the anchor was never refreshed.
    label: 'SB',
    leagueMean: 0.018,
    leaguePriorN: 100,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.sb / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.sb / p.pa : null),
    norm: { center: 0.018, halfWidth: 0.038 },
    betterIs: 'higher',
  },
  20: { // HBP — hit-by-pitch per PA. 2026 season-to-date .0115; plate-crowders run
        //      3x that and the trait is among the most persistent batter
        //      skills year-to-year. Included for points leagues (2.6 pts
        //      each in Yahoo default); ~1.3 pts/wk at the archetype extreme.
    label: 'HBP',
    leagueMean: 0.0115,
    leaguePriorN: 400,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 && typeof s.hbp === 'number' ? s.hbp / s.pa : null),
    getPrior: p => (p.pa > 0 && typeof p.hbp === 'number' ? p.hbp / p.pa : null),
    norm: { center: 0.0115, halfWidth: 0.0125 },
    betterIs: 'higher',
  },
  18: { // BB — stabilises ~120 PA. leagueMean refreshed 2026 (was 0.084),
        //      re-refreshed 2026-07-23: the May value (.094) caught the
        //      early-season walk spike; season-to-date settled at ~.089.
    label: 'BB',
    leagueMean: 0.089,
    leaguePriorN: 200,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.walks / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.walks / p.pa : null),
    norm: { center: 0.089, halfWidth: 0.0605 },
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
    norm: { center: 0.221, halfWidth: 0.142 },
    betterIs: 'lower',
  },
  23: { // TB — total bases per PA. League-mean TB/PA ≈ AVG × bases-per-hit ×
        // AB/PA → .3552 in 2026 season-to-date.
    label: 'TB',
    leagueMean: 0.355,
    leaguePriorN: 900,
    priorCap: 250,
    getCurrent: s => (s.pa > 0 ? s.totalBases / s.pa : null),
    getPrior: p => (p.pa > 0 ? p.totalBases / p.pa : null),
    norm: { center: 0.355, halfWidth: 0.086 },
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
  /**
   * How much of `rate` came from park-exposed actuals, 0-1.
   *
   * The line is EXPECTED vs OBSERVED, not which data source served it.
   * xBA / xSLG are built from exit velocity and launch angle, which know
   * nothing about park dimensions, so they are park-neutral by construction.
   * Everything observed carries the park it was compiled in — including K%
   * and BB%, which come off the same Statcast leaderboard but are plain
   * counted rates. `parkExposureFactor` needs this to avoid over-correcting
   * a blended baseline — see parkAdjustment.ts.
   */
  parkExposedShare: number;
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
 * Share of plate appearances that are neither a walk nor an at-bat — HBP,
 * sacrifice flies and bunts, catcher's interference. 2026 season-to-date:
 * AB/PA .888 with BB/PA .0891, so .0229 (MLB Stats API, 2026-09-08). The
 * old `1 − bbRate` approximation dropped this and ran every talent-path
 * H/PA and TB/PA ~2.6% high, which read as a +0.08 normalized level bias on
 * both categories for every batter.
 */
const NON_BB_NON_AB_PER_PA = 0.023;

/** AB/PA for a batter with the given walk rate. */
export function abPerPA(bbRate: number): number {
  return Math.max(0, 1 - bbRate - NON_BB_NON_AB_PER_PA);
}

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
    case 8: // H — xBA × (AB/PA)
      return xba !== null && bbRate !== null ? xba * abPerPA(bbRate) : null;
    case 23: // TB — xSLG × (AB/PA); SLG is TB/AB
      return xslg !== null && bbRate !== null ? xslg * abPerPA(bbRate) : null;
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
    // K / BB ride the Statcast talent path but are NOT expected stats:
    // `kRate` / `bbRate` are the player's OBSERVED rates regressed toward
    // league, so structurally they should carry his home park like any other
    // actual. Parks move both more than they move overall offence — our own
    // factors span 91-119 for BB and 90-117 for SO against 92-112 overall.
    //
    // The ledger says only the walk half of that is true. The home/away gap
    // in the fitted park coefficient is the direct diagnostic for a
    // contaminated baseline, and it is 0.40 for BB (removing the exposure
    // closes it to 0.28) but 0.05 for K — no contamination to remove, and
    // correcting for it anyway opens the gap to 0.31. K's coefficient is
    // instead uniformly ~0.5 on both sides, which is the signature of a
    // factor applied about twice too hard rather than one counted twice;
    // that belongs in knobReliability.ts.
    //
    // The likely mechanism, offered as hypothesis rather than fact: a walk is
    // substantially a pitcher-approach outcome, and approach is what park
    // dimensions change — nibble in a bandbox, challenge in a cavern — so a
    // batter's observed BB% absorbs his park. Strikeouts ride his own swing
    // decisions and contact ability, which travel with him, and the SO park
    // factor may mostly reflect which pitchers work there. Testable by
    // comparing how much park moves pitcher vs batter K rates; not yet done.
    return { rate: talentRate, effectivePA: eff, parkExposedShare: statId === 18 ? 1 : 0 };
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
      // Only the actual-rate side of the blend carries the player's home park.
      parkExposedShare: 1 - w,
    };
  }

  return { rate: raw.value, effectivePA: raw.effectiveN, parkExposedShare: 1 };
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
  const { center, halfWidth } = cfg.norm;
  if (halfWidth <= 0) return 0;
  let norm = 0.5 + (rate - center) / (2 * halfWidth);
  if (betterIs === 'lower') norm = 1 - norm;
  return Math.max(0, Math.min(1, norm));
}
