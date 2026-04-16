import { YahooFantasyAPI, type FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';

/**
 * Get available pitchers (free agents + waivers) from a league.
 *
 * We query SP and RP separately and merge, because Yahoo's `position=P` filter
 * can return a narrow slice in leagues with split SP/RP slots. SP gets the
 * bulk of pagination (it's what the streaming board cares about); RP is also
 * included for completeness (some streamable long-relievers / openers).
 *
 * Semi-dynamic caching (5-minute TTL) — free agent pool shifts with transactions.
 */
export async function getAvailablePitchers(userId: string, leagueKey: string): Promise<FreeAgentPlayer[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:fa-pitchers:${leagueKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
    async () => {
      const api = new YahooFantasyAPI(userId);
      const [sp, rp] = await Promise.all([
        api.getLeaguePlayers(leagueKey, { position: 'SP', status: 'A', maxPages: 16 }), // up to 400 SPs
        api.getLeaguePlayers(leagueKey, { position: 'RP', status: 'A', maxPages: 4 }),  // up to 100 RPs
      ]);
      // Dedupe by player_key — SP/RP-eligible pitchers show up in both lists
      const seen = new Set<string>();
      const merged: FreeAgentPlayer[] = [];
      for (const p of [...sp, ...rp]) {
        if (seen.has(p.player_key)) continue;
        seen.add(p.player_key);
        merged.push(p);
      }
      return merged;
    },
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
 * Fetches up to 50 batters sorted by Yahoo's relevance ranking.
 */
export async function getAvailableBatters(userId: string, leagueKey: string): Promise<FreeAgentPlayer[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:fa-batters-full:${leagueKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
    async () => {
      const api = new YahooFantasyAPI(userId);
      return api.getLeaguePlayers(leagueKey, { position: 'B', status: 'A', maxPages: 2, count: 25 });
    },
  );
}
