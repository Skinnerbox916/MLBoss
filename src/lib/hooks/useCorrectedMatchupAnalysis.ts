'use client';

import { useMemo } from 'react';
import { useScoreboard } from './useScoreboard';
import { useLeagueCategories } from './useLeagueCategories';
import { useBatterTeamProjection, type BatterTeamProjectionResponse } from './useBatterTeamProjection';
import { buildMatchupRows } from '@/components/shared/matchupRows';
import { analyzeMatchup, type MatchupAnalysis } from '@/lib/matchup/analysis';
import { composeCorrectedRows } from '@/lib/matchup/correctedRows';
import { getMatchupWeekDays } from '@/lib/dashboard/weekRange';

/**
 * Same shape as `useMatchupAnalysis` but augmented with forward batter-cat
 * projection on both sides. Pitcher-cat margins remain on YTD only —
 * pitcher-team projection is a separate engine (see plan doc).
 *
 * Three SWR fetches under the hood: scoreboard (60s refresh), categories
 * (semi-dynamic), and two batter-team projections (5-min refresh each).
 * Returns YTD-only analysis on the first paint, then re-renders with the
 * corrected analysis once projections resolve. The `isCorrected` flag tells
 * consumers whether the projection has actually contributed.
 */
export interface CorrectedMatchupAnalysis {
  analysis: MatchupAnalysis;
  /** True once both my-team and opponent-team projections have resolved
   *  and contributed at least one cat to the corrected rows. False during
   *  the YTD-only first paint. */
  isCorrected: boolean;
  isLoading: boolean;
  myProjection: BatterTeamProjectionResponse | undefined;
  oppProjection: BatterTeamProjectionResponse | undefined;
}

export function useCorrectedMatchupAnalysis(
  leagueKey: string | undefined,
  teamKey: string | undefined,
): CorrectedMatchupAnalysis {
  const { matchups, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);

  const opponentTeamKey = useMemo(() => {
    if (!teamKey) return undefined;
    const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
    return userMatchup?.teams.find(t => t.team_key !== teamKey)?.team_key;
  }, [matchups, teamKey]);

  const { projection: myProjection, isLoading: myProjLoading } = useBatterTeamProjection(teamKey, leagueKey);
  const { projection: oppProjection, isLoading: oppProjLoading } = useBatterTeamProjection(opponentTeamKey, leagueKey);

  const result = useMemo<CorrectedMatchupAnalysis>(() => {
    if (!teamKey) {
      return {
        analysis: analyzeMatchup([], { daysElapsed: 0 }),
        isCorrected: false,
        isLoading: scoreLoading || catsLoading,
        myProjection,
        oppProjection,
      };
    }

    const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
    const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
    const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);
    if (!userTeam?.stats || !opponent?.stats) {
      return {
        analysis: analyzeMatchup([], { daysElapsed: 0 }),
        isCorrected: false,
        isLoading: scoreLoading || catsLoading,
        myProjection,
        oppProjection,
      };
    }

    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    const baseRows = buildMatchupRows(categories, myMap, oppMap);

    const days = getMatchupWeekDays();
    const finished = days.filter(d => !d.isRemaining).length;
    const daysElapsed = finished + 0.5;

    // Compose corrected rows when both projections have resolved. Until
    // then, use the base YTD rows so the page stays useful during the
    // ~1-2s projection fetch latency.
    let rows = baseRows;
    let isCorrected = false;
    if (
      myProjection?.byCategory &&
      oppProjection?.byCategory &&
      (Object.keys(myProjection.byCategory).length > 0 ||
        Object.keys(oppProjection.byCategory).length > 0)
    ) {
      rows = composeCorrectedRows({
        baseRows,
        myProjection: myProjection.byCategory,
        oppProjection: oppProjection.byCategory,
        daysElapsed: finished, // integer days for the AB-estimation fallback
      });
      isCorrected = true;
    }

    return {
      analysis: analyzeMatchup(rows, { daysElapsed }),
      isCorrected,
      isLoading: scoreLoading || catsLoading || myProjLoading || oppProjLoading,
      myProjection,
      oppProjection,
    };
  }, [matchups, teamKey, categories, myProjection, oppProjection, scoreLoading, catsLoading, myProjLoading, oppProjLoading]);

  return result;
}
