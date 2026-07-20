import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { PointsTeamResponse } from './usePointsTeam';

/**
 * The OPPONENT's projected remaining points this week — the same points
 * team analysis, roster-only (`includeFA=0`, a fraction of the full
 * pipeline). Feeds the points matchup marquee's projected-final math.
 * Pass the opponent teamKey from the scoreboard; null until known.
 */
export function usePointsOpponentWeek(
  leagueKey: string | undefined,
  opponentTeamKey: string | undefined,
  scoringType: string | undefined,
) {
  const canFetch = Boolean(leagueKey && opponentTeamKey);
  const url = canFetch
    ? `/api/points/team?teamKey=${encodeURIComponent(opponentTeamKey!)}&leagueKey=${encodeURIComponent(leagueKey!)}&scoringType=${encodeURIComponent(scoringType ?? '')}&week=current&includeFA=0`
    : null;

  const { data, error, isLoading } = useSWR<PointsTeamResponse>(url, fetcher, {
    revalidateOnFocus: false,
  });

  return {
    projectedRemaining: data?.weekProjectedPoints,
    isLoading,
    isError: !!error,
  };
}
