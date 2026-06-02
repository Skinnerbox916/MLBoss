/**
 * Per-player-per-day sit-vs-start value (L5/L7).
 *
 * The composite `getBatterRating` score answers "how good is this player vs
 * a league-average bat?" — its neutral baseline is 50 = average. That's the
 * WRONG counterfactual for a sit decision: when you bench a player the slot's
 * counterfactual is ZERO production (empty slot), not an average replacement.
 * A below-average-but-productive bat scores ~45 yet is worth starting because
 * he still adds real counting stats vs the nothing you'd get sitting him.
 *
 * This engine answers the actual question: **does PLAYING this batter today
 * move my matchup favorably, net, given the game plan?** It sums the margin
 * movement that playing causes in each scored category, weighted by each
 * category's **pivotality weight** (how contested it is; 0 if conceded), in
 * the same margin-point unit the matchup analyzer uses (so the terms are
 * comparable):
 *
 *   - Counting, higher-better (HR/R/RBI/TB/H/SB/BB): playing always adds a
 *     favorable `E[count] / scale`. A locked win carries a small pivotality
 *     weight (its lead is safe, so extra production barely matters) and a
 *     conceded cat carries 0 — which is what unlocks sitting for ratios.
 *   - Batter K (lower-better counting): you can't strike out from the bench,
 *     so playing always adds an UNfavorable `E[K] / scale`.
 *   - AVG (rate): playing shifts team AVG toward the player's expected AVG.
 *     Marginal dilution against the team's projected AVG/AB anchor; negative
 *     when he hits below the team's projected average.
 *
 * `net < 0` means the K/AVG harm outweighs the counting value the plan still
 * cares about → sitting (empty slot) beats playing. A small deadband avoids
 * benching on negligible margins.
 *
 * Expected counts come from the same game-context substrate as the projection
 * engine: `rating.categories[].expected` (per-PA rate; per-AB for AVG) ×
 * expected PA, exactly as `projectBatterPlayer` derives them. Park / weather /
 * opposing SP are already folded into `expected`.
 */

import type { BatterRating } from '@/lib/mlb/batterRating';
import { RATE_SCALE, CORRECTED_COUNTING_SCALE } from '@/lib/matchup/analysis';

/** Matches `AB_PER_PA` in projection/batterTeam.ts — AB ≈ PA × 0.91. */
const AB_PER_PA = 0.91;

const AVG_STAT_ID = 3;

/** Net margin below which playing is deemed net-harmful enough to sit.
 *  Small negative deadband so we don't bench on noise. */
export const SIT_DEADBAND = 0.03;

export interface SitCatContribution {
  statId: number;
  label: string;
  /** Signed margin movement from PLAYING in this cat. Positive = playing
   *  helps the matchup; negative = playing hurts it. */
  marginDelta: number;
  /** Short note for the "why benched" line, e.g. "+1.3 K", "dilutes AVG". */
  note: string;
}

export interface BatterSitValue {
  /** Sum of per-cat margin deltas from playing. < 0 → net-harmful to play. */
  net: number;
  /** Non-zero contributions, sorted by absolute impact descending. */
  perCat: SitCatContribution[];
  /** True when `net` is below the negative deadband — a sit candidate. */
  shouldSit: boolean;
}

export interface SitValueInputs {
  rating: BatterRating;
  /** Expected plate appearances on this day (PA/game × game count).
   *  Doubleheaders double both harm and value, which falls out naturally. */
  expectedPA: number;
  /**
   * AVG dilution anchor. `oppAvg` is the OPPONENT's projected team AVG — the
   * bar you must clear to win the category. We deliberately do NOT anchor on
   * your own projected AVG: a hot, small-sample team AVG (e.g. .333) makes
   * every realistic bat look dilutive. The category is won by beating the
   * opponent, so a bat above their projected AVG is accretive and below it is
   * a drag. `myWeekAB` is your projected AB volume — the denominator for how
   * much one bat's ABs move your team rate. When omitted, AVG is skipped.
   */
  avgAnchor?: { oppAvg: number; myWeekAB: number };
  /** Pivotality weight per stat_id (0 = conceded). The per-cat importance in
   *  the sit calc: a contested cat ≈ 1, a locked win small, a conceded cat 0.
   *  Missing entries are treated as 0 (not in play). */
  categoryWeights: Record<number, number>;
  deadband?: number;
}

/**
 * Compute the net matchup value of playing a batter today. The focus per
 * category is read from `rating.categories[].focus` — i.e. the same focusMap
 * the rating was built with — so chase/hold/punt weighting is consistent
 * with the game plan the user sees.
 */
export function computeBatterSitValue(input: SitValueInputs): BatterSitValue {
  const { rating, expectedPA, avgAnchor, categoryWeights } = input;
  const deadband = input.deadband ?? SIT_DEADBAND;
  const expectedAB = expectedPA * AB_PER_PA;

  const perCat: SitCatContribution[] = [];

  for (const cat of rating.categories) {
    const w = categoryWeights[cat.statId] ?? 0;
    if (w === 0) continue; // conceded — playing adds nothing we value

    if (cat.statId === AVG_STAT_ID) {
      if (!avgAnchor || avgAnchor.myWeekAB <= 0) continue;
      const playerAvg = cat.expected;
      // Marginal shift of my team AVG from this bat's ABs, measured against
      // the opponent's AVG bar rather than my own inflated current AVG.
      const deltaVsBar =
        (expectedAB * (playerAvg - avgAnchor.oppAvg)) / avgAnchor.myWeekAB;
      const marginDelta = (w * deltaVsBar) / RATE_SCALE.AVG;
      if (marginDelta === 0) continue;
      perCat.push({
        statId: cat.statId,
        label: cat.label,
        marginDelta,
        note: playerAvg < avgAnchor.oppAvg ? 'dilutes AVG' : 'lifts AVG',
      });
      continue;
    }

    const scale = CORRECTED_COUNTING_SCALE[cat.statId];
    if (scale === undefined) continue;
    const eCount = cat.expected * expectedPA;
    const sign = cat.betterIs === 'lower' ? -1 : 1;
    const marginDelta = (sign * w * eCount) / scale;
    if (marginDelta === 0) continue;
    perCat.push({
      statId: cat.statId,
      label: cat.label,
      marginDelta,
      // For lower-better cats (batter K) playing ADDS the stat, which hurts —
      // show it as "+N K" so the harm reads naturally in the why-benched line.
      note: `${sign < 0 ? '+' : ''}${eCount.toFixed(1)} ${cat.label}`,
    });
  }

  perCat.sort((a, b) => Math.abs(b.marginDelta) - Math.abs(a.marginDelta));
  const net = perCat.reduce((s, c) => s + c.marginDelta, 0);

  return { net, perCat, shouldSit: net < -deadband };
}

// Sit-worthiness thresholds on the pivotality weight. LOW_VALUE_COUNTING
// (≈ pivotality at |margin| 0.7) means a counting cat is locked or conceded —
// extra production barely moves it. CONTESTED_RATIO (≈ pivotality at |margin|
// ~0.4) means a ratio/K cat is close enough to be worth protecting. Defaults;
// tune by watching real weeks. See docs/pivotality-migration.md.
const LOW_VALUE_COUNTING = 0.15;
const CONTESTED_RATIO = 0.5;

/**
 * Is the game plan in the shape where sitting-for-ratio makes sense — at
 * least one counting cat locked/conceded (low pivotality weight) AND at
 * least one ratio/K cat that is **contested AND being lost** (high weight
 * + margin ≤ 0)? When false, the daily optimizer keeps its "always fill
 * the lineup" behavior (composite-rating objective, no empty slots).
 *
 * The direction guard is load-bearing: sitting protects a ratio you're
 * trying to **flip**, not one you're already winning. Without it, a
 * narrow-LEAD AVG/K still has high pivotality (close cat → close to
 * coin-flip), the gate fires, and the optimizer benches the whole lineup
 * to "protect" a number that's already on the right side. The old
 * chase/hold/punt gate captured this via `focus === 'chase'` (chase ≡
 * `margin ≤ 0`); we lost it in the Phase-4 weights-only rewrite, then
 * restored it after the empty-lineup regression on a winning week. See
 * [sit-to-flip-prd.md](../../../docs/sit-to-flip-prd.md) step 1.
 */
export function isGamePlanSitWorthy(
  categoryWeights: Record<number, number>,
  marginByStatId?: Record<number, number>,
): boolean {
  // Higher-better counting cats whose low weight removes the offsetting value.
  const COUNTING_HIGHER = new Set([7, 8, 12, 13, 16, 18, 23]);
  // Cats where sitting actively protects the number (AVG rate, batter K).
  const RATIO_OR_K = new Set([AVG_STAT_ID, 21]);

  let hasLowValueCounting = false;
  let hasContestedLosingRatioOrK = false;
  for (const [statIdStr, w] of Object.entries(categoryWeights)) {
    const statId = Number(statIdStr);
    if (COUNTING_HIGHER.has(statId) && w <= LOW_VALUE_COUNTING) hasLowValueCounting = true;
    if (
      RATIO_OR_K.has(statId) &&
      w >= CONTESTED_RATIO &&
      (marginByStatId?.[statId] ?? 0) <= 0
    ) {
      hasContestedLosingRatioOrK = true;
    }
  }
  return hasLowValueCounting && hasContestedLosingRatioOrK;
}
