import { useMemo } from 'react';
import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { TeamStreamRate } from '@/lib/projection/streamVolume';

interface StreamRatesResponse {
  streamRates: TeamStreamRate[];
}

/**
 * Per-team expected streamed starts for the upcoming week (recency-weighted
 * SP adds/week from the league transaction feed, capped by the weekly add
 * limit). Returns a `Map<teamKey, expectedStreamStarts>` for direct lookup.
 *
 * Feeds `useCorrectedMatchupAnalysis`'s next-week pivot so a projected
 * matchup reflects each manager's demonstrated streaming instead of assuming
 * both rosters stand pat. Rate estimate moves slowly (3-week half-life) and
 * is league-cached server-side; the hook just reads it.
 */
export function useLeagueStreamRates(leagueKey: string | undefined) {
  const { data, error, isLoading } = useSWR<StreamRatesResponse>(
    leagueKey ? `/api/league/${leagueKey}/stream-rates` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const startsByTeamKey = useMemo(
    () => new Map<string, number>(
      (data?.streamRates ?? []).map(r => [r.teamKey, r.expectedStreamStarts]),
    ),
    [data],
  );

  return {
    streamRates: data?.streamRates ?? [],
    startsByTeamKey,
    isLoading,
    isError: !!error,
  };
}
