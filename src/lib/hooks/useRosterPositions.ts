import useSWR from 'swr';
import { fetcher } from './fetcher';

export interface RosterPositionSlot {
  position: string;
  count: number;
  position_type?: string;
}

/**
 * Fetch the league's roster slot template (positions + counts).
 * Stable for an entire season — SWR dedupes across the app.
 */
export function useRosterPositions(leagueKey: string | undefined) {
  const { data, error, isLoading } = useSWR(
    leagueKey ? `/api/fantasy/roster-positions?leagueKey=${leagueKey}` : null,
    fetcher,
    { revalidateOnFocus: false, revalidateIfStale: false },
  );

  return {
    positions: (data?.positions ?? []) as RosterPositionSlot[],
    isLoading,
    isError: !!error,
  };
}
