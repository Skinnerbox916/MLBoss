import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { TeamOffense } from '@/lib/mlb/teams';

/**
 * Fetch offensive profiles for a set of MLB team IDs.
 * Returns a map of mlbTeamId → TeamOffense.
 * Refreshes hourly — team stats don't move much intra-day.
 */
export function useTeamOffense(teamIds: number[]) {
  const key = teamIds.length > 0
    ? `/api/mlb/team-offense?teamIds=${teamIds.join(',')}`
    : null;

  const { data, error, isLoading } = useSWR(
    key,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 3600_000 },
  );

  const teams: Record<number, TeamOffense> = data?.teams ?? {};

  return {
    teams,
    isLoading,
    isError: !!error,
  };
}
