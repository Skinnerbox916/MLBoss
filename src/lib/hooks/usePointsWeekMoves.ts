'use client';

import { useMemo } from 'react';
import { useActiveLeague } from './useActiveLeague';
import { usePointsStreaming, type PointsStreamingResponse } from './usePointsStreaming';
import { usePointsTeam } from './usePointsTeam';
import { useRoster } from './useRoster';
import { useRosterPositions } from './useRosterPositions';
import { useMovesBudget } from './useMovesBudget';
import {
  buildPointsWeekMoves,
  type PlannedMove,
  type WeekMovesBoard,
} from '@/lib/points/weekMoves';
import type { MovesBudget } from '@/lib/fantasy/limits';
import type { LineupCadence } from '@/lib/fantasy/scoringMode';
import type { PointsStreamingDay } from '@/lib/points/streaming';

/**
 * Client-side points week-moves board — the unified add/drop move list for
 * the points /streaming page and the dashboard's top-move tile, solved over
 * the streaming day-value facts + points-team VOR facts. The session plan
 * is an input: staging a move re-solves every remaining candidate in a
 * memo, no refetch (same facts/preferences pattern as
 * `usePointsRosterStrategy`). Keep the `plan` array identity stable between
 * changes — it's a memo dependency.
 */
export function usePointsWeekMoves(plan: PlannedMove[] = []): {
  board: WeekMovesBoard;
  cadence: LineupCadence;
  days: PointsStreamingDay[];
  movesBudget: MovesBudget | undefined;
  streaming: PointsStreamingResponse | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { leagueKey, teamKey, scoringType, lineupCadence } = useActiveLeague();
  const streaming = usePointsStreaming(leagueKey, teamKey, scoringType);
  const cadence = streaming.data?.cadence ?? lineupCadence;
  // Weekly cadence prices next week; the RP relief fallback must share
  // that window.
  const team = usePointsTeam(
    leagueKey,
    teamKey,
    scoringType,
    cadence === 'weekly' ? 'next' : 'current',
  );
  const { roster } = useRoster(teamKey);
  const { positions: leaguePositions } = useRosterPositions(leagueKey);
  const budget = useMovesBudget(leagueKey, teamKey);

  const teamRows = useMemo(
    () => (team.data ? [...team.data.batters, ...team.data.pitchers] : []),
    [team.data],
  );

  const board = useMemo<WeekMovesBoard>(() => {
    const s = streaming.data;
    if (!s || teamRows.length === 0 || roster.length === 0 || leaguePositions.length === 0) {
      return { moves: [], baselineWindowPoints: 0 };
    }
    return buildPointsWeekMoves({
      cadence: s.cadence,
      days: s.days,
      batterFacts: s.batterFacts ?? [],
      myPitcherFacts: s.myPitcherFacts ?? [],
      pitcherStreams: s.pitcherStreams ?? [],
      teamRows,
      roster,
      leaguePositions,
      plan,
    });
  }, [streaming.data, teamRows, roster, leaguePositions, plan]);

  return {
    board,
    cadence,
    days: streaming.data?.days ?? [],
    movesBudget: budget.data,
    streaming: streaming.data,
    isLoading: streaming.isLoading || team.isLoading,
    isError: streaming.isError || team.isError,
  };
}
