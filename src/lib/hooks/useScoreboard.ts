import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { MatchupData } from '@/lib/yahoo-fantasy-api';

/**
 * Get all matchups for a given week (omit week for current).
 * Refreshes every 60 seconds since scores change during games.
 */
export function useScoreboard(leagueKey: string | undefined, week?: number | string) {
  const weekParam = week !== undefined ? `&week=${week}` : '';
  const { data, error, isLoading } = useSWR(
    leagueKey ? `/api/fantasy/scoreboard?leagueKey=${leagueKey}${weekParam}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );

  return {
    matchups: (data?.matchups ?? []) as MatchupData[],
    week: data?.week,
    isLoading,
    isError: !!error,
  };
}
