'use client';

import { useMemo } from 'react';
import { useRoster } from './useRoster';
import { useRosterPositions } from './useRosterPositions';
import {
  buildPointsRosterStrategy,
  type PointsRosterStrategy,
} from '@/lib/points/rosterStrategy';
import type { PreferredDepthMap } from '@/lib/roster/preferredDepth';
import type { PointsPlayerRow } from '@/lib/points/analyzeTeam';

/**
 * Client-side points roster strategy — position-aware batter moves, depth
 * chart, and open slots, solved over the server's projection facts
 * (`usePointsTeam` rows) plus the user's depth targets. The single source
 * of batter moves for both the points roster page and the points
 * dashboard; a stepper change re-solves in a memo with no refetch.
 */
export function usePointsRosterStrategy(
  leagueKey: string | undefined,
  teamKey: string | undefined,
  batterRows: PointsPlayerRow[] | undefined,
  preferredDepth?: PreferredDepthMap,
): PointsRosterStrategy & { isLoading: boolean } {
  const { roster, isLoading: rosterLoading } = useRoster(teamKey);
  const { positions: leaguePositions, isLoading: posLoading } = useRosterPositions(leagueKey);

  const strategy = useMemo(() => {
    if (!batterRows || batterRows.length === 0 || roster.length === 0 || leaguePositions.length === 0) {
      return { moves: [], depth: [], openSlots: 0 };
    }
    return buildPointsRosterStrategy({
      batterRows,
      roster,
      leaguePositions,
      preferredDepth,
    });
  }, [batterRows, roster, leaguePositions, preferredDepth]);

  return { ...strategy, isLoading: rosterLoading || posLoading };
}
