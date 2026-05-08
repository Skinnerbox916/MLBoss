'use client';

import { useMemo } from 'react';
import { useGameDay, type EnrichedGame } from './useGameDay';
import { useFreeAgentStats } from './useFreeAgentStats';
import { useLineupSpots } from './useLineupSpots';
import {
  getStreamingGridDays,
  getPickupPlayableDays,
  type WeekDay,
} from '@/lib/dashboard/weekRange';
import {
  projectBatterPlayer,
  type ActiveBatter,
  type ProjectionDeps,
  type PlayerProjection,
} from '@/lib/projection/batterTeam';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';

export interface WeekBatterScore {
  player: FreeAgentPlayer;
  projection: PlayerProjection;
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
 * Time window: the projection iterates `getPickupPlayableDays()`, which is
 * tomorrow through Sunday on Mon-Sat and the full next Mon-Sun on Sunday.
 * A streamer added today doesn't enter a roster until the next calendar
 * day, so today is always excluded from the value calculation. The grid
 * for game-day fetches is `getStreamingGridDays()` — same shape (7 days)
 * but rolled forward to next week on Sunday.
 *
 * Performance: ~100 FAs × ~5 remaining days × pure-CPU rating call —
 * runs in well under a second in a typical browser.
 */
export function useWeekBatterScores(
  faPool: FreeAgentPlayer[],
  scoredCategories: EnrichedLeagueStatCategory[],
  focusMap: Record<number, Focus>,
): UseWeekBatterScoresResult {
  const gridDays = useMemo(() => getStreamingGridDays(), []);
  const playableDays = useMemo(() => getPickupPlayableDays(), []);

  // Stable hook order: always seven `useGameDay` calls regardless of how
  // many days are playable. Filtering happens in the projection deps.
  const day0 = useGameDay(gridDays[0]?.date);
  const day1 = useGameDay(gridDays[1]?.date);
  const day2 = useGameDay(gridDays[2]?.date);
  const day3 = useGameDay(gridDays[3]?.date);
  const day4 = useGameDay(gridDays[4]?.date);
  const day5 = useGameDay(gridDays[5]?.date);
  const day6 = useGameDay(gridDays[6]?.date);
  const dayResults = [day0, day1, day2, day3, day4, day5, day6];

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

  // Build per-day game lookup from the seven SWR results, keyed by date.
  // The projection engine only iterates `playableDays`, so days outside
  // the pickup window are fetched-but-unused.
  const gamesByDate = useMemo(() => {
    const m = new Map<string, EnrichedGame[]>();
    gridDays.forEach((day, i) => {
      m.set(day.date, dayResults[i].games as EnrichedGame[]);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridDays, day0.games, day1.games, day2.games, day3.games, day4.games, day5.games, day6.games]);

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
      focusMap,
    };

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
      out.push({ player: fa, projection });
    }
    return out;
  }, [faPool, scoredCategories, playableDays, statsByMlbId, gamesByDate, lineupSpots, focusMap, getPlayerStats]);

  const isLoading =
    statsLoading ||
    spotsLoading ||
    dayResults.some(d => d.isLoading);

  // Return the playable days (not the full grid) so the UI strip and
  // slot-aware engine see only the actionable window.
  return { scored, days: playableDays, isLoading };
}
