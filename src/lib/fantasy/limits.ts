import { YahooFantasyAPI } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';
import { getLeagueTeams } from './leagues';

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

export interface MovesBudget {
  /** League weekly add cap from settings (null = unlimited / not reported). */
  cap: number | null;
  /** Adds this team has used in the current coverage week (null = unknown). */
  used: number | null;
  /** cap − used, floored at 0; null when either side is unknown. */
  left: number | null;
  /** Yahoo's coverage week number for `used`, when reported. */
  week: number | null;
}

/**
 * The team's weekly transaction budget: league cap (settings) + adds used
 * (the team resource's `roster_adds` counter). Composes two already-cached
 * fetches, so `used` can lag a fresh add by up to the teams TTL (~10 min) —
 * fine for display; don't gate a transaction on it.
 */
export async function getMovesBudget(
  userId: string,
  leagueKey: string,
  teamKey: string,
): Promise<MovesBudget> {
  const [limits, teams] = await Promise.all([
    getLeagueLimits(userId, leagueKey),
    getLeagueTeams(userId, leagueKey),
  ]);
  const ra = teams.find(t => t.team_key === teamKey)?.roster_adds;
  const usedRaw = ra && ra.coverage_type === 'week' ? Number(ra.value) : NaN;
  const used = Number.isFinite(usedRaw) ? usedRaw : null;
  const cap = limits.maxWeeklyAdds;
  return {
    cap,
    used,
    left: cap != null && used != null ? Math.max(0, cap - used) : null,
    week: ra?.coverage_value ?? null,
  };
}
