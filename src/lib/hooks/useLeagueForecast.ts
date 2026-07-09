import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { LeagueForecast } from '@/lib/league/forecast';
import type { PlayerCatLine } from '@/lib/league/rosterValue';

/**
 * Forward-looking per-category position vs. the rest of the league, plus
 * per-player value lines (the roster-value engine's projection facts).
 * Drives the roster page's leverage weights and player values for
 * **roster-move** decisions — distinct from `useCorrectedMatchupAnalysis`
 * which drives weekly start/sit and pickup decisions.
 *
 * The endpoint caches the heavy per-team aggregate fan-out at
 * SEMI_DYNAMIC.ttlLong (1 h) per league; the per-viewer rank/z math runs
 * on every request after the aggregates load.
 */
export interface LeagueForecastResponse extends LeagueForecast {
  playerValues?: {
    rostered: PlayerCatLine[];
    freeAgents: PlayerCatLine[];
  };
}

export function useLeagueForecast(
  leagueKey: string | undefined,
  teamKey: string | undefined,
) {
  const url = leagueKey && teamKey
    ? `/api/league/${leagueKey}/forecast?teamKey=${teamKey}`
    : null;
  const { data, error, isLoading } = useSWR<LeagueForecastResponse>(url, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 300_000,
  });
  return {
    forecast: data,
    isLoading,
    isError: !!error,
  };
}
