import { useMemo } from 'react';
import { useGameDay, type EnrichedGame } from './useGameDay';
import { useRoster } from './useRoster';
import { matchProbableStarts, type MatchedProbable } from '@/lib/pitching/probableMatch';
import { getMatchupWeekDays, type WeekBounds, type WeekDay } from '@/lib/dashboard/weekRange';

export interface DayProbables {
  /** Pre-computed week-day metadata (date, label, today flag, etc.). */
  day: WeekDay;
  /** Matched probable starts for this team on this day. */
  starts: MatchedProbable[];
}

interface UseWeekProbablesResult {
  /** Every day of the matchup week — 7 normally, up to 14 in a combined week. */
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
 * Fetches each matchup-week day in parallel via `useGameDay`, then matches
 * each rostered pitcher to a probable start on any day where their MLB team
 * plays. Surfaces both per-day breakdowns (for the day-strip rendering) and
 * a single "starts remaining" count.
 *
 * Hook count is stable: we always call `useGameDay` exactly fourteen times
 * (the longest possible matchup week — the combined all-star week), so
 * React's hook-order rule is satisfied; slots past the real week length get
 * `undefined` and skip their fetch.
 */
export function useWeekProbables(
  myTeamKey: string | undefined,
  opponentTeamKey: string | undefined,
  weekBounds?: WeekBounds,
): UseWeekProbablesResult {
  const days = useMemo(() => getMatchupWeekDays(new Date(), weekBounds), [weekBounds]);

  // Roster as of the LAST remaining day of the matchup week — captures
  // pickups effective for upcoming starts that aren't on today's roster
  // snapshot yet. The remaining-starts count and day strip both reflect
  // pending pickups this way. See `docs/history.md`
  // "Always-fetch-roster-by-date".
  const rosterDate = useMemo(() => {
    const remaining = days.filter(d => d.isRemaining);
    return remaining[remaining.length - 1]?.date;
  }, [days]);

  const { roster: myRoster, isLoading: myRosterLoading } = useRoster(myTeamKey, rosterDate);
  const { roster: oppRoster, isLoading: oppRosterLoading } = useRoster(opponentTeamKey, rosterDate);

  // Stable hook order: fourteen calls, one per possible matchup-week day.
  const day0 = useGameDay(days[0]?.date);
  const day1 = useGameDay(days[1]?.date);
  const day2 = useGameDay(days[2]?.date);
  const day3 = useGameDay(days[3]?.date);
  const day4 = useGameDay(days[4]?.date);
  const day5 = useGameDay(days[5]?.date);
  const day6 = useGameDay(days[6]?.date);
  const day7 = useGameDay(days[7]?.date);
  const day8 = useGameDay(days[8]?.date);
  const day9 = useGameDay(days[9]?.date);
  const day10 = useGameDay(days[10]?.date);
  const day11 = useGameDay(days[11]?.date);
  const day12 = useGameDay(days[12]?.date);
  const day13 = useGameDay(days[13]?.date);
  const dayResults = [day0, day1, day2, day3, day4, day5, day6, day7, day8, day9, day10, day11, day12, day13];

  const isLoading =
    myRosterLoading ||
    oppRosterLoading ||
    dayResults.some(d => d.isLoading);

  // Pass all games through to the matcher — including today's already-
  // concluded ones. The Boss Card day strip wants completed starts
  // visible (rendered as ✓ via `MatchedProbable.hasPitched`), and the
  // remaining-count is now driven by IP projections (route-side) rather
  // than start counts. See [[reference-mlboss-deployment]] for the
  // redesign that motivates this.
  const myStarts: DayProbables[] = useMemo(
    () =>
      days.map((day, i): DayProbables => {
        const games = (dayResults[i]?.games ?? []) as EnrichedGame[];
        return { day, starts: matchProbableStarts(myRoster, games) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, myRoster, ...dayResults.map(d => d.games)],
  );

  const oppStarts: DayProbables[] = useMemo(
    () =>
      days.map((day, i): DayProbables => {
        const games = (dayResults[i]?.games ?? []) as EnrichedGame[];
        return { day, starts: matchProbableStarts(oppRoster, games) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, oppRoster, ...dayResults.map(d => d.games)],
  );

  // "Remaining" excludes past days entirely (they're informational only)
  // AND today's already-concluded starts (game's been played). The strip
  // still renders all of them — this count is just for the headline.
  const myRemaining = myStarts
    .filter(d => d.day.isRemaining)
    .reduce((sum, d) => sum + d.starts.filter(s => !s.hasPitched).length, 0);
  const oppRemaining = oppStarts
    .filter(d => d.day.isRemaining)
    .reduce((sum, d) => sum + d.starts.filter(s => !s.hasPitched).length, 0);

  return {
    days,
    myStarts,
    oppStarts,
    myRemaining,
    oppRemaining,
    isLoading,
  };
}
