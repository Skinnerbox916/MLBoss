import { YahooFantasyAPI, MatchupData } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';

/**
 * Get league scoreboard (all matchups) for a given week.
 * Uses Dynamic caching (1-minute TTL) — scores change frequently during games.
 * Omit `week` for the current week.
 */
export async function getLeagueScoreboard(
  userId: string,
  leagueKey: string,
  week?: number,
): Promise<MatchupData[]> {
  const weekSuffix = week !== undefined ? `:week${week}` : ':current';
  return withCache(
    `${CACHE_CATEGORIES.DYNAMIC.prefix}:scoreboard:${leagueKey}${weekSuffix}`,
    CACHE_CATEGORIES.DYNAMIC.ttl,
    () => new YahooFantasyAPI(userId).getLeagueScoreboard(leagueKey, week),
  );
}

/**
 * Get matchup schedule for a specific team.
 * Uses Semi-dynamic caching (1-hour TTL) — schedule doesn't change often.
 */
export async function getTeamMatchups(
  userId: string,
  teamKey: string,
  weeks?: number[],
): Promise<MatchupData[]> {
  const weeksSuffix = weeks ? `:weeks${weeks.join(',')}` : ':all';
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:matchups:${teamKey}${weeksSuffix}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttlLong,
    () => new YahooFantasyAPI(userId).getTeamMatchups(teamKey, weeks),
  );
}
