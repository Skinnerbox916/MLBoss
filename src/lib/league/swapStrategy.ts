/**
 * Triangulate a swap suggestion against the user's strategic plan.
 *
 * The roster-page swap optimizer (`generateSwapSuggestions`) already
 * scores candidates with focus-aware weighting (chase cats double,
 * punt cats excluded), so the chase/punt baseline shapes the ranking.
 * What it doesn't surface: **why** a given swap helps in plan terms
 * — does it push a swing target, reinforce an anchor, or erode one?
 *
 * This module decorates each suggestion with a per-category delta
 * annotated by the cat's role in the v2 plan (anchor / swing / concede),
 * plus headline flags the UI uses to render strategic context.
 *
 * The deltas are raw normalized-rate deltas (not playing-time-weighted),
 * so they're directional rather than precisely additive to the swap's
 * `netValue`. Magnitude is approximate; sign and ranking are reliable.
 */

import type { RankedSwap } from '@/lib/roster/depth';
import type { BattingFocusPlan } from './forwardFocus';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { PlayerStatLine, BatterSeasonStats } from '@/lib/mlb/types';
import { blendedRateForCategory } from '@/lib/roster/scoring';
import { normalizeRate } from '@/lib/mlb/categoryBaselines';

export type CatRole = 'anchor' | 'swing' | 'concede';

export interface CategoryImpact {
  statId: number;
  displayName: string;
  /** Add minus drop, in normalized-rate units. Positive = swap improves
   *  this category. ~0.10 is "meaningful"; ~0.20+ is "big." */
  delta: number;
  role: CatRole;
}

export interface SwapStrategy {
  /** All categories with non-trivial impact, sorted by |delta| descending. */
  categoryImpact: CategoryImpact[];
  /** Swap meaningfully improves a swing-target category. */
  pushesSwing: boolean;
  /** Swap meaningfully erodes an anchor category. */
  erodesAnchor: boolean;
  /** Short headline summarising the dominant strategic effect. Null when
   *  the swap is plan-neutral (e.g., pure positional gap-fill with no
   *  cat that crosses the noise threshold). */
  headline: string | null;
  /** The single category this swap most affects, if non-trivial. Used
   *  by the UI to show the primary strategic target alongside the
   *  position-aware reason. */
  primaryTarget: { displayName: string; role: CatRole; delta: number } | null;
}

export interface EnrichedSwap extends RankedSwap {
  strategy: SwapStrategy;
}

// Threshold above which we say a swap "meaningfully" pushes/erodes a cat.
// Calibrated for normalized-rate units (each cat normalizes to ~[0, 1]).
const NOTABLE_DELTA = 0.05;

export function analyzeSwapStrategy(
  swap: RankedSwap,
  plan: BattingFocusPlan,
  scoringCategories: EnrichedLeagueStatCategory[],
  getStatsForPlayer: (
    name: string,
    team: string,
  ) => PlayerStatLine | BatterSeasonStats | null,
): SwapStrategy {
  // For pure-add moves (drop === null), there's no drop-side player to
  // compute deltas against — treat dropStats as null so the math
  // reduces to addNorm − 0 (i.e., the full add contribution).
  const dropRaw = swap.drop?.raw as { name: string; editorial_team_abbr: string } | undefined;
  const addRaw = swap.add.raw as { name: string; editorial_team_abbr: string };
  const dropStats = dropRaw ? getStatsForPlayer(dropRaw.name, dropRaw.editorial_team_abbr) : null;
  const addStats = getStatsForPlayer(addRaw.name, addRaw.editorial_team_abbr);

  const roleByStatId = new Map<number, CatRole>();
  for (const e of plan.anchors) roleByStatId.set(e.statId, 'anchor');
  for (const e of plan.swings) roleByStatId.set(e.statId, 'swing');
  for (const e of plan.concedes) roleByStatId.set(e.statId, 'concede');

  const impacts: CategoryImpact[] = [];
  for (const cat of scoringCategories) {
    const dropRate = dropStats ? blendedRateForCategory(dropStats, cat.stat_id) : null;
    const addRate = addStats ? blendedRateForCategory(addStats, cat.stat_id) : null;
    const dropNorm = dropRate !== null ? normalizeRate(dropRate, cat.stat_id, cat.betterIs) : 0;
    const addNorm = addRate !== null ? normalizeRate(addRate, cat.stat_id, cat.betterIs) : 0;
    const delta = addNorm - dropNorm;
    if (Math.abs(delta) < 0.01) continue;
    const role = roleByStatId.get(cat.stat_id) ?? 'concede';
    impacts.push({ statId: cat.stat_id, displayName: cat.display_name, delta, role });
  }
  impacts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const pushesSwing = impacts.some(i => i.role === 'swing' && i.delta > NOTABLE_DELTA);
  const erodesAnchor = impacts.some(i => i.role === 'anchor' && i.delta < -NOTABLE_DELTA);

  // Pick the headline category: highest |delta| among role-relevant cats
  // (swing or anchor — concedes don't drive the narrative). Anchor erosion
  // dominates when present because the warning matters more than gains.
  const anchorErosion = impacts.find(i => i.role === 'anchor' && i.delta < -NOTABLE_DELTA);
  const swingPush = impacts.find(i => i.role === 'swing' && i.delta > NOTABLE_DELTA);
  const anchorReinforce = impacts.find(i => i.role === 'anchor' && i.delta > NOTABLE_DELTA);

  let headline: string | null = null;
  let primaryTarget: SwapStrategy['primaryTarget'] = null;
  if (anchorErosion) {
    headline = `Erodes ${anchorErosion.displayName}`;
    primaryTarget = { displayName: anchorErosion.displayName, role: 'anchor', delta: anchorErosion.delta };
  } else if (swingPush) {
    headline = `Pushes ${swingPush.displayName}`;
    primaryTarget = { displayName: swingPush.displayName, role: 'swing', delta: swingPush.delta };
  } else if (anchorReinforce) {
    headline = `Reinforces ${anchorReinforce.displayName}`;
    primaryTarget = { displayName: anchorReinforce.displayName, role: 'anchor', delta: anchorReinforce.delta };
  }

  return { categoryImpact: impacts, pushesSwing, erodesAnchor, headline, primaryTarget };
}
