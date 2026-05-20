'use client';

import { useMemo } from 'react';
import { useScoreboard } from './useScoreboard';

/**
 * Header inputs for the matchup-aware panels (`GamePlanPanel`, etc.) on
 * the Lineup and Today pages — opponent name for the current matchup.
 *
 * SWR de-dupes the underlying scoreboard fetch with the call inside
 * `useCorrectedMatchupAnalysis`, so calling this hook alongside it is free.
 *
 * Streaming uses `useCorrectedMatchupAnalysis`'s own `opponentName`
 * because that hook resolves the current-or-next-week opponent
 * depending on `targetWeek`.
 */
export function useMatchupHeader(
  leagueKey: string | undefined,
  teamKey: string | undefined,
): {
  opponentName: string | undefined;
} {
  const { matchups } = useScoreboard(leagueKey);

  const opponentName = useMemo(() => {
    if (!teamKey) return undefined;
    const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
    return userMatchup?.teams.find(t => t.team_key !== teamKey)?.name;
  }, [matchups, teamKey]);

  return { opponentName };
}
