import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';

export function useAvailableBatters(leagueKey: string | undefined) {
  const { data, error, isLoading } = useSWR(
    leagueKey ? `/api/fantasy/players?leagueKey=${leagueKey}&position=B` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    batters: (data?.players ?? []) as FreeAgentPlayer[],
    isLoading,
    isError: !!error,
  };
}
