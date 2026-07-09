/**
 * Per-batter "typical lineup spot" observation store.
 *
 * Lineup cards are only posted by MLB Stats API for D+0 (and yesterday).
 * For D+1..D+5 the `lineups` arrays are empty, which silently kills the
 * batting-order-driven opportunity multiplier in `getBatterRating` for any
 * future-day projection.
 *
 * The store here is the workaround: every time we observe a player in a
 * posted lineup (via `getGameDay`), we record their slot. The forward-
 * projection engine reads the observed spot when a future-day matchup
 * context is being assembled. Assumption per user direction: batters stay
 * where they were last observed. When that's wrong we eat the error until
 * the next D+0 observation overwrites the entry.
 *
 * NOT a cache — entries are observations that cannot be refetched once
 * lost, so keys live under `obs:` (outside `cache:*`) where the admin
 * panel's cache clears can't reach them. See
 * docs/data-architecture.md#observation-stores.
 *
 * TTL is 7 days — long enough to survive an off-day or an unposted game,
 * short enough that a player who's been demoted out of the lineup for an
 * extended stretch eventually drops back to "no signal".
 */

import { redisUtils } from '@/lib/redis';

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

interface LineupSpotEntry {
  spot: number;          // 1-9
  observedDate: string;  // YYYY-MM-DD
}

function key(mlbId: number): string {
  return `obs:batter-lineup-spot:${mlbId}`;
}

/**
 * Return the most recently observed batting-order spot (1-9) for a player,
 * or null when nothing has been recorded within the TTL window.
 * Best-effort: a Redis error reads as "no signal" rather than failing the
 * projection that asked.
 */
export async function getObservedLineupSpot(mlbId: number): Promise<number | null> {
  if (!Number.isFinite(mlbId) || mlbId <= 0) return null;
  try {
    const raw = await redisUtils.get(key(mlbId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as LineupSpotEntry;
    if (typeof entry?.spot !== 'number') return null;
    if (entry.spot < 1 || entry.spot > 9) return null;
    return entry.spot;
  } catch {
    return null;
  }
}

/**
 * Batch variant — single SCAN-free fan-out reading multiple keys in parallel.
 * Returns a Map<mlbId, spot> with only the resolved entries; missing entries
 * are simply absent.
 */
export async function getObservedLineupSpots(mlbIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const valid = mlbIds.filter(id => Number.isFinite(id) && id > 0);
  if (valid.length === 0) return out;
  const results = await Promise.all(valid.map(getObservedLineupSpot));
  valid.forEach((id, i) => {
    const spot = results[i];
    if (spot !== null) out.set(id, spot);
  });
  return out;
}

/**
 * Record one observation. Overwrites any prior entry, refreshing TTL.
 * Silently swallows Redis errors — the store is best-effort and a
 * write failure should never break the underlying schedule fetch.
 */
export async function recordLineupSpot(
  mlbId: number,
  spot: number,
  observedDate: string,
): Promise<void> {
  if (!Number.isFinite(mlbId) || mlbId <= 0) return;
  if (!Number.isFinite(spot) || spot < 1 || spot > 9) return;
  try {
    const entry: LineupSpotEntry = { spot, observedDate };
    await redisUtils.set(key(mlbId), JSON.stringify(entry), TTL_SECONDS);
  } catch (err) {
    console.warn(`[lineupSpots] failed to record mlbId=${mlbId}:`, err);
  }
}

/**
 * Record every player in a posted lineup for one game. No-op when the
 * lineup is empty (the typical case for D+1+ before MLB posts).
 *
 * Fire-and-forget at the call site: `void recordPostedLineup(...)`.
 */
export async function recordPostedLineup(
  lineup: { mlbId: number; battingOrder: number }[],
  observedDate: string,
): Promise<void> {
  if (lineup.length === 0) return;
  await Promise.all(
    lineup.map(entry => recordLineupSpot(entry.mlbId, entry.battingOrder, observedDate)),
  );
}
