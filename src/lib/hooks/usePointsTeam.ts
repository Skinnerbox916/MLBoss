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
 */
export function usePointsTeam(
  leagueKey: string | undefined,
  teamKey: string | undefined,
  scoringType: string | undefined,
  week: WeekTarget = 'current',
) {
  const canFetch = Boolean(leagueKey && teamKey);
  const url = canFetch
    ? `/api/points/team?teamKey=${encodeURIComponent(teamKey!)}&leagueKey=${encodeURIComponent(leagueKey!)}&scoringType=${encodeURIComponent(scoringType ?? '')}&week=${week}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<PointsTeamResponse>(url, fetcher, {
    revalidateOnFocus: false,
  });

  return { data, isLoading, isError: !!error, mutate };
}
