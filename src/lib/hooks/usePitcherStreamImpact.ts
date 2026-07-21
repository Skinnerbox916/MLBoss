'use client';

import { useMemo } from 'react';
import {
  computeStreamPitcherCatImpact,
  type StreamPitcherCatImpact,
} from '@/lib/projection/streamPitcherCatImpact';
import type { WeekPitcherScore } from './useWeekPitcherScores';
import type { PitcherTeamProjectionResponse } from './usePitcherTeamProjection';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

/**
 * Price every FA pitcher's streaming add in category units — the pitcher
 * twin of the impact half of `useSlotAwareStreaming`. Each arm's projected
 * window totals (`WeekPitcherScore.projection.byCategory`) are scored
 * against the team's projected week (ratio baseline) and the pivotality
 * weights, producing the net K/W/QS/IP deltas + ERA/WHIP shift + a ranking
 * scalar the board sorts on. Pure client memo over already-fetched data
 * (same facts/preferences pattern as the batter board).
 */
export function usePitcherStreamImpact(
  weekScores: WeekPitcherScore[],
  myPitcherProjection: PitcherTeamProjectionResponse | undefined,
  scoredCategories: EnrichedLeagueStatCategory[],
  categoryWeights: Record<number, number>,
): Map<string, StreamPitcherCatImpact> {
  return useMemo(() => {
    const out = new Map<string, StreamPitcherCatImpact>();
    const teamByCategory = myPitcherProjection?.byCategory ?? {};
    const cats = scoredCategories
      .filter(c => c.is_pitcher_stat)
      .map(c => ({ statId: c.stat_id, betterIs: c.betterIs }));
    if (cats.length === 0) return out;

    for (const s of weekScores) {
      out.set(
        s.player.player_key,
        computeStreamPitcherCatImpact({
          faByCategory: s.projection.byCategory,
          teamByCategory,
          weights: categoryWeights,
          cats,
        }),
      );
    }
    return out;
  }, [weekScores, myPitcherProjection, scoredCategories, categoryWeights]);
}
