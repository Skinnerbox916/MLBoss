import { YahooFantasyAPI, type FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import { withCache, withCacheGated, CACHE_CATEGORIES } from './cache';

/**
 * Get available pitchers (free agents + waivers) from a league.
 *
 * We issue separate queries per status (FA and W) instead of the consolidated
 * `status=A`. Yahoo's player-listing endpoint does NOT include the row-level
 * `ownership` block (the `;out=ownership` flag is silently ignored), so the
 * only way we can tell which players are claimable now vs. mid-waiver is by
 * the query they came back from. We tag the W-query rows as
 * `ownership_type: 'waivers'` here at the merge layer.
 *
 * Yahoo also does NOT expose a per-player `waiver_date` on this endpoint, so
 * we don't have a clear date to filter against. Recovering that would require
 * cross-referencing `/league/{key}/transactions` (drop timestamp + league
 * waiver-period setting) — left as follow-up work. For now, the streaming
 * board treats every waiver-pool pitcher as not-streamable.
 *
 * SP and RP are queried separately because Yahoo's `position=P` filter can
 * return a narrow slice in leagues with split SP/RP slots. SP gets the bulk
 * of pagination (it's what the streaming board cares about); RP is included
 * for completeness (some streamable long-relievers / openers).
 *
 * Semi-dynamic caching (5-minute TTL) — free agent pool shifts with transactions.
 */
export async function getAvailablePitchers(userId: string, leagueKey: string): Promise<FreeAgentPlayer[]> {
  return withCacheGated(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:fa-pitchers:${leagueKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
    async () => {
      const api = new YahooFantasyAPI(userId);
      const [spFa, rpFa, spW, rpW] = await Promise.all([
        api.getLeaguePlayers(leagueKey, { position: 'SP', status: 'FA', maxPages: 16 }), // up to 400 SPs
        api.getLeaguePlayers(leagueKey, { position: 'RP', status: 'FA', maxPages: 4 }),  // up to 100 RPs
        api.getLeaguePlayers(leagueKey, { position: 'SP', status: 'W', maxPages: 4 }),   // waiver pool
        api.getLeaguePlayers(leagueKey, { position: 'RP', status: 'W', maxPages: 2 }),
      ]);
      // Tag waiver-pool rows. Yahoo's row-level ownership block is empty
      // here, so the only place we know they're on waivers is the query
      // they came back from.
      const taggedW: FreeAgentPlayer[] = [...spW, ...rpW].map(p => ({
        ...p,
        ownership_type: 'waivers',
      }));
      // Dedupe by player_key — SP/RP-eligible pitchers can show up in both
      // SP and RP responses. FA wins over W so a player flagged as both
      // would be treated as immediately streamable.
      const seen = new Set<string>();
      const merged: FreeAgentPlayer[] = [];
      for (const p of [...spFa, ...rpFa, ...taggedW]) {
        if (seen.has(p.player_key)) continue;
        seen.add(p.player_key);
        merged.push(p);
      }
      return merged;
    },
    // Coverage gate: SP-FA is the bulk of the pool and the streaming
    // board is useless without it. A run that returns fewer than 50
    // total pitchers (~empty SP-FA) is treated as a Yahoo throttle event
    // and not cached, so the next request retries instead of pinning a
    // missing-pool result for 5 minutes.
    (merged) => merged.length >= 50,
  );
}

/**
 * Get top available batters (free agents + waivers) for the waiver dashboard card.
 * Fetches one page (25 players) with no position filter so Yahoo returns the most
 * relevant available batters sorted by its own relevance ranking.
 */
export async function getTopAvailableBatters(userId: string, leagueKey: string): Promise<FreeAgentPlayer[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:fa-batters:${leagueKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
    async () => {
      const api = new YahooFantasyAPI(userId);
      // Query batters by type — Yahoo's 'B' position_type returns hitters only
      return api.getLeaguePlayers(leagueKey, { position: 'B', status: 'A', maxPages: 1, count: 10 });
    },
  );
}

/**
 * Get a larger pool of available batters for the roster optimizer.
 *
 * `sort=AR` (Actual Rank) is critical: Yahoo's default sort is OR
 * (preseason rank), which means the API returns whichever 50 batters
 * had the highest expected fantasy value going into the season — most
 * of whom we already know are struggling (that's why they're available!).
 * The breakouts our scoring model is supposed to surface (Josh Jung,
 * Ildemaro Vargas, Brandon Marsh) had low preseason ranks and never
 * appear in the OR-sorted slice. Using AR matches what Yahoo's own
 * "Top Available — Current" view shows.
 *
 * Bumped to 4 pages × 25 = 100 candidates so the scorer has a wider
 * pool to choose its top 30 from, especially after the IL/ownership
 * filters trim the list down.
 */
export async function getAvailableBatters(userId: string, leagueKey: string): Promise<FreeAgentPlayer[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:fa-batters-full-v2:${leagueKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
    async () => {
      const api = new YahooFantasyAPI(userId);
      return api.getLeaguePlayers(leagueKey, {
        position: 'B',
        status: 'A',
        sort: 'AR',
        maxPages: 4,
        count: 25,
      });
    },
  );
}

export interface PlayerMarketSignals {
  percent_owned?: number;
  average_draft_pick?: number;
  percent_drafted?: number;
}

/**
 * Batch-fetch market signals (current percent_owned + preseason draft data)
 * for an arbitrary set of player_keys. Used to hydrate roster players so the
 * swap optimizer can dampen drop recommendations for high-owned / high-drafted
 * players (i.e. don't panic-drop a top-15 pick over 3 weeks of noise).
 *
 * Cached per-player-set with a 1-hour TTL — these signals shift slowly and
 * roster composition only changes on transactions.
 */
export async function getPlayerMarketSignals(
  userId: string,
  playerKeys: string[],
): Promise<Record<string, PlayerMarketSignals>> {
  if (playerKeys.length === 0) return {};
  // Sort keys for a stable cache identity regardless of input ordering.
  const sortedKeys = [...playerKeys].sort();
  const cacheKey = `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:market-signals:${sortedKeys.join(',')}`;
  return withCacheGated(
    cacheKey,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttlLong, // 1h
    async () => {
      const api = new YahooFantasyAPI(userId);
      const map = await api.getPlayersMarketSignals(sortedKeys);
      const out: Record<string, PlayerMarketSignals> = {};
      for (const [key, val] of map) out[key] = val;
      return out;
    },
    // Multi-fan-out: one Yahoo call per player_key. A run that resolves
    // fewer than 70% is treated as a transient outage and not cached,
    // matching the canonical pattern in docs/data-architecture.md.
    (out) => Object.keys(out).length / sortedKeys.length >= 0.7,
  );
}
