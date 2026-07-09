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
// Playing-time factor — moved to `./playingTime` (survives this module's
// retirement; see docs/roster-value-proposal.md). Re-exported here so
// existing imports keep working until the roster-page conversion lands.
// ---------------------------------------------------------------------------

export {
  playingTimeFactor,
  estimateFullTimePaceRef,
  estimateFullTimeGpRef,
  type PlayingTimeContext,
} from './playingTime';
