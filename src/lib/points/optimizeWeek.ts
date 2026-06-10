/**
 * Server-side points-league week optimizer — sets the optimal batting lineup
 * in Yahoo for every remaining day of the current fantasy week (Mon–Sun).
 *
 * The points equivalent of the categories `optimizeWeek` (which runs
 * client-side). Points scoring lives server-side, so this does the whole
 * loop server-side and writes via `setTeamRoster`:
 *   per day → fetch roster + slate → score each batter by points × that day's
 *   expected PA → Hungarian slot assignment (`optimizeLineup`) → write.
 *
 * Mirrors the categories optimizer's day handling (`datesThroughEndOfWeek`,
 * full-roster save payload) so the two behave identically apart from the
 * scoring objective.
 */

import { getTeamRosterByDate, getLeagueRosterPositions, setTeamRoster } from '@/lib/fantasy';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import { getGameDay } from '@/lib/mlb/schedule';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import { getCachedLineupSpots } from '@/lib/mlb/lineupSpots';
import { datesThroughEndOfWeek } from '@/lib/lineup/optimizeWeek';
import { optimizeLineup } from '@/lib/lineup/optimize';
import { isPitcher } from '@/components/lineup/types';
import type { EnrichedGame, BatterSeasonStats } from '@/lib/mlb/types';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import { buildBattingSlots } from './lineupOptimizer';
import { batterPointsPerPA } from './pointsValue';
import { resolveBatterVolume } from './schedule';

export interface PointsWeekDayResult {
  date: string;
  saved: boolean;
  changeCount: number;
  error?: string;
}

export interface PointsWeekResult {
  days: PointsWeekDayResult[];
  succeeded: number;
  failed: number;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function optimizeOneDay(
  userId: string,
  leagueKey: string,
  teamKey: string,
  profile: ScoringProfile,
  date: string,
  rosterPositions: Awaited<ReturnType<typeof getLeagueRosterPositions>>,
): Promise<PointsWeekDayResult> {
  const [roster, games] = await Promise.all([
    getTeamRosterByDate(userId, teamKey, date),
    getGameDay(date),
  ]);
  const gamesByDate = new Map<string, EnrichedGame[]>([[date, games as EnrichedGame[]]]);
  const dayList = [{ date, dayLabel: date, isRemaining: true, isToday: false }] as Parameters<typeof resolveBatterVolume>[3];

  const batters = roster.filter(p => !isPitcher(p));
  const statsRecord = await getRosterSeasonStats(
    batters.map(p => ({ name: p.name, team: p.editorial_team_abbr })),
  );
  const key = (name: string, team: string) => `${name.toLowerCase()}|${team.toLowerCase()}`;
  const statsByKey = new Map<string, BatterSeasonStats>();
  for (const p of batters) {
    const s = statsRecord[key(p.name, p.editorial_team_abbr)];
    if (s) statsByKey.set(key(p.name, p.editorial_team_abbr), s);
  }
  const lineupSpots = await getCachedLineupSpots([...statsByKey.values()].map(s => s.mlbId).filter(id => id > 0));

  const getScore = (p: RosterEntry): number => {
    const stats = statsByKey.get(key(p.name, p.editorial_team_abbr));
    if (!stats) return 0;
    const posted = p.batting_order;
    const spot = posted && posted >= 1 && posted <= 9 ? posted : (lineupSpots.get(stats.mlbId) ?? null);
    const vol = resolveBatterVolume(p.editorial_team_abbr, spot, gamesByDate, dayList);
    return batterPointsPerPA(stats, profile) * vol.expectedPA;
  };

  const overrides = optimizeLineup(buildBattingSlots(rosterPositions), roster, getScore);
  if (overrides.size === 0) return { date, saved: false, changeCount: 0 };

  const players = roster.map(p => ({
    player_key: p.player_key,
    position: overrides.get(p.player_key) ?? p.selected_position,
  }));
  await setTeamRoster(userId, teamKey, date, players);
  return { date, saved: true, changeCount: overrides.size };
}

/**
 * Optimize + write the batting lineup for every remaining day of the current
 * fantasy week. Days run sequentially to stay under Yahoo's rate limit and to
 * produce a clean per-day report.
 */
export async function optimizePointsWeek(
  userId: string,
  leagueKey: string,
  teamKey: string,
  profile: ScoringProfile,
  startDate?: string,
): Promise<PointsWeekResult> {
  const today = todayStr();
  const start = !startDate || startDate < today ? today : startDate;
  const dates = datesThroughEndOfWeek(start);
  const rosterPositions = await getLeagueRosterPositions(userId, leagueKey);

  const days: PointsWeekDayResult[] = [];
  for (const date of dates) {
    try {
      days.push(await optimizeOneDay(userId, leagueKey, teamKey, profile, date, rosterPositions));
    } catch (e) {
      days.push({ date, saved: false, changeCount: 0, error: e instanceof Error ? e.message : 'unknown error' });
    }
  }

  return {
    days,
    succeeded: days.filter(d => !d.error).length,
    failed: days.filter(d => !!d.error).length,
  };
}
