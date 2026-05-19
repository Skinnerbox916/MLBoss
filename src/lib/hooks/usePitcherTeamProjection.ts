import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { ProjectedCategory } from './useBatterTeamProjection';
import type { WeekTarget } from '@/lib/dashboard/weekRange';

/** Per-start projection summary for the pitcher team-projection response. */
export interface ProjectedPerStart {
  date: string;
  dayLabel: string;
  hasStart: boolean;
  doubleHeader: boolean;
  opponent?: string;
  isHome?: boolean;
  parkFactor?: number;
  weatherFlag?: string;
  expectedIP: number;
  score: number | null;
  tier: 'ace' | 'tough' | 'average' | 'weak' | 'bad' | null;
}

export interface ProjectedPitcher {
  name: string;
  teamAbbr: string;
  /** Sum of per-start rating scores. Privileges two-start pitchers. */
  weeklyScore: number;
  weeklyIP: number;
  expectedStarts: number;
  byCategory: Record<number, ProjectedCategory>;
  perStart: ProjectedPerStart[];
}

export interface PitcherTeamProjectionResponse {
  teamKey: string;
  weekStart?: string;
  weekEnd?: string;
  daysElapsed: number;
  byCategory: Record<number, ProjectedCategory>;
  perPlayer: ProjectedPitcher[];
  contributorCount: number;
}

/**
 * Forward pitcher-cat projection for a team across the rest of the matchup
 * week. Mirrors `useBatterTeamProjection` for the pitcher side. The same
 * hook serves my team and the opponent (different `teamKey`). Pass
 * `targetWeek: 'next'` to target next week — see `useBatterTeamProjection`.
 */
export function usePitcherTeamProjection(
  teamKey: string | undefined,
  leagueKey: string | undefined,
  opts: { targetWeek?: WeekTarget } = {},
) {
  const { targetWeek = 'current' } = opts;
  const url = teamKey && leagueKey
    ? `/api/projection/pitcher-team?teamKey=${teamKey}&leagueKey=${leagueKey}${targetWeek === 'next' ? '&targetWeek=next' : ''}`
    : null;
  const { data, error, isLoading } = useSWR<PitcherTeamProjectionResponse>(url, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 5 * 60 * 1000,
  });
  return {
    projection: data,
    isLoading,
    isError: !!error,
  };
}
