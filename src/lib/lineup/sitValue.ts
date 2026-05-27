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
 * movement that playing causes in each scored category, weighted by how much
 * the game plan cares (chase=2, neutral/hold=1, punt/locked=0), in the same
 * margin-point unit the matchup analyzer uses (so the terms are comparable):
 *
 *   - Counting, higher-better (HR/R/RBI/TB/H/SB/BB): playing always adds a
 *     favorable `E[count] / scale`. Punted → ×0, so forfeiting it costs
 *     nothing — this is why punting counting stats unlocks sitting.
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
import type { Focus } from '@/lib/rating/focus';
import { RATE_SCALE, CORRECTED_COUNTING_SCALE } from '@/lib/matchup/analysis';

/** Matches `AB_PER_PA` in projection/batterTeam.ts — AB ≈ PA × 0.91. */
const AB_PER_PA = 0.91;

const AVG_STAT_ID = 3;

/** Net margin below which playing is deemed net-harmful enough to sit.
 *  Small negative deadband so we don't bench on noise. */
export const SIT_DEADBAND = 0.03;

/**
 * Residual weight for a LOCKED-WIN counting cat (suggestedFocus = punt,
 * margin > 0). A locked lead isn't truly safe — an absentee opponent keeps
 * accruing, so the lead erodes over the rest of the matchup/season. Zeroing
 * these cats entirely is what makes "chase K" bench the whole lineup: with no
 * counting value left, every bat's K harm goes unoffset. The residual keeps
 * real counting production worth something, so producers earn their slot and
 * only weak / high-K bats fall below the sit line.
 *
 * Out-of-reach LOSSES (punt, margin ≤ 0) stay at 0 — there's nothing to
 * protect. If the user thinks such a cat is still live (the absentee will
 * catch up), they override it to chase, which restores full weight.
 */
const LOCKED_WIN_RESIDUAL = 0.35;

/**
 * How much a category's production is worth to the sit decision. Chase = 2×,
 * hold = 1×, locked win = small residual, out-of-reach loss = 0. `margin` is
 * the corrected matchup margin for this cat (positive = winning); only
 * consulted for punted cats to split locked wins from out-of-reach losses.
 */
function categoryWeight(f: Focus, margin: number | undefined): number {
  if (f === 'chase') return 2;
  if (f === 'neutral') return 1;
  // punt: split by direction.
  return margin !== undefined && margin > 0 ? LOCKED_WIN_RESIDUAL : 0;
}

export interface SitCatContribution {
  statId: number;
  label: string;
  focus: Focus;
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
  /** Corrected matchup margin per stat_id (positive = winning). Used only to
   *  split punted cats into locked wins (retain residual value) vs
   *  out-of-reach losses (zero). Missing entries are treated as 0. */
  marginByStatId?: Record<number, number>;
  deadband?: number;
}

/**
 * Compute the net matchup value of playing a batter today. The focus per
 * category is read from `rating.categories[].focus` — i.e. the same focusMap
 * the rating was built with — so chase/hold/punt weighting is consistent
 * with the game plan the user sees.
 */
export function computeBatterSitValue(input: SitValueInputs): BatterSitValue {
  const { rating, expectedPA, avgAnchor, marginByStatId } = input;
  const deadband = input.deadband ?? SIT_DEADBAND;
  const expectedAB = expectedPA * AB_PER_PA;

  const perCat: SitCatContribution[] = [];

  for (const cat of rating.categories) {
    const w = categoryWeight(cat.focus, marginByStatId?.[cat.statId]);
    if (w === 0) continue; // out-of-reach loss — playing adds nothing we value

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
        focus: cat.focus,
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
      focus: cat.focus,
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

/**
 * Is the game plan in the shape where sitting-for-ratio makes sense — at
 * least one counting cat punted/locked AND at least one ratio/K cat chased?
 * When false, the daily optimizer keeps its "always fill the lineup" behavior
 * (composite-rating objective, no empty slots). This bounds the auto-sit
 * behavior change to exactly the scenario it's designed for.
 */
export function isGamePlanSitWorthy(focusByStatId: Record<number, Focus>): boolean {
  // Higher-better counting cats whose punt removes the offsetting value.
  const COUNTING_HIGHER = new Set([7, 8, 12, 13, 16, 18, 23]);
  // Cats where sitting actively protects the number (AVG rate, batter K).
  const RATIO_OR_K = new Set([AVG_STAT_ID, 21]);

  let hasPuntedCounting = false;
  let hasChasedRatioOrK = false;
  for (const [statIdStr, focus] of Object.entries(focusByStatId)) {
    const statId = Number(statIdStr);
    if (focus === 'punt' && COUNTING_HIGHER.has(statId)) hasPuntedCounting = true;
    if (focus === 'chase' && RATIO_OR_K.has(statId)) hasChasedRatioOrK = true;
  }
  return hasPuntedCounting && hasChasedRatioOrK;
}
