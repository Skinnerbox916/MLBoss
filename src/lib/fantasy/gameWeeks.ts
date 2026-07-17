import { YahooFantasyAPI, type GameWeek } from '@/lib/yahoo-fantasy-api';
import { withCacheGated, CACHE_CATEGORIES } from './cache';
import { getUserLeagues } from './leagues';
import type { WeekBounds } from '@/lib/dashboard/weekRange';

export type { GameWeek };

/**
 * The season's matchup-week calendar — authoritative start/end dates for
 * every week, from Yahoo's `game_weeks` resource. This is what makes the app
 * aware that week 1 is short and the all-star break is one combined ~14-day
 * matchup week; nothing downstream should assume Mon–Sun.
 *
 * Static tier: the calendar is fixed for the whole season. Gated so a
 * partial/empty parse isn't pinned for 48h.
 */
export async function getGameWeeks(userId: string, gameKey: string): Promise<GameWeek[]> {
  return withCacheGated(
    `${CACHE_CATEGORIES.STATIC.prefix}:game-weeks:${gameKey}`,
    CACHE_CATEGORIES.STATIC.ttlLong,
    () => new YahooFantasyAPI(userId).getGameWeeks(gameKey),
    (weeks) => weeks.length > 0,
  );
}

/**
 * Pure resolver: the current + next week's date ranges for a league sitting
 * on `currentWeek` of the given calendar. `nextStart`/`nextEnd` are null on
 * the season's final week (terminal — no next matchup exists). Returns
 * undefined when the week isn't in the calendar (bad input / off-season).
 */
export function resolveWeekBounds(
  gameWeeks: GameWeek[],
  currentWeek: number | string | undefined,
): WeekBounds | undefined {
  const weekNum = Number(currentWeek);
  if (!Number.isFinite(weekNum)) return undefined;
  const current = gameWeeks.find(w => w.week === weekNum);
  if (!current) return undefined;
  const next = gameWeeks.find(w => w.week === weekNum + 1);
  return {
    week: current.week,
    start: current.start,
    end: current.end,
    nextStart: next?.start ?? null,
    nextEnd: next?.end ?? null,
  };
}

/**
 * Authoritative matchup-week bounds for a league, resolved server-side:
 * league's `current_week` (cached league list) against the game's week
 * calendar. Route handlers pass this into the `weekRange` helpers so server
 * windows follow Yahoo's real calendar. Returns undefined on any failure —
 * consumers fall back to the legacy Mon–Sun derivation.
 */
export async function getWeekBounds(userId: string, leagueKey: string): Promise<WeekBounds | undefined> {
  try {
    const gameKey = leagueKey.split('.')[0];
    if (!gameKey) return undefined;
    const [leagues, gameWeeks] = await Promise.all([
      getUserLeagues(userId),
      getGameWeeks(userId, gameKey),
    ]);
    const league = leagues.find(l => l.league_key === leagueKey);
    return resolveWeekBounds(gameWeeks, league?.current_week);
  } catch (error) {
    console.warn('[gameWeeks] getWeekBounds failed; falling back to Mon–Sun weeks:', error);
    return undefined;
  }
}
