import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { LeagueForecast } from '@/lib/league/forecast';

/**
 * Forward-looking per-category position vs. the rest of the league. Drives
 * the roster page's chase / hold / punt suggestions for **roster-move**
 * decisions — distinct from `useCorrectedMatchupAnalysis` which drives
 * weekly start/sit and pickup decisions.
 *
 * The endpoint caches the heavy per-team aggregate fan-out at
 * SEMI_DYNAMIC.ttlLong (1 h) per league; the per-viewer rank/z math runs
 * on every request after the aggregates load.
 */
export function useLeagueForecast(
  leagueKey: string | undefined,
  teamKey: string | undefined,
) {
  const url = leagueKey && teamKey
    ? `/api/league/${leagueKey}/forecast?teamKey=${teamKey}`
    : null;
  const { data, error, isLoading } = useSWR<LeagueForecast>(url, fetcher, {
    revalidateOnFocus: false,
  });
  return {
    forecast: data,
    isLoading,
    isError: !!error,
  };
}
