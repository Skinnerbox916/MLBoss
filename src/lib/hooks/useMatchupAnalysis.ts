'use client';

import { useMemo } from 'react';
import { useScoreboard } from './useScoreboard';
import { useLeagueCategories } from './useLeagueCategories';
import { buildMatchupRows } from '@/components/shared/matchupRows';
import { analyzeMatchup, type MatchupAnalysis } from '@/lib/matchup/analysis';
import { getMatchupWeekDays } from '@/lib/dashboard/weekRange';

/**
 * Single entry point for the matchup analysis engine.
 *
 * Wraps the scoreboard + league categories + week-progress plumbing that
 * BossCard, LineupManager, StreamingManager, and TodayPitchers all need.
 * Co-locating the assembly here means there's exactly one place that
 * decides "this week's matchup state per category" and every consumer sees
 * the same answer — see `docs/recommendation-system.md` for the architecture.
 *
 * SWR dedupes the two underlying requests, so calling this hook from
 * multiple components on the same page does not produce duplicate network
 * traffic.
 */
export function useMatchupAnalysis(
  leagueKey: string | undefined,
  teamKey: string | undefined,
): { analysis: MatchupAnalysis; isLoading: boolean } {
  const { matchups, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);

  const analysis = useMemo<MatchupAnalysis>(() => {
    if (!teamKey) return analyzeMatchup([], { daysElapsed: 0 });
    const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
    const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
    const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);
    if (!userTeam?.stats || !opponent?.stats) {
      return analyzeMatchup([], { daysElapsed: 0 });
    }
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    const rows = buildMatchupRows(categories, myMap, oppMap);
    const days = getMatchupWeekDays();
    const finished = days.filter(d => !d.isRemaining).length;
    return analyzeMatchup(rows, { daysElapsed: finished + 0.5 });
  }, [matchups, teamKey, categories]);

  return { analysis, isLoading: scoreLoading || catsLoading };
}
