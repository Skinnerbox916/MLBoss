import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { PointsStreamingAnalysis } from '@/lib/points/streaming';

export type PointsStreamingResponse = PointsStreamingAnalysis & {
  leagueKey: string;
  teamKey: string;
  scoringType: string;
};

/**
 * Points-league streaming analysis (coverage + pitcher streams + batter
 * plugs). Only call when the active league's `scoringProfile.mode ===
 * 'points'`; the route 400s otherwise.
 */
export function usePointsStreaming(
  leagueKey: string | undefined,
  teamKey: string | undefined,
  scoringType: string | undefined,
) {
  const canFetch = Boolean(leagueKey && teamKey);
  const url = canFetch
    ? `/api/points/streaming?teamKey=${encodeURIComponent(teamKey!)}&leagueKey=${encodeURIComponent(leagueKey!)}&scoringType=${encodeURIComponent(scoringType ?? '')}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<PointsStreamingResponse>(url, fetcher, {
    revalidateOnFocus: false,
  });

  return { data, isLoading, isError: !!error, mutate };
}
