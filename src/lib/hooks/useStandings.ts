import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { StandingsEntry } from '@/lib/yahoo-fantasy-api';

export function useStandings(leagueKey: string | undefined) {
  const { data, error, isLoading } = useSWR(
    leagueKey ? `/api/fantasy/standings?leagueKey=${leagueKey}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    standings: (data?.standings ?? []) as StandingsEntry[],
    isLoading,
    isError: !!error,
  };
}
