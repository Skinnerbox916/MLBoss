import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { PointsTeamAnalysis } from '@/lib/points/analyzeTeam';
import type { WeekTarget } from '@/lib/dashboard/weekRange';

export type PointsTeamResponse = PointsTeamAnalysis & {
  leagueKey: string;
  teamKey: string;
  scoringType: string;
};

/**
 * Points-league team analysis for the UI. Only call when the active league's
 * `scoringProfile.mode === 'points'`; the route 400s otherwise. SWR key is
 * null until keys are known so the request is deferred during bootstrap.
 *
 * `includeFA: false` skips the FA pool — no replacement levels, VOR, or
 * suggested swaps, just the roster's own projection. Use it when all you need
 * is `weekProjectedPoints` (matchup outlooks): the full pipeline's fan-out is
 * the expensive half, and it caches under a separate key.
 */
export function usePointsTeam(
  leagueKey: string | undefined,
  teamKey: string | undefined,
  scoringType: string | undefined,
  week: WeekTarget = 'current',
  opts: { includeFA?: boolean } = {},
) {
  const canFetch = Boolean(leagueKey && teamKey);
  const faParam = opts.includeFA === false ? '&includeFA=0' : '';
  const url = canFetch
    ? `/api/points/team?teamKey=${encodeURIComponent(teamKey!)}&leagueKey=${encodeURIComponent(leagueKey!)}&scoringType=${encodeURIComponent(scoringType ?? '')}&week=${week}${faParam}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<PointsTeamResponse>(url, fetcher, {
    revalidateOnFocus: false,
  });

  return { data, isLoading, isError: !!error, mutate };
}
