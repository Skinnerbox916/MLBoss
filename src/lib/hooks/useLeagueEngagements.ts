import { useMemo } from 'react';
import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { TeamEngagement } from '@/lib/league/engagement';

interface EngagementsResponse {
  engagements: TeamEngagement[];
}

/**
 * Per-team manager-engagement ratios for a league (1.0 = most-engaged
 * manager; below 1.0 = proportionally fewer YTD PAs accrued). Used to
 * discount an absentee opponent's counting-cat projection in the matchup
 * analysis. Returns a `Map<teamKey, engagementRatio>` for direct lookup.
 *
 * YTD pace moves slowly, so this is league-cached server-side; the hook
 * just reads the cached result.
 */
export function useLeagueEngagements(leagueKey: string | undefined) {
  const { data, error, isLoading } = useSWR<EngagementsResponse>(
    leagueKey ? `/api/league/${leagueKey}/engagements` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const ratioByTeamKey = useMemo(
    () => new Map<string, number>(
      (data?.engagements ?? []).map(e => [e.teamKey, e.engagementRatio]),
    ),
    [data],
  );

  return {
    engagements: data?.engagements ?? [],
    ratioByTeamKey,
    isLoading,
    isError: !!error,
  };
}
