import useSWR from 'swr';
import { fetcher } from './fetcher';

export interface FantasyLeagueContext {
  league_key: string;
  league_name: string;
  league_type: string;
  scoring_type: string;
  current_week?: string;
  total_teams: number;
  is_finished?: number;
  user_team: {
    team_key: string;
    team_name: string;
    waiver_priority?: number;
  } | null;
}

export interface FantasyContext {
  game_key: string;
  season: string;
  leagues: FantasyLeagueContext[];
  primary_league_key?: string;
  primary_team_key?: string;
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
    isLoading,
    isError: !!error,
  };
}
