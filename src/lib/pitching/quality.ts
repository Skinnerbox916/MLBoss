/**
 * Pitcher talent scoring — the shared source of truth for "how good is
 * this pitcher?" across both the batter-side `getBatterMatchupScore`
 * (where a pitcher's quality is the second-biggest factor in a batter's
 * rating) and the streaming-side `overallScore` (where the pitcher IS
 * the subject).
 *
 * Having one function for both sides eliminates the calibration drift
 * problem we kept running into — where the same pitcher could look
 * "Tough SP" on one page and "Average" on another because two different
 * code paths were scoring him on different scales.
 *
 * The score is anchored so that MLB-average xwOBA-allowed (≈ .320) maps
 * to 0.5 on the pitcher's scale. This means:
 *
 *   · 0.0 = batting-practice fodder (xwOBA-a ≈ .400)
 *   · 0.5 = league-average starter (xwOBA-a ≈ .320)
 *   · 1.0 = elite/ace (xwOBA-a ≈ .240)
 *
 * Batter-side callers flip the sign (1 − score) so that a great pitcher
 * produces a LOW "good for batter" factor.
 */

import type { ProbablePitcher, PitcherTier } from '@/lib/mlb/types';

// Calibration endpoints. MLB-average xwOBA-allowed (~.320) sits at the
// midpoint of this range, so it maps to exactly 0.5 on the quality
// scale. Endpoints deliberately chosen wide — 10-year Cy Young territory
// (~.240) to AAA-quality fill-in starts (~.400) — and any pitcher
// outside the range gets clamped.
const XWOBA_ELITE = 0.240;
const XWOBA_AWFUL = 0.400;

// Run Value per 100 endpoints (Savant pitch-model proxy). Lower RV/100 is
// better from the pitcher's perspective (suppressed run expectancy). The
// elite end is roughly Cy Young territory (~−2.0); awful is ~+2.0.
// Anchored so 0.0 (league average) maps to 0.5 on the talent scale.
const RV_ELITE = -2.0;
const RV_AWFUL = 2.0;

/**
 * Minimum current-season IP before we let RV/100 override the
 * component-xwOBA talent. ~40 IP ≈ 170 PA faced, which is around the
 * stabilisation half-point for Savant's run_value_per_100. Below that
 * threshold the RV/100 blend is too sensitive to last-year weight and
 * we defer to `pp.xwoba`, which has a decaying prior cap built into
 * `talentModel.ts`.
 */
const MIN_IP_FOR_RV_PRIMARY = 40;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Map a raw xwOBA-allowed value onto the pitcher-quality scale where
 * 1.0 = elite (hard to hit), 0.5 = league average, 0.0 = awful.
 */
export function xwobaToPitcherScore(xwoba: number): number {
  return clamp01((XWOBA_AWFUL - xwoba) / (XWOBA_AWFUL - XWOBA_ELITE));
}

/**
 * Map a Run Value per 100 pitches onto the pitcher-quality scale where
 * 1.0 = elite (run-suppressing arsenal), 0.5 = league average, 0.0 =
 * batting practice.
 */
export function rvToPitcherScore(rv: number): number {
  return clamp01((RV_AWFUL - rv) / (RV_AWFUL - RV_ELITE));
}

/**
 * Map a tier classification to a pitcher-quality score. Used as fallback
 * when Savant data is unavailable (rookies, openers, mid-season callups).
 * Values intentionally map to the CENTER of each tier band so the
 * fallback doesn't masquerade as more precise than it is.
 */
function tierToPitcherScore(tier: PitcherTier | undefined): number | null {
  switch (tier) {
    case 'ace': return 0.90;
    case 'tough': return 0.70;
    case 'average': return 0.50;
    case 'weak': return 0.30;
    case 'bad': return 0.10;
    default: return null;
  }
}

export type PitcherTalentSource = 'rv' | 'xwoba' | 'tier' | 'none';

export interface PitcherTalentResult {
  /** 0–1 score from the pitcher's perspective (high = elite, 0.5 = avg). */
  score: number;
  /** Whether the underlying data was usable — `false` means we defaulted. */
  available: boolean;
  /** Source of the number: blended RV/100, blended xwOBA-a, tier fallback, or none. */
  source: PitcherTalentSource;
  /** Short raw-value display (e.g. "−1.82 RV/100", ".282 xwOBA-a"). */
  display: string;
  /** Qualitative summary (e.g. "Hittable arm", "Shutdown SP"). */
  summary: string;
}

/**
 * Compute the shared pitcher-talent score — the canonical "how good is
 * this pitcher?" function used by both batter-side rating
 * (`getBatterRating`) and the streaming-side `getPitcherRating`.
 *
 * Resolution order:
 *
 *   1. **Run Value per 100** (when `inningsPitched >= MIN_IP_FOR_RV_PRIMARY`).
 *      RV/100 is Savant's pitch-model outcome metric — usage-weighted
 *      across the entire arsenal — and is the highest-quality single
 *      signal we have when there's enough current-season sample for the
 *      blend to be primarily about this year. Below the IP gate we fall
 *      through because the prior-season weighting is too dominant.
 *   2. **Component-talent xwOBA-allowed** (`pp.xwoba`). The
 *      `computePitcherTalentXwobaAllowed` model decomposes K%/BB%/xwOBACON,
 *      regresses each independently, and recomposes — handles thin samples
 *      gracefully via the league-mean priors.
 *   3. **Tier classifier** fallback for rookies / openers / mid-season
 *      callups with no Savant data.
 *   4. Neutral 0.5 with `available: false` when nothing resolves.
 */
export function pitcherTalentScore(pp: ProbablePitcher | null | undefined): PitcherTalentResult {
  if (!pp) {
    return {
      score: 0.5,
      available: false,
      source: 'none',
      display: 'TBD',
      summary: 'No probable SP',
    };
  }

  if (
    pp.runValuePer100 !== null
    && pp.runValuePer100 !== undefined
    && pp.inningsPitched >= MIN_IP_FOR_RV_PRIMARY
  ) {
    const score = rvToPitcherScore(pp.runValuePer100);
    const sign = pp.runValuePer100 <= 0 ? '' : '+';
    return {
      score,
      available: true,
      source: 'rv',
      display: `${sign}${pp.runValuePer100.toFixed(2)} RV/100`,
      summary: summaryForScore(score),
    };
  }

  if (pp.xwoba !== null && pp.xwoba !== undefined) {
    const score = xwobaToPitcherScore(pp.xwoba);
    return {
      score,
      available: true,
      source: 'xwoba',
      display: `${pp.xwoba.toFixed(3).replace(/^0\./, '.')} xwOBA-a`,
      summary: summaryForScore(score),
    };
  }

  const tierScore = tierToPitcherScore(pp.quality?.tier);
  if (tierScore !== null) {
    return {
      score: tierScore,
      available: true,
      source: 'tier',
      display: `${tierLabel(pp.quality!.tier)} tier`,
      summary: summaryForScore(tierScore),
    };
  }

  return {
    score: 0.5,
    available: false,
    source: 'none',
    display: 'No data',
    summary: 'Unknown SP',
  };
}

function summaryForScore(score: number): string {
  if (score >= 0.85) return 'Shutdown SP';
  if (score >= 0.65) return 'Tough SP';
  if (score >= 0.40) return 'Average SP';
  if (score >= 0.20) return 'Favorable SP';
  return 'Hittable arm';
}

function tierLabel(tier: PitcherTier): string {
  switch (tier) {
    case 'ace': return 'Ace';
    case 'tough': return 'Tough';
    case 'average': return 'Avg';
    case 'weak': return 'Weak';
    case 'bad': return 'Bad';
    default: return '?';
  }
}

/**
 * Batter-side helper: returns the pitcher-talent score inverted so that
 * a tough pitcher produces a LOW value (bad for the batter). The rest
 * of the result (display, summary, source) is preserved as-is — the
 * summary already reads from the pitcher's perspective, which is what
 * we want on a batter's rating card.
 */
export function pitcherTalentFromBatterPerspective(
  pp: ProbablePitcher | null | undefined,
): PitcherTalentResult {
  const r = pitcherTalentScore(pp);
  return { ...r, score: 1 - r.score };
}
