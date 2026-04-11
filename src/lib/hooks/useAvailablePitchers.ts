import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';

/**
 * Fetch available pitchers (free agents + waivers) for a league.
 * Refreshes every 5 minutes to match server-side cache TTL.
 */
export function useAvailablePitchers(leagueKey: string | undefined) {
  const { data, error, isLoading } = useSWR(
    leagueKey ? `/api/fantasy/players?leagueKey=${leagueKey}&position=P` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 300_000 },
  );

  return {
    players: (data?.players ?? []) as FreeAgentPlayer[],
    isLoading,
    isError: !!error,
  };
}
