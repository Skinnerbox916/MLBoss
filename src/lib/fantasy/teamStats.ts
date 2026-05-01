import { YahooFantasyAPI, TeamStats } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';

/**
 * Get season-to-date team stats with caching.
 * Uses Semi-dynamic caching (5-minute TTL).
 */
export async function getTeamStatsSeason(userId: string, teamKey: string): Promise<TeamStats> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:team-stats-season:${teamKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
    () => new YahooFantasyAPI(userId).getTeamStats(teamKey),
  );
}

/**
 * Get weekly team stats with caching.
 * Uses Dynamic caching (1-minute TTL) — weekly stats update during games.
 */
export async function getTeamStatsWeek(userId: string, teamKey: string, week: number): Promise<TeamStats> {
  return withCache(
    `${CACHE_CATEGORIES.DYNAMIC.prefix}:team-stats-week:${teamKey}:week${week}`,
    CACHE_CATEGORIES.DYNAMIC.ttl,
    () => new YahooFantasyAPI(userId).getTeamStats(teamKey, week),
  );
}
