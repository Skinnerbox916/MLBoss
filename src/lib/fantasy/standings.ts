import { YahooFantasyAPI, StandingsEntry } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';

/**
 * Get league standings with caching.
 * Uses Semi-dynamic caching (10-minute TTL) — standings update daily/weekly.
 */
export async function getLeagueStandings(userId: string, leagueKey: string): Promise<StandingsEntry[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:standings:${leagueKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttlMedium,
    () => new YahooFantasyAPI(userId).getLeagueStandings(leagueKey),
  );
}
