import { useMemo } from 'react';
import { useGameDay, type EnrichedGame } from './useGameDay';
import { useRoster } from './useRoster';
import { matchProbableStarts, type MatchedProbable } from '@/lib/pitching/probableMatch';
import { getMatchupWeekDays, type WeekDay } from '@/lib/dashboard/weekRange';

export interface DayProbables {
  /** Pre-computed week-day metadata (date, label, today flag, etc.). */
  day: WeekDay;
  /** Matched probable starts for this team on this day. */
  starts: MatchedProbable[];
}

interface UseWeekProbablesResult {
  /** Mon..Sun, exactly seven entries. */
  days: WeekDay[];
  /** Per-day matched probables for the user's roster. */
  myStarts: DayProbables[];
  /** Per-day matched probables for the opponent's roster. */
  oppStarts: DayProbables[];
  /** Total starts remaining (today + future) for each side. */
  myRemaining: number;
  oppRemaining: number;
  isLoading: boolean;
}

/**
 * Multi-day probable-pitcher runway for the current matchup week.
 *
 * Fetches each of the seven matchup-week days (Mon..Sun) in parallel via
 * `useGameDay`, then matches each rostered pitcher to a probable start on
 * any day where their MLB team plays. Surfaces both per-day breakdowns
 * (for the day-strip rendering) and a single "starts remaining" count.
 *
 * Hook count is stable: we always call `useGameDay` exactly seven times,
 * one per matchup-week day, so React's hook-order rule is satisfied.
 */
export function useWeekProbables(
  myTeamKey: string | undefined,
  opponentTeamKey: string | undefined,
): UseWeekProbablesResult {
  const days = useMemo(() => getMatchupWeekDays(), []);

  // Both rosters as of today — we don't need date-shifted views for runway.
  const { roster: myRoster, isLoading: myRosterLoading } = useRoster(myTeamKey);
  const { roster: oppRoster, isLoading: oppRosterLoading } = useRoster(opponentTeamKey);

  // Stable hook order: seven calls, one per Mon..Sun day.
  const day0 = useGameDay(days[0]?.date);
  const day1 = useGameDay(days[1]?.date);
  const day2 = useGameDay(days[2]?.date);
  const day3 = useGameDay(days[3]?.date);
  const day4 = useGameDay(days[4]?.date);
  const day5 = useGameDay(days[5]?.date);
  const day6 = useGameDay(days[6]?.date);
  const dayResults = [day0, day1, day2, day3, day4, day5, day6];

  const isLoading =
    myRosterLoading ||
    oppRosterLoading ||
    dayResults.some(d => d.isLoading);

  const myStarts: DayProbables[] = useMemo(
    () =>
      days.map((day, i): DayProbables => ({
        day,
        starts: matchProbableStarts(myRoster, dayResults[i].games as EnrichedGame[]),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, myRoster, day0.games, day1.games, day2.games, day3.games, day4.games, day5.games, day6.games],
  );

  const oppStarts: DayProbables[] = useMemo(
    () =>
      days.map((day, i): DayProbables => ({
        day,
        starts: matchProbableStarts(oppRoster, dayResults[i].games as EnrichedGame[]),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, oppRoster, day0.games, day1.games, day2.games, day3.games, day4.games, day5.games, day6.games],
  );

  const myRemaining = myStarts
    .filter(d => d.day.isRemaining)
    .reduce((sum, d) => sum + d.starts.length, 0);
  const oppRemaining = oppStarts
    .filter(d => d.day.isRemaining)
    .reduce((sum, d) => sum + d.starts.length, 0);

  return {
    days,
    myStarts,
    oppStarts,
    myRemaining,
    oppRemaining,
    isLoading,
  };
}
