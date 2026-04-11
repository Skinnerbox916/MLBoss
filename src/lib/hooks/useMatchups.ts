import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { MatchupData } from '@/lib/yahoo-fantasy-api';

/**
 * Get matchup schedule for a specific team.
 */
export function useMatchups(teamKey: string | undefined, weeks?: number[]) {
  const weeksParam = weeks ? `&weeks=${weeks.join(',')}` : '';
  const { data, error, isLoading } = useSWR(
    teamKey ? `/api/fantasy/matchups?teamKey=${teamKey}${weeksParam}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    matchups: (data?.matchups ?? []) as MatchupData[],
    isLoading,
    isError: !!error,
  };
}
