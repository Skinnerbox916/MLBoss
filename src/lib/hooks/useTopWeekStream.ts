'use client';

import { useCallback, useMemo } from 'react';
import { useActiveLeague } from './useActiveLeague';
import { useLeagueCategories } from './useLeagueCategories';
import { useCorrectedMatchupAnalysis } from './useCorrectedMatchupAnalysis';
import { useCategoryWeights } from './useCategoryWeights';
import { useAvailableBatters } from './useAvailableBatters';
import { useRoster } from './useRoster';
import { useRosterPositions } from './useRosterPositions';
import { useWeekBatterScores } from './useWeekBatterScores';
import { useSlotAwareStreaming } from './useSlotAwareStreaming';
import { getStreamingWeekTarget, type WeekTarget } from '@/lib/dashboard/weekRange';
import { faShouldShow } from '@/lib/roster/playerPool';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { SlotAwarePerDay } from '@/lib/projection/slotAware';

export interface TopWeekStream {
  player: FreeAgentPlayer;
  /** Slot-aware week value: sum of daily starter-score deltas. */
  streamingValue: number;
  perDay: SlotAwarePerDay[];
}

/**
 * The categories streaming board's #1 batter pickup — the dashboard
 * top-move tile's data source. Composes the SAME hooks with the SAME
 * inputs as `StreamingManager`'s batter tab (FA filter, concede weights,
 * pickup window), so every fetch is SWR-deduped/cache-shared with the
 * streaming page and the two surfaces can't rank differently.
 */
export function useTopWeekStream(): { top: TopWeekStream | null; isLoading: boolean } {
  const { leagueKey, teamKey, earliestPlayableDate, weekBounds } = useActiveLeague();

  const targetWeek: WeekTarget = useMemo(
    () => getStreamingWeekTarget(new Date(), earliestPlayableDate, weekBounds),
    [earliestPlayableDate, weekBounds],
  );

  const { categories } = useLeagueCategories(leagueKey);
  const { analysis, myProjection } = useCorrectedMatchupAnalysis(leagueKey, teamKey, { targetWeek });

  const scoredBatterCategories = useMemo(
    () => categories.filter(c => c.is_batter_stat),
    [categories],
  );
  const batterStatIds = useMemo(
    () => new Set(scoredBatterCategories.map(c => c.stat_id)),
    [scoredBatterCategories],
  );
  const batterPredicate = useCallback((statId: number) => batterStatIds.has(statId), [batterStatIds]);
  const { categoryWeights } = useCategoryWeights(analysis, batterPredicate);

  const { batters, isLoading: faLoading } = useAvailableBatters(leagueKey, true);
  const { roster, isLoading: rosterLoading } = useRoster(teamKey);
  const { positions, isLoading: positionsLoading } = useRosterPositions(leagueKey);

  const filteredFAs = useMemo(() => batters.filter(faShouldShow), [batters]);

  const { scored, days, isLoading: scoresLoading } = useWeekBatterScores(
    filteredFAs,
    scoredBatterCategories,
    categoryWeights,
    earliestPlayableDate,
    weekBounds,
  );

  const slotAware = useSlotAwareStreaming(scored, myProjection, roster, positions, days);

  const top = useMemo<TopWeekStream | null>(() => {
    let best: TopWeekStream | null = null;
    for (const s of scored) {
      const sa = slotAware.byPlayerKey.get(s.player.player_key);
      if (!sa || sa.streamingValue <= 0) continue;
      if (!best || sa.streamingValue > best.streamingValue) {
        best = { player: s.player, streamingValue: sa.streamingValue, perDay: sa.perDay };
      }
    }
    return best;
  }, [scored, slotAware]);

  // Roster/positions loading counts: without them the slot-aware baseline
  // is empty and any computed board would be the full-score-sum degenerate.
  return { top, isLoading: faLoading || scoresLoading || rosterLoading || positionsLoading };
}
