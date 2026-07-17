import { useMemo } from 'react';
import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import type { WeekBounds } from '@/lib/dashboard/weekRange';

export interface FantasyLeagueContext {
  league_key: string;
  league_name: string;
  league_type: string;
  scoring_type: string;
  /** Yahoo lineup deadline: '' / 'intraday' = daily; a day value = weekly. */
  weekly_deadline?: string;
  /** Earliest editable roster date (YYYY-MM-DD) — when a move made now hits. */
  edit_key?: string;
  current_week?: string;
  /** Real date range of the current matchup week (Yahoo game_weeks calendar
   *  — not always 7 days; the all-star break is one combined ~14-day week). */
  week_start?: string;
  week_end?: string;
  /** Next matchup week's range; null on the season's final week. */
  next_week_start?: string | null;
  next_week_end?: string | null;
  total_teams: number;
  is_finished?: number;
  user_team: {
    team_key: string;
    team_name: string;
    waiver_priority?: number;
  } | null;
}

/**
 * Build a `WeekBounds` off a league's context entry. Undefined while the
 * context is loading or when the calendar fetch failed server-side — every
 * `weekRange` helper then falls back to the legacy Mon–Sun derivation.
 */
export function weekBoundsForLeague(league: FantasyLeagueContext | undefined): WeekBounds | undefined {
  if (!league?.week_start || !league?.week_end) return undefined;
  return {
    week: league.current_week !== undefined ? Number(league.current_week) : undefined,
    start: league.week_start,
    end: league.week_end,
    nextStart: league.next_week_start ?? null,
    nextEnd: league.next_week_end ?? null,
  };
}

export interface FantasyContext {
  game_key: string;
  season: string;
  leagues: FantasyLeagueContext[];
  primary_league_key?: string;
  primary_team_key?: string;
  primary_scoring_profile?: ScoringProfile;
}

/**
 * Bootstrap hook — fetches the user's league and team keys.
 * Call this once at the top level; pass league/team keys down to other hooks.
 */
export function useFantasyContext() {
  const { data, error, isLoading } = useSWR<FantasyContext>(
    '/api/fantasy/context',
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    context: data,
    leagueKey: data?.primary_league_key,
    teamKey: data?.primary_team_key,
    currentWeek: data?.leagues?.find(l => l.league_key === data.primary_league_key)?.current_week,
    scoringProfile: data?.primary_scoring_profile,
    isLoading,
    isError: !!error,
  };
}

/**
 * Matchup-week bounds for a league (defaults to the primary league when no
 * key is passed). SWR de-dupes the underlying context fetch, so calling this
 * from several hooks/components costs nothing extra. Memoized so the bounds
 * object is referentially stable — downstream hooks use it as a memo dep.
 */
export function useLeagueWeekBounds(leagueKey?: string): WeekBounds | undefined {
  const { context } = useFantasyContext();
  const key = leagueKey ?? context?.primary_league_key;
  const league = context?.leagues?.find(l => l.league_key === key);
  return useMemo(() => weekBoundsForLeague(league), [league]);
}
