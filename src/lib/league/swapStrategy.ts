/**
 * Triangulate a swap suggestion against the leverage picture.
 *
 * The roster-page swap optimizer (`generateSwapSuggestions`) ranks moves
 * by leverage-weighted value delta, so the ranking already encodes the
 * strategy. What it doesn't surface: **why** a given swap helps — which
 * category it pushes, and whether it quietly drains a cushioned lead.
 *
 * This module decorates each suggestion with per-category deltas in
 * **move units** (add contribution − drop contribution, the same
 * currency as the swap's net value — see `rosterValue.ts`), annotated
 * with the cat's leverage status (contested / cushioned / conceded).
 * Replaced the anchor/swing/concede plan roles when chase/hold/punt
 * retired on the roster page — see docs/pivotality-migration.md.
 */

import type { RankedSwap } from '@/lib/roster/depth';

export type CatRole = 'contested' | 'cushioned' | 'conceded';

export interface CategoryImpact {
  statId: number;
  displayName: string;
  /** Add minus drop, in move units (fractions of a typical roster move's
   *  worth of production). Positive = swap improves this category. */
  delta: number;
  role: CatRole;
}

export interface SwapStrategy {
  /** All categories with non-trivial impact, sorted by |delta| descending. */
  categoryImpact: CategoryImpact[];
  /** Swap meaningfully improves a contested (battleground) category. */
  pushesContested: boolean;
  /** Swap meaningfully erodes a cushioned lead. */
  erodesCushion: boolean;
  /** Short headline summarising the dominant strategic effect. Null when
   *  the swap is leverage-neutral (e.g., pure positional gap-fill). */
  headline: string | null;
  /** The single category this swap most affects, if non-trivial. */
  primaryTarget: { displayName: string; role: CatRole; delta: number } | null;
}

export interface EnrichedSwap extends RankedSwap {
  strategy: SwapStrategy;
}

/**
 * Threshold above which a swap "meaningfully" pushes/erodes a cat, in
 * move units. 0.25 = a quarter of a typical move's worth of weekly
 * production in that category — below that the effect is noise next to
 * the RUPM-sized gaps the leverage math trades in.
 */
const NOTABLE_DELTA = 0.25;

/** Impacts smaller than this don't even render in the delta strip. */
const DISPLAY_FLOOR = 0.05;

export function analyzeSwapStrategy(
  swap: RankedSwap,
  /** statId → per-cat contribution (move units) for a player, from
   *  `playerContributions`. Null when the player has no line. */
  getContributions: (playerKey: string) => Record<number, number> | null,
  /** statId → leverage status, from `computeCategoryLeverage`. */
  roleForStat: (statId: number) => CatRole,
  displayNameForStat: (statId: number) => string,
): SwapStrategy {
  const addContribs = getContributions(swap.add.player_key);
  // Pure adds (drop === null) reduce to the full add contribution.
  const dropContribs = swap.drop ? getContributions(swap.drop.player_key) : null;

  const impacts: CategoryImpact[] = [];
  const statIds = new Set([
    ...Object.keys(addContribs ?? {}),
    ...Object.keys(dropContribs ?? {}),
  ].map(Number));

  for (const statId of statIds) {
    const delta = (addContribs?.[statId] ?? 0) - (dropContribs?.[statId] ?? 0);
    if (Math.abs(delta) < DISPLAY_FLOOR) continue;
    impacts.push({
      statId,
      displayName: displayNameForStat(statId),
      delta,
      role: roleForStat(statId),
    });
  }
  impacts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const pushesContested = impacts.some(i => i.role === 'contested' && i.delta > NOTABLE_DELTA);
  const erodesCushion = impacts.some(i => i.role === 'cushioned' && i.delta < -NOTABLE_DELTA);

  // Headline priority: cushion erosion (the warning matters more than
  // gains) > contested push > cushion reinforce.
  const erosion = impacts.find(i => i.role === 'cushioned' && i.delta < -NOTABLE_DELTA);
  const push = impacts.find(i => i.role === 'contested' && i.delta > NOTABLE_DELTA);
  const reinforce = impacts.find(i => i.role === 'cushioned' && i.delta > NOTABLE_DELTA);

  let headline: string | null = null;
  let primaryTarget: SwapStrategy['primaryTarget'] = null;
  if (erosion) {
    headline = `Erodes ${erosion.displayName}`;
    primaryTarget = { displayName: erosion.displayName, role: 'cushioned', delta: erosion.delta };
  } else if (push) {
    headline = `Pushes ${push.displayName}`;
    primaryTarget = { displayName: push.displayName, role: 'contested', delta: push.delta };
  } else if (reinforce) {
    headline = `Reinforces ${reinforce.displayName}`;
    primaryTarget = { displayName: reinforce.displayName, role: 'cushioned', delta: reinforce.delta };
  }

  return { categoryImpact: impacts, pushesContested, erodesCushion, headline, primaryTarget };
}
