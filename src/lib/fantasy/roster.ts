import { YahooFantasyAPI, RosterEntry } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES, invalidateCachePattern } from './cache';

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

/**
 * Get the league's roster slot template (ordered list of { position, count }).
 * Static-cached — league roster rules almost never change mid-season.
 */
export async function getLeagueRosterPositions(
  userId: string,
  leagueKey: string,
): Promise<Array<{ position: string; count: number; position_type?: string }>> {
  return withCache(
    `${CACHE_CATEGORIES.STATIC.prefix}:roster-positions:${leagueKey}`,
    CACHE_CATEGORIES.STATIC.ttl,
    () => new YahooFantasyAPI(userId).getLeagueRosterPositions(leagueKey),
  );
}

/**
 * Set the full roster for a team on a given date and invalidate any cached
 * roster entries for that team so subsequent reads reflect the new state.
 */
export async function setTeamRoster(
  userId: string,
  teamKey: string,
  date: string,
  players: Array<{ player_key: string; position: string }>,
): Promise<void> {
  await new YahooFantasyAPI(userId).setRoster(teamKey, date, players);

  // Bust every cached variant for this team: today's roster and any dated roster.
  await invalidateCachePattern(`${CACHE_CATEGORIES.DYNAMIC.prefix}:roster:${teamKey}`);
}
