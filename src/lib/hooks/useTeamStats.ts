import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { TeamStats } from '@/lib/yahoo-fantasy-api';

/**
 * Get team stats — season-to-date (omit week) or for a specific week.
 */
export function useTeamStats(teamKey: string | undefined, week?: number | string) {
  const weekParam = week !== undefined ? `&week=${week}` : '';
  const { data, error, isLoading } = useSWR<TeamStats>(
    teamKey ? `/api/fantasy/team-stats?teamKey=${teamKey}${weekParam}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    teamStats: data ?? null,
    stats: data?.stats ?? [],
    isLoading,
    isError: !!error,
  };
}
