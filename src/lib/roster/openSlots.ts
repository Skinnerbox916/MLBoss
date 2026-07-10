/**
 * Open-roster-slot detection — shared by the categories and points roster
 * pages. Yahoo has NO direct "open roster spots" field (verified against
 * raw /league/settings, /team, /team/roster payloads — see
 * docs/yahoo-api-reference.md#roster-capacity), so we compute it the way
 * Yahoo's own add flow does:
 *
 *  1. **Cap space** — the roster limit is the sum of non-reserve slot
 *     counts (IL/IL+/NA are extra, conditional slots that don't count).
 *     Players stashed in a reserve slot don't count against the cap,
 *     which is the standard "IL stash frees an add" mechanic. This is
 *     the primary signal: a full roster can never show open slots, no
 *     matter how the daily lineup is arranged.
 *  2. **Placement gate** — an added *batter* also needs an empty slot he
 *     can legally occupy (batting slot or bench). A cap-open spot whose
 *     only empty slot is pitcher-shaped (e.g. an unfillable RP hole)
 *     can't take a batter, so it doesn't count for the batter optimizers.
 */

import type { RosterPositionSlot } from '@/lib/hooks/useRosterPositions';

const isReserveSlot = (pos: string) => /^(IL\+?|NA)$/i.test(pos);

/**
 * Number of open slots an added batter could actually use. > 0 enables
 * pure-add suggestions in `generateSwapSuggestions`.
 */
export function computeOpenSlotCount(
  roster: Array<{ selected_position?: string }>,
  leaguePositions: RosterPositionSlot[],
): number {
  if (roster.length === 0 || leaguePositions.length === 0) return 0;

  const capSpots = leaguePositions
    .filter(p => !isReserveSlot(p.position))
    .reduce((sum, p) => sum + p.count, 0);
  const countedPlayers = roster.filter(p => !isReserveSlot(p.selected_position ?? '')).length;
  const capOpen = capSpots - countedPlayers;

  const batterSlotNames = new Set(
    leaguePositions
      .filter(p => p.position === 'BN' || p.position_type === 'B')
      .map(p => p.position),
  );
  const batterCapacity = leaguePositions
    .filter(p => batterSlotNames.has(p.position))
    .reduce((sum, p) => sum + p.count, 0);
  const batterOccupied = roster.filter(p => batterSlotNames.has(p.selected_position ?? '')).length;
  const batterPlaceable = batterCapacity - batterOccupied;

  return Math.max(0, Math.min(capOpen, batterPlaceable));
}
