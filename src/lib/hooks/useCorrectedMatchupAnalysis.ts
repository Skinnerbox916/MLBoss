'use client';

import { useMemo } from 'react';
import { useScoreboard } from './useScoreboard';
import { useLeagueCategories } from './useLeagueCategories';
import { useBatterTeamProjection, type BatterTeamProjectionResponse } from './useBatterTeamProjection';
import { usePitcherTeamProjection, type PitcherTeamProjectionResponse } from './usePitcherTeamProjection';
import { buildMatchupRows } from '@/components/shared/matchupRows';
import { analyzeMatchup, withSwing, type MatchupAnalysis } from '@/lib/matchup/analysis';
import { composeCorrectedRows } from '@/lib/matchup/correctedRows';
import { getMatchupWeekDays } from '@/lib/dashboard/weekRange';
import type { ProjectedCategory } from './useBatterTeamProjection';

/**
 * Same shape as `useMatchupAnalysis` but augmented with forward
 * projections on both sides. Batter cats correct via
 * `useBatterTeamProjection`; counting pitcher cats (K, W, QS, IP)
 * correct via `usePitcherTeamProjection`. Pitcher ratio cats
 * (ERA, WHIP) pass through YTD — see `composeCorrectedRows` and the
 * design discussion for rationale.
 *
 * Five SWR fetches under the hood: scoreboard (60s refresh), categories
 * (semi-dynamic), and four team projections (my+opp × batter+pitcher,
 * 5-min refresh each). Returns YTD-only analysis on the first paint,
 * then re-renders with the corrected analysis once projections resolve.
 * The `isCorrected` flag tells consumers whether either-side projection
 * has actually contributed.
 *
 * Each row on the returned analysis carries both `margin` (corrected
 * end-of-week projection) and `rawMargin` (YTD only) plus `swing`
 * (`margin - rawMargin`). `suggestedFocus` is direction-aware on the
 * corrected margin: a category projected to lose is `chase`, projected
 * to win not-locked is `neutral` (hold), and either extreme is `punt`.
 */
export interface CorrectedMatchupAnalysis {
  analysis: MatchupAnalysis;
  /** True once at least one projection (batter or pitcher) has resolved
   *  and contributed cats to the corrected rows. False during the
   *  YTD-only first paint. */
  isCorrected: boolean;
  isLoading: boolean;
  myProjection: BatterTeamProjectionResponse | undefined;
  oppProjection: BatterTeamProjectionResponse | undefined;
  myPitcherProjection: PitcherTeamProjectionResponse | undefined;
  oppPitcherProjection: PitcherTeamProjectionResponse | undefined;
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
  const { projection: myPitcherProjection, isLoading: myPitchProjLoading } = usePitcherTeamProjection(teamKey, leagueKey);
  const { projection: oppPitcherProjection, isLoading: oppPitchProjLoading } = usePitcherTeamProjection(opponentTeamKey, leagueKey);

  const result = useMemo<CorrectedMatchupAnalysis>(() => {
    if (!teamKey) {
      return {
        analysis: analyzeMatchup([], { daysElapsed: 0 }),
        isCorrected: false,
        isLoading: scoreLoading || catsLoading,
        myProjection,
        oppProjection,
        myPitcherProjection,
        oppPitcherProjection,
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
        myPitcherProjection,
        oppPitcherProjection,
      };
    }

    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    const baseRows = buildMatchupRows(categories, myMap, oppMap);

    const days = getMatchupWeekDays();
    const finished = days.filter(d => !d.isRemaining).length;
    const daysElapsed = finished + 0.5;

    // Merge batter + pitcher projection maps so composeCorrectedRows
    // sees one stat_id → ProjectedCategory record per side.
    const myMerged: Record<number, ProjectedCategory> = {
      ...(myProjection?.byCategory ?? {}),
      ...(myPitcherProjection?.byCategory ?? {}),
    };
    const oppMerged: Record<number, ProjectedCategory> = {
      ...(oppProjection?.byCategory ?? {}),
      ...(oppPitcherProjection?.byCategory ?? {}),
    };
    const hasAnyProjection = Object.keys(myMerged).length > 0 || Object.keys(oppMerged).length > 0;

    const rawAnalysis = analyzeMatchup(baseRows, { daysElapsed });
    let isCorrected = false;
    let analysis: MatchupAnalysis = rawAnalysis;
    if (hasAnyProjection) {
      const correctedRows = composeCorrectedRows({
        baseRows,
        myProjection: myMerged,
        oppProjection: oppMerged,
        daysElapsed: finished, // integer days for the AB-estimation fallback
      });
      const correctedAnalysis = analyzeMatchup(correctedRows, { daysElapsed });
      analysis = withSwing(correctedAnalysis, rawAnalysis);
      isCorrected = true;
    }

    return {
      analysis,
      isCorrected,
      isLoading: scoreLoading || catsLoading || myProjLoading || oppProjLoading || myPitchProjLoading || oppPitchProjLoading,
      myProjection,
      oppProjection,
      myPitcherProjection,
      oppPitcherProjection,
    };
  }, [
    matchups, teamKey, categories,
    myProjection, oppProjection, myPitcherProjection, oppPitcherProjection,
    scoreLoading, catsLoading,
    myProjLoading, oppProjLoading, myPitchProjLoading, oppPitchProjLoading,
  ]);

  return result;
}
