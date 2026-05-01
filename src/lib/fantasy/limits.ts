import { YahooFantasyAPI } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';

export interface LeagueLimits {
  /** Maximum weekly free-agent / waiver adds (null = unlimited). */
  maxWeeklyAdds: number | null;
  /** Maximum innings pitched cap (null = no cap). */
  maxInningsPitched: number | null;
  /** Maximum games started cap (null = no cap). */
  maxGamesStarted: number | null;
}

/**
 * League weekly caps (transactions, IP, GS) read from Yahoo settings.
 *
 * Cached at the static tier — settings only change between seasons or via
 * commissioner edit, and a stale cap value is preferable to N hits per
 * dashboard load.
 */
export async function getLeagueLimits(
  userId: string,
  leagueKey: string,
): Promise<LeagueLimits> {
  return withCache(
    `${CACHE_CATEGORIES.STATIC.prefix}:league-limits:${leagueKey}`,
    CACHE_CATEGORIES.STATIC.ttl,
    () => new YahooFantasyAPI(userId).getLeagueLimits(leagueKey),
  );
}
