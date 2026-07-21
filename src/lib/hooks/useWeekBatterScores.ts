'use client';

import { useMemo } from 'react';
import { useGameDay, type EnrichedGame } from './useGameDay';
import { useFreeAgentStats } from './useFreeAgentStats';
import { useLineupSpots } from './useLineupSpots';
import {
  getStreamingGridDays,
  getPickupPlayableDays,
  type WeekBounds,
  type WeekDay,
} from '@/lib/dashboard/weekRange';
import {
  projectBatterPlayer,
  type ActiveBatter,
  type ProjectionDeps,
  type PlayerProjection,
} from '@/lib/projection/batterTeam';
import {
  playingTimeFactor,
  estimateFullTimePaceRef,
  estimateFullTimeGpRef,
} from '@/lib/roster/playingTime';
import { isStashableIL } from '@/lib/roster/playerPool';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';

export interface WeekBatterScore {
  player: FreeAgentPlayer;
  projection: PlayerProjection;
  /** Playing-time share (0, 1] — P(in the lineup) on a team game day, from
   *  the canonical role-share model (`playingTimeFactor`, same as the
   *  roster page). The slot-aware engine scales each day's delta by it. */
  playShare: number;
}

interface UseWeekBatterScoresResult {
  scored: WeekBatterScore[];
  /** Mon..Sun reference for the strip / per-day cells. */
  days: WeekDay[];
  isLoading: boolean;
}

/**
 * Score every FA in the pool across the days where a pickup made now CAN
 * actually play.
 *
 * Uses the same `projectBatterPlayer` primitive as the team projection
 * engine but keeps the per-player breakdown intact for the UI. The
 * focus map is honored: chased cats double-weight in each per-day score
 * via `getBatterRating`'s existing weight vector, so toggling a chase /
 * punt re-orders the FA list without a re-fetch.
 *
 * Filtering: callers should filter the FA pool upstream (ownership floor,
 * IL exclusions, etc.). The hook scores everyone passed in.
 *
 * Time window: the projection iterates `getPickupPlayableDays(now,
 * earliestPlayableDate, weekBounds)`, floored at the league's earliest
 * playable date — today for immediate leagues (games not yet started),
 * tomorrow→week-end for next-day leagues, the full next week on the closing
 * day / weekly. The grid for game-day fetches is `getStreamingGridDays()` —
 * the whole matchup week (7 days normally, up to 14 in a combined week).
 *
 * Performance: ~100 FAs × remaining days × pure-CPU rating call —
 * runs in well under a second in a typical browser.
 */
export function useWeekBatterScores(
  faPool: FreeAgentPlayer[],
  scoredCategories: EnrichedLeagueStatCategory[],
  categoryWeights?: Record<number, number>,
  earliestPlayableDate?: string,
  weekBounds?: WeekBounds,
): UseWeekBatterScoresResult {
  const gridDays = useMemo(() => getStreamingGridDays(new Date(), earliestPlayableDate, weekBounds), [earliestPlayableDate, weekBounds]);
  const playableDays = useMemo(() => getPickupPlayableDays(new Date(), earliestPlayableDate, weekBounds), [earliestPlayableDate, weekBounds]);

  // Stable hook order: always fourteen `useGameDay` calls regardless of how
  // many days the grid holds (7 for a normal week, up to 14 for a combined
  // week). Slots past the grid get `undefined` and skip their fetch.
  const day0 = useGameDay(gridDays[0]?.date);
  const day1 = useGameDay(gridDays[1]?.date);
  const day2 = useGameDay(gridDays[2]?.date);
  const day3 = useGameDay(gridDays[3]?.date);
  const day4 = useGameDay(gridDays[4]?.date);
  const day5 = useGameDay(gridDays[5]?.date);
  const day6 = useGameDay(gridDays[6]?.date);
  const day7 = useGameDay(gridDays[7]?.date);
  const day8 = useGameDay(gridDays[8]?.date);
  const day9 = useGameDay(gridDays[9]?.date);
  const day10 = useGameDay(gridDays[10]?.date);
  const day11 = useGameDay(gridDays[11]?.date);
  const day12 = useGameDay(gridDays[12]?.date);
  const day13 = useGameDay(gridDays[13]?.date);
  const dayResults = [day0, day1, day2, day3, day4, day5, day6, day7, day8, day9, day10, day11, day12, day13];

  // Stats for every FA + lineup-spot priors keyed by mlbId.
  const { statsMap, getPlayerStats, isLoading: statsLoading } = useFreeAgentStats(faPool);

  // Build the mlbId list for the lineup-spot lookup. Stable order via
  // the FA pool order; `useLineupSpots` re-sorts internally for cache key.
  const mlbIds = useMemo(() => {
    const ids: number[] = [];
    for (const p of faPool) {
      const stats = getPlayerStats(p.name, p.editorial_team_abbr);
      if (stats?.mlbId) ids.push(stats.mlbId);
    }
    return ids;
  }, [faPool, getPlayerStats]);
  const { spots: lineupSpots, isLoading: spotsLoading } = useLineupSpots(mlbIds);

  // Build per-day game lookup from the per-day SWR results, keyed by date.
  // The projection engine only iterates `playableDays`, so days outside
  // the pickup window are fetched-but-unused.
  const gamesByDate = useMemo(() => {
    const m = new Map<string, EnrichedGame[]>();
    gridDays.forEach((day, i) => {
      m.set(day.date, (dayResults[i]?.games ?? []) as EnrichedGame[]);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridDays, ...dayResults.map(d => d.games)]);

  // Stats lookup keyed by mlbId for the engine. The FA stats map is keyed
  // by `name|team` lowercase, so we re-key here.
  const statsByMlbId = useMemo(() => {
    const m = new Map<number, BatterSeasonStats>();
    for (const s of Object.values(statsMap)) {
      if (s.mlbId > 0) m.set(s.mlbId, s);
    }
    return m;
  }, [statsMap]);

  const scored = useMemo<WeekBatterScore[]>(() => {
    if (faPool.length === 0 || scoredCategories.length === 0) return [];
    if (playableDays.length === 0) return [];

    const deps: ProjectionDeps = {
      days: playableDays,
      statsByMlbId,
      gamesByDate,
      scoredCategories,
      lineupSpots,
      categoryWeights,
    };

    // Full-time pace refs estimated over the FA pool's own stats. Slightly
    // low vs a league-wide pool (rostered regulars would raise the p90), so
    // shares skew a touch generous — fine for ranking; the 2× part-timer
    // over-credit is what matters (see slotAware.ts docblock).
    const poolStats = Object.values(statsMap);
    const fullTimePaceRef = estimateFullTimePaceRef(poolStats);
    const fullTimeGpRef = estimateFullTimeGpRef(poolStats);

    const out: WeekBatterScore[] = [];
    for (const fa of faPool) {
      const stats = getPlayerStats(fa.name, fa.editorial_team_abbr);
      if (!stats?.mlbId) continue;
      const active: ActiveBatter = {
        mlbId: stats.mlbId,
        name: fa.name,
        teamAbbr: fa.editorial_team_abbr,
      };
      const projection = projectBatterPlayer(active, deps);
      const playShare = playingTimeFactor(stats, {
        fullTimePaceRef,
        fullTimeGpRef,
        isOnIL: isStashableIL(fa),
        percentOwned: fa.percent_owned,
      });
      out.push({ player: fa, projection, playShare });
    }
    return out;
  }, [faPool, scoredCategories, playableDays, statsByMlbId, statsMap, gamesByDate, lineupSpots, categoryWeights, getPlayerStats]);

  const isLoading =
    statsLoading ||
    spotsLoading ||
    dayResults.some(d => d.isLoading);

  // Return the playable days (not the full grid) so the UI strip and
  // slot-aware engine see only the actionable window.
  return { scored, days: playableDays, isLoading };
}
