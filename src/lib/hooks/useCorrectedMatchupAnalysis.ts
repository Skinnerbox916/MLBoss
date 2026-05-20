'use client';

import { useMemo } from 'react';
import { useScoreboard } from './useScoreboard';
import { useLeagueCategories } from './useLeagueCategories';
import { useBatterTeamProjection, type BatterTeamProjectionResponse } from './useBatterTeamProjection';
import { usePitcherTeamProjection, type PitcherTeamProjectionResponse } from './usePitcherTeamProjection';
import { buildMatchupRows } from '@/components/shared/matchupRows';
import { analyzeMatchup, withSwing, type MatchupAnalysis } from '@/lib/matchup/analysis';
import { composeCorrectedRows } from '@/lib/matchup/correctedRows';
import { getMatchupWeekDays, type WeekTarget } from '@/lib/dashboard/weekRange';
import type { ProjectedCategory } from './useBatterTeamProjection';
import type { MatchupData } from '@/lib/yahoo-fantasy-api';

/**
 * Matchup analysis hook used by every page that asks "which categories
 * will be contested by Sunday given my actual roster?" — Lineup,
 * Streaming, BossCard, etc.
 *
 * Two modes (selected via `opts.targetWeek`):
 *
 *  - `'current'` (default) — Mid-week analysis. Reads Yahoo's
 *    matchup-to-date (MTD) scoreboard, adds the rest-of-week projection,
 *    and produces a corrected-margin analysis. Each row carries `margin`
 *    (end-of-week projected) and `rawMargin` (MTD only) plus `swing`
 *    (`margin - rawMargin`), so the UI can render "currently X → projected
 *    Y" arrows.
 *  - `'next'` — Sunday streaming pivot. The matchup hasn't started yet,
 *    so there is no MTD to blend with. The hook drives the projection
 *    routes against next Mon-Sun, resolves the opponent off next week's
 *    scoreboard, and feeds `composeCorrectedRows` in `'projection-only'`
 *    mode — every margin comes directly from the projection. No
 *    `withSwing` is run (nothing to swing from), so rows carry `margin`
 *    only — UI renders the projected value with no before/after arrow.
 *
 * Batter cats project via `useBatterTeamProjection`; counting pitcher
 * cats (K, W, QS, IP) via `usePitcherTeamProjection`. Pitcher ratio cats
 * (ERA, WHIP) get the IP-weighted blend in `'current'` mode and pure
 * projection in `'next'` mode. K/9 / BB/9 / H/9 aren't projected and
 * pass through unchanged (or fall to em-dash in pivot mode and are
 * filtered out by consuming panels).
 *
 * SWR fetches: current-week scoreboard (always, used to resolve the
 * current week number; doubles as MTD source in `'current'` mode), next-
 * week scoreboard (only in `'next'` mode, only for opponent identity),
 * categories (semi-dynamic), and four team projections (my+opp ×
 * batter+pitcher, 5-min refresh each). SWR de-dupes shared fetches with
 * other consumers.
 */
export interface CorrectedMatchupAnalysis {
  analysis: MatchupAnalysis;
  /** True once at least one projection (batter or pitcher) has resolved
   *  and contributed cats to the corrected rows. False during the
   *  MTD-only first paint. */
  isCorrected: boolean;
  isLoading: boolean;
  myProjection: BatterTeamProjectionResponse | undefined;
  oppProjection: BatterTeamProjectionResponse | undefined;
  myPitcherProjection: PitcherTeamProjectionResponse | undefined;
  oppPitcherProjection: PitcherTeamProjectionResponse | undefined;
  /** Resolved opponent team_key for the analyzed matchup (current or
   *  next, per `targetWeek`). */
  opponentTeamKey: string | undefined;
  /** Resolved opponent display name. */
  opponentName: string | undefined;
}

export interface UseCorrectedMatchupAnalysisOpts {
  /** `'current'` (default) analyzes the in-progress matchup. `'next'`
   *  analyzes the upcoming matchup against next week's opponent — used
   *  by the Sunday streaming pivot. See hook docblock. */
  targetWeek?: WeekTarget;
}

export function useCorrectedMatchupAnalysis(
  leagueKey: string | undefined,
  teamKey: string | undefined,
  opts: UseCorrectedMatchupAnalysisOpts = {},
): CorrectedMatchupAnalysis {
  const { targetWeek = 'current' } = opts;
  const isPivot = targetWeek === 'next';

  // Current-week scoreboard is always fetched: in `'current'` mode it's
  // the MTD source AND the opponent source; in `'next'` mode it's only
  // used to learn the current week number so we can ask Yahoo for next
  // week's scoreboard.
  const { matchups: currentMatchups, week: currentWeek, isLoading: scoreLoading } = useScoreboard(leagueKey);

  // Next-week scoreboard: fetched only when pivoting AND once we know
  // the current week. Used purely for opponent identity — stats on a
  // not-yet-started matchup are not load-bearing here.
  const nextWeekNumber = isPivot && typeof currentWeek === 'number' ? currentWeek + 1 : undefined;
  const { matchups: nextMatchups, isLoading: nextScoreLoading } =
    useScoreboard(isPivot ? leagueKey : undefined, nextWeekNumber);

  const matchups: MatchupData[] = isPivot ? nextMatchups : currentMatchups;

  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);

  const opponentTeamKey = useMemo(() => {
    if (!teamKey) return undefined;
    const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
    return userMatchup?.teams.find(t => t.team_key !== teamKey)?.team_key;
  }, [matchups, teamKey]);

  const opponentName = useMemo(() => {
    if (!teamKey) return undefined;
    const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
    return userMatchup?.teams.find(t => t.team_key !== teamKey)?.name;
  }, [matchups, teamKey]);

  const projOpts = { targetWeek } as const;
  const { projection: myProjection, isLoading: myProjLoading } = useBatterTeamProjection(teamKey, leagueKey, projOpts);
  const { projection: oppProjection, isLoading: oppProjLoading } = useBatterTeamProjection(opponentTeamKey, leagueKey, projOpts);
  const { projection: myPitcherProjection, isLoading: myPitchProjLoading } = usePitcherTeamProjection(teamKey, leagueKey, projOpts);
  const { projection: oppPitcherProjection, isLoading: oppPitchProjLoading } = usePitcherTeamProjection(opponentTeamKey, leagueKey, projOpts);

  const result = useMemo<CorrectedMatchupAnalysis>(() => {
    const aggregateLoading =
      scoreLoading || nextScoreLoading || catsLoading ||
      myProjLoading || oppProjLoading || myPitchProjLoading || oppPitchProjLoading;

    const empty = (): CorrectedMatchupAnalysis => ({
      analysis: analyzeMatchup([], { daysElapsed: 0 }),
      isCorrected: false,
      isLoading: aggregateLoading,
      myProjection,
      oppProjection,
      myPitcherProjection,
      oppPitcherProjection,
      opponentTeamKey,
      opponentName,
    });

    if (!teamKey) return empty();

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

    if (isPivot) {
      // Projection-only path. The matchup hasn't started, so we don't
      // need MTD data on either side. We pass empty maps to buildMatchupRows
      // (every row becomes em-dash) and let projection-only correctedRows
      // overwrite each one with the pure projected value. Rows without
      // projections (un-projectable K/9 / BB/9 / H/9) stay em-dash and
      // are filtered out by consuming panels.
      if (!hasAnyProjection) return empty();
      const baseRows = buildMatchupRows(categories, new Map<number, string>(), new Map<number, string>());
      const correctedRows = composeCorrectedRows({
        baseRows,
        myProjection: myMerged,
        oppProjection: oppMerged,
        daysElapsed: 0,
        mode: 'projection-only',
      });
      // daysElapsed = 0 → rate-stat margins get heavily soft-pedaled
      // (correct — pure-projection ERA shouldn't read as "locked").
      const analysis = analyzeMatchup(correctedRows, { daysElapsed: 0, mode: 'corrected' });
      return {
        analysis,
        isCorrected: true,
        isLoading: aggregateLoading,
        myProjection,
        oppProjection,
        myPitcherProjection,
        oppPitcherProjection,
        opponentTeamKey,
        opponentName,
      };
    }

    // Blend path (mid-week).
    const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
    const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
    const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);
    if (!userTeam?.stats || !opponent?.stats) return empty();

    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    const baseRows = buildMatchupRows(categories, myMap, oppMap);

    const days = getMatchupWeekDays();
    const finished = days.filter(d => !d.isRemaining).length;
    const daysElapsed = finished + 0.5;

    const rawAnalysis = analyzeMatchup(baseRows, { daysElapsed });
    if (!hasAnyProjection) {
      return {
        analysis: rawAnalysis,
        isCorrected: false,
        isLoading: aggregateLoading,
        myProjection,
        oppProjection,
        myPitcherProjection,
        oppPitcherProjection,
        opponentTeamKey,
        opponentName,
      };
    }
    const correctedRows = composeCorrectedRows({
      baseRows,
      myProjection: myMerged,
      oppProjection: oppMerged,
      daysElapsed: finished, // integer days for the AB-estimation fallback
      mode: 'blend',
    });
    const correctedAnalysis = analyzeMatchup(correctedRows, { daysElapsed, mode: 'corrected' });
    const analysis = withSwing(correctedAnalysis, rawAnalysis);

    return {
      analysis,
      isCorrected: true,
      isLoading: aggregateLoading,
      myProjection,
      oppProjection,
      myPitcherProjection,
      oppPitcherProjection,
      opponentTeamKey,
      opponentName,
    };
  }, [
    matchups, teamKey, categories, isPivot,
    myProjection, oppProjection, myPitcherProjection, oppPitcherProjection,
    scoreLoading, nextScoreLoading, catsLoading,
    myProjLoading, oppProjLoading, myPitchProjLoading, oppPitchProjLoading,
    opponentTeamKey, opponentName,
  ]);

  return result;
}
