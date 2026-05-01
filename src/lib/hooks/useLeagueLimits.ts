import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { LeagueLimits } from '@/lib/fantasy/limits';

interface LimitsResponse {
  league_key: string;
  limits: LeagueLimits;
}

/**
 * League weekly caps (transactions, IP, GS).
 *
 * Static-tier data; SWR doesn't refresh on focus. Returns nullable fields
 * for caps that aren't configured in the league.
 */
export function useLeagueLimits(leagueKey: string | undefined) {
  const { data, error, isLoading } = useSWR<LimitsResponse>(
    leagueKey ? `/api/fantasy/league-limits?leagueKey=${leagueKey}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    limits: data?.limits as LeagueLimits | undefined,
    isLoading,
    isError: !!error,
  };
}
