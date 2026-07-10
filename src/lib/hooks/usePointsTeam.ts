import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { PointsTeamAnalysis } from '@/lib/points/analyzeTeam';
import type { WeekTarget } from '@/lib/dashboard/weekRange';
import { encodePreferredDepth, type PreferredDepthMap } from '@/lib/roster/preferredDepth';

export type PointsTeamResponse = PointsTeamAnalysis & {
  leagueKey: string;
  teamKey: string;
  scoringType: string;
};

/**
 * Points-league team analysis for the UI. Only call when the active league's
 * `scoringProfile.mode === 'points'`; the route 400s otherwise. SWR key is
 * null until keys are known so the request is deferred during bootstrap.
 */
export function usePointsTeam(
  leagueKey: string | undefined,
  teamKey: string | undefined,
  scoringType: string | undefined,
  week: WeekTarget = 'current',
  /** Target-depth overrides — rides as the `depth` param so the server's
   *  depth chart + swap engine honor the user's steppers. */
  preferredDepth?: PreferredDepthMap,
) {
  const canFetch = Boolean(leagueKey && teamKey);
  const depthParam = preferredDepth ? encodePreferredDepth(preferredDepth) : '';
  const url = canFetch
    ? `/api/points/team?teamKey=${encodeURIComponent(teamKey!)}&leagueKey=${encodeURIComponent(leagueKey!)}&scoringType=${encodeURIComponent(scoringType ?? '')}&week=${week}${depthParam ? `&depth=${encodeURIComponent(depthParam)}` : ''}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<PointsTeamResponse>(url, fetcher, {
    revalidateOnFocus: false,
  });

  return { data, isLoading, isError: !!error, mutate };
}
