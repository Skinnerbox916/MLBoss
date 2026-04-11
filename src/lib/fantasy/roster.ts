import { YahooFantasyAPI, RosterEntry } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';

/**
 * Get team roster (today) with caching.
 * Uses Dynamic caching (1-minute TTL) — roster changes when lineups are set.
 */
export async function getTeamRoster(userId: string, teamKey: string): Promise<RosterEntry[]> {
  return withCache(
    `${CACHE_CATEGORIES.DYNAMIC.prefix}:roster:${teamKey}`,
    CACHE_CATEGORIES.DYNAMIC.ttl,
    () => new YahooFantasyAPI(userId).getTeamRoster(teamKey),
  );
}

/**
 * Get team roster for a specific date.
 * Uses Dynamic caching (1-minute TTL).
 */
export async function getTeamRosterByDate(userId: string, teamKey: string, date: string): Promise<RosterEntry[]> {
  return withCache(
    `${CACHE_CATEGORIES.DYNAMIC.prefix}:roster:${teamKey}:${date}`,
    CACHE_CATEGORIES.DYNAMIC.ttl,
    () => new YahooFantasyAPI(userId).getTeamRoster(teamKey, { date }),
  );
}
