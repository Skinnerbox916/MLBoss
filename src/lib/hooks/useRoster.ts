import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';

/**
 * Get team roster for today (or a specific date).
 */
export function useRoster(teamKey: string | undefined, date?: string) {
  const dateParam = date ? `&date=${date}` : '';
  const { data, error, isLoading, mutate } = useSWR(
    teamKey ? `/api/fantasy/roster?teamKey=${teamKey}${dateParam}` : null,
    fetcher,
    // Refresh matches the server-side dynamic-tier TTL so an open page
    // picks up roster moves without a manual reload.
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );

  return {
    roster: (data?.roster ?? []) as RosterEntry[],
    isLoading,
    isError: !!error,
    mutate,
  };
}
