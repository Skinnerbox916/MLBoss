/**
 * How uncertain is a projected category total — the variance half of the
 * matchup margin.
 *
 * THE PROBLEM THIS EXISTS FOR. `analyzeMatchup` used to turn a category gap
 * into a margin by dividing it by a hand-set constant per category (SB 3,
 * HR 4, TB 20, …) and clamping to ±1. That has three defects, and they
 * compound:
 *
 *   1. It is not a probability. A constant cannot say whether a 3.7-steal
 *      lead is safe, because safety depends on how many steals are still
 *      to come, which depends on roster size, games left, and the week.
 *   2. The clamp erases the difference between "barely ahead" and "cannot
 *      lose". Every lead past its constant reads as exactly 1.0, so a
 *      3.7-steal lead and a 43.7-total-base lead became the same number,
 *      and `pivotality(1.0) = 0.017` removed both from the weighting.
 *   3. In `corrected` mode it had no time awareness at all. The same
 *      projected gap read identically on Monday and on Saturday.
 *
 * Measured against a real matchup on 2026-09-08: seven leads all reported
 * margin 1.00 ("locked win"), while their true win probabilities ranged
 * from 85% to 99.9%. Four of the seven sat between 85% and 91%, giving a
 * ~30% chance of dropping at least one category the app had written off.
 *
 * THE MODEL. Weekly category totals are counts, and for counts the
 * variance scales with the mean. Fitted on the graded retro cohorts
 * (37,403 batter-days, 4,192 pitcher starts), `Var(actual − predicted)`
 * divided by the predicted mean is stable within each category across the
 * whole predicted range — see `CATEGORY_DISPERSION`. So:
 *
 *     Var(one side)  = φ × (that side's REMAINING production)
 *     Var(the gap)   = φ × (my remaining + opponent's remaining)
 *     z              = gap / √Var
 *     P(win)         = Φ(z)
 *
 * Using REMAINING rather than total production is what makes the margin
 * time-aware for free: on Monday almost everything is still to come and
 * σ is at its widest; by Saturday little is left, σ collapses, and leads
 * genuinely lock. No `weekProgress` fudge factor is needed.
 *
 * Ratio categories (AVG, ERA, WHIP) are the same model one level down: the
 * numerator is a count with its own φ, and the denominator (AB, IP) is
 * treated as known, so `Var(ratio) = mult² × φ × numerator_remaining /
 * denominator_total²`.
 *
 * WHY THE MARGIN IS `PIVOTALITY_W × z`. The weight a category deserves is
 * the marginal value of production in it, `dP(win)/dx`, which is
 * proportional to the normal density `exp(−z²/2)`. Since
 * `pivotality(d, w) = exp(−d²/(2w²))`, feeding it `d = w·z` reproduces
 * exactly that curve with no change to the shared gradient. It also keeps
 * every existing threshold meaningful rather than arbitrary:
 *
 *   | margin | z    | P(win)  | meaning                                |
 *   |--------|------|---------|----------------------------------------|
 *   | 0.00   | 0.0  | 50.0%   | coin flip, maximum weight              |
 *   | 0.50   | 1.43 | 92.4%   | edge of `contested` (priority ≥ 0.5)   |
 *   | 0.70   | 2.00 | 97.7%   | `LOCKED_THRESHOLD` / auto-concede      |
 *   | 1.00   | 2.86 | 99.8%   | clamp; weight bottoms out at 0.017     |
 *
 * KNOWN LIMITATION. The weight is `exp(−z²/2)` alone, not `exp(−z²/2)/σ`.
 * The full derivative of win probability with respect to production
 * carries a `1/σ` term, so a category where a unit of production moves the
 * needle further should be worth more per unit. That scaling belongs with
 * the per-category unit normalisation in `streamCatImpact.ts`, not here,
 * and folding it in without re-checking that normaliser would double-count.
 * Left for a separate, measured change.
 */

import { PIVOTALITY_W } from '@/lib/rating/pivotality';

/**
 * Dispersion φ = Var(actual − predicted) / mean(predicted), per category.
 *
 * Fitted 2026-09-08 on the graded retro cohorts. Batter values come from
 * 37,403 batter-days (`retro-batter-day` joined to `player_game_actuals`),
 * pitcher values from 4,192 starts (`retro-pitcher-start`). Each was
 * checked for stability by splitting the sample into terciles of predicted
 * value; φ held within roughly ±0.1 across terciles for every category,
 * which is what licenses treating it as a constant.
 *
 * Reading the numbers: φ = 1 is Poisson (variance equals mean — most
 * counting cats land here). Above 1 means outcomes cluster: total bases
 * (2.04) because one swing is worth up to four, runs batted in (1.48) and
 * earned runs (1.62) for the same reason. Below 1 means outcomes are
 * bounded per opportunity: innings pitched (0.37) because a start is
 * capped around 7, wins (0.65) and quality starts (0.56) because they are
 * one-per-start coin flips whose φ is close to the theoretical `1 − p`.
 *
 * Two are not measurable from these cohorts and default to Poisson, which
 * is the neutral assumption for a count: hit-by-pitch (not projected by the
 * batter engine) and saves (no reliever cohort exists — the uncertainty is
 * dominated by whether a save opportunity appears at all, which is itself
 * roughly Poisson).
 *
 * Keyed by `stat_id`. For ratio cats the value is the dispersion of the
 * NUMERATOR (hits for AVG, earned runs for ERA, hits+walks for WHIP), which
 * is what `ratioGapSigma` needs.
 */
export const CATEGORY_DISPERSION: Record<number, number> = {
  // Batter counting
  7: 0.936,   // R
  8: 0.851,   // H
  10: 0.969,  // 2B
  11: 1.001,  // 3B
  12: 0.946,  // HR
  13: 1.478,  // RBI  — clusters (one swing can drive in four)
  16: 0.930,  // SB
  18: 0.949,  // BB
  20: 1.0,    // HBP  — not projected; Poisson default
  21: 0.798,  // K
  23: 2.042,  // TB   — clusters hardest (1-4 per hit)
  // Batter ratio — numerator dispersion
  3: 0.851,   // AVG  — numerator is hits
  // Pitcher counting
  28: 0.653,  // W    — one-per-start Bernoulli, theoretical 1−p ≈ 0.69
  32: 1.0,    // SV   — no cohort; Poisson default
  42: 1.027,  // K
  50: 0.365,  // IP   — bounded per start
  83: 0.561,  // QS   — one-per-start Bernoulli
  // Pitcher ratio — numerator dispersion
  26: 1.618,  // ERA  — numerator is earned runs
  27: 0.931,  // WHIP — numerator is hits+walks, PA-weighted blend of 0.951/0.877
};

/**
 * Multiplier baked into a ratio category's definition: ERA is 9 × ER / IP,
 * everything else is numerator / denominator.
 */
const RATIO_MULTIPLIER: Record<number, number> = { 26: 9 };

/**
 * Variance inflation for what the cohorts structurally cannot see.
 *
 * Two omissions, both measured or bounded rather than guessed:
 *
 *  - **Correlation between players.** The cohort residuals are per
 *    batter-day and the gap variance above adds them as if independent.
 *    Measured on the cohort, a day's aggregate residual carries a common
 *    factor worth an average pairwise correlation of 0.001–0.006 depending
 *    on the category. At the ~235 players/day of the full slate that
 *    compounds to a 1.25–2.30× variance ratio, but a fantasy roster fields
 *    roughly ten players a day, where the same correlation is worth only
 *    1.01–1.05×. Small, because a roster's players are spread across many
 *    games and the strong within-game correlation barely applies.
 *  - **Playing time.** Every cohort row is a player who actually played —
 *    the join to actuals only matches games that happened. An unexpected
 *    rest day, an in-week injury or a postponement adds Bernoulli variance
 *    the residuals never see, worth on the order of `q(1−q)μ²` ≈ 5% of
 *    variance at a 90% start rate.
 *
 * 1.10 covers both with a little room. It is deliberately the conservative
 * direction: a wider σ makes categories read as MORE contested, and the
 * cost of defending a category you were going to win anyway is far smaller
 * than the cost of abandoning one you could have won.
 */
export const UNMODELED_VARIANCE_INFLATION = 1.10;

/** Normal CDF via Abramowitz-Stegun 7.1.26. Max error ~1.5e-7. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * σ of the (mine − opponent) difference in a COUNTING category's final
 * total, given how much production each side still has coming.
 *
 * Returns null when the category has no fitted dispersion (an unscored or
 * unrecognised stat) — callers fall back to their legacy scale rather than
 * inventing a number.
 */
export function countingGapSigma(
  statId: number,
  myRemaining: number,
  oppRemaining: number,
): number | null {
  const phi = CATEGORY_DISPERSION[statId];
  if (phi === undefined) return null;
  const remaining = Math.max(0, myRemaining) + Math.max(0, oppRemaining);
  if (!Number.isFinite(remaining)) return null;
  // A floor of one unit of remaining production keeps σ from collapsing to
  // zero on the final day, which would make every standing lead read as a
  // certainty and divide by zero on the way there.
  return Math.sqrt(phi * Math.max(remaining, 1) * UNMODELED_VARIANCE_INFLATION);
}

/** One side of a ratio category: what is still to come, over what total. */
export interface RatioSideVolume {
  /** Numerator still to come (hits, earned runs, hits+walks). */
  numeratorRemaining: number;
  /** Denominator across the WHOLE week, elapsed plus remaining (AB, IP). */
  denominatorTotal: number;
}

/**
 * σ of the (mine − opponent) difference in a RATIO category's final value.
 *
 * The denominator is treated as known: by the time it matters, at-bats and
 * innings are far better determined than the hits and earned runs inside
 * them, and carrying denominator variance would add a term an order of
 * magnitude smaller than the one it complicates.
 */
export function ratioGapSigma(
  statId: number,
  mine: RatioSideVolume,
  opp: RatioSideVolume,
): number | null {
  const phi = CATEGORY_DISPERSION[statId];
  if (phi === undefined) return null;
  const mult = RATIO_MULTIPLIER[statId] ?? 1;
  const variance = (side: RatioSideVolume): number => {
    if (!(side.denominatorTotal > 0)) return 0;
    const num = Math.max(0, side.numeratorRemaining);
    return (mult * mult * phi * num) / (side.denominatorTotal * side.denominatorTotal);
  };
  const total = variance(mine) + variance(opp);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.sqrt(total * UNMODELED_VARIANCE_INFLATION);
}

/**
 * Turn a gap and its σ into the margin `analyzeMatchup` publishes.
 *
 * `gap` is already direction-corrected (positive = the user is ahead).
 * The result is `PIVOTALITY_W × z` clamped to ±1, so `pivotality(margin)`
 * evaluates to `exp(−z²/2)` — see the module docblock for why that is the
 * right weight curve and what each threshold means in probability terms.
 */
export function marginFromGap(gap: number, sigma: number): number {
  if (!(sigma > 0) || !Number.isFinite(gap)) return 0;
  const z = gap / sigma;
  return Math.max(-1, Math.min(1, PIVOTALITY_W * z));
}

/** Probability the user wins this category, from the published margin. */
export function winProbabilityFromMargin(margin: number): number {
  return normalCdf(margin / PIVOTALITY_W);
}
