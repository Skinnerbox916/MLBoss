import useSWR from 'swr';
import { fetcher } from './fetcher';

/** Per-cat counting + denominator sum across the team's projected week.
 *  For batter AVG the denominator is AB; for pitcher rate cats it would
 *  be IP. Counting cats ignore `expectedDenom`. */
export interface ProjectedCategory {
  expectedCount: number;
  expectedDenom: number;
}

export interface ProjectedPerDay {
  date: string;
  dayLabel: string;
  hasGame: boolean;
  doubleHeader: boolean;
  opponent?: string;
  spotUsed: number | null;
  spotSource: 'posted' | 'cached' | 'none';
  parkFactor?: number;
  spName?: string;
  spThrows?: 'L' | 'R' | 'S';
  weatherFlag?: string;
  expectedPA: number;
  score: number | null;
  tier: 'great' | 'good' | 'neutral' | 'poor' | 'bad' | null;
}

export interface ProjectedPlayer {
  mlbId: number;
  name: string;
  teamAbbr: string;
  weeklyScore: number;
  weeklyPA: number;
  expectedGames: number;
  byCategory: Record<number, ProjectedCategory>;
  perDay: ProjectedPerDay[];
}

export interface BatterTeamProjectionResponse {
  teamKey: string;
  weekStart?: string;
  weekEnd?: string;
  daysElapsed: number;
  byCategory: Record<number, ProjectedCategory>;
  perPlayer: ProjectedPlayer[];
  contributorCount: number;
}

/**
 * Forward batter-cat projection for a team across the rest of the matchup
 * week. Used by the streaming page's strategy summary, the corrected
 * matchup margin, and the FA scoring path. The same hook serves both my
 * team and the opponent (different `teamKey`).
 *
 * SWR caches the result keyed by team + league. The route itself does no
 * additional caching beyond the underlying roster / game-day / stats
 * caches; recomputation per request is cheap (~50 batters × 7 days, all
 * pure CPU after the inputs are warm).
 */
export function useBatterTeamProjection(
  teamKey: string | undefined,
  leagueKey: string | undefined,
) {
  const url = teamKey && leagueKey
    ? `/api/projection/batter-team?teamKey=${teamKey}&leagueKey=${leagueKey}`
    : null;
  const { data, error, isLoading } = useSWR<BatterTeamProjectionResponse>(url, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 5 * 60 * 1000,
  });
  return {
    projection: data,
    isLoading,
    isError: !!error,
  };
}
