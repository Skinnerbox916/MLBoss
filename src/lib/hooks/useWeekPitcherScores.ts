'use client';

import { useMemo } from 'react';
import { useGameDay, type EnrichedGame } from './useGameDay';
import {
  getStreamingGridDays,
  getPickupPlayableDays,
  type WeekDay,
} from '@/lib/dashboard/weekRange';
import {
  projectPitcherPlayer,
  type ActivePitcher,
  type PitcherProjectionDeps,
  type PitcherPlayerProjection,
} from '@/lib/projection/pitcherTeam';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';

export interface WeekPitcherScore {
  player: FreeAgentPlayer;
  projection: PitcherPlayerProjection;
}

interface UseWeekPitcherScoresResult {
  scored: WeekPitcherScore[];
  /** Pickup-playable window — tomorrow→Sunday on Mon-Sat, full next
   *  Mon-Sun on Sunday. */
  days: WeekDay[];
  isLoading: boolean;
}

/**
 * Score every FA pitcher in the pool across the days where a pickup made
 * now CAN actually play (matches the batter side's `useWeekBatterScores`).
 *
 * Per-FA value is the sum of per-start rating scores within the window —
 * a 2-start streamer with avg 60 (= 120) outranks a 1-start ace with
 * score 80, by design. The window is variable: Sun/Mon picks see up to
 * ~7 days, mid-week picks see fewer; the engine just iterates whatever
 * is in the window. Two-start coverage falls out naturally on Sunday and
 * Monday picks; by Wed the window is too short for any pitcher to start
 * twice (rotation gap > remaining window).
 *
 * Stable hook order: always seven `useGameDay` calls regardless of how
 * many days are playable, so React doesn't choke on conditional hooks.
 * The projection iterates `playableDays`; days outside the pickup window
 * are fetched-but-unused (their cache lines warm up for the
 * StreamingBoard date strip too).
 */
export function useWeekPitcherScores(
  faPool: FreeAgentPlayer[],
  scoredCategories: EnrichedLeagueStatCategory[],
  focusMap: Record<number, Focus>,
  teamOffense?: Record<number, TeamOffense>,
): UseWeekPitcherScoresResult {
  const gridDays = useMemo(() => getStreamingGridDays(), []);
  const playableDays = useMemo(() => getPickupPlayableDays(), []);

  const day0 = useGameDay(gridDays[0]?.date);
  const day1 = useGameDay(gridDays[1]?.date);
  const day2 = useGameDay(gridDays[2]?.date);
  const day3 = useGameDay(gridDays[3]?.date);
  const day4 = useGameDay(gridDays[4]?.date);
  const day5 = useGameDay(gridDays[5]?.date);
  const day6 = useGameDay(gridDays[6]?.date);
  const dayResults = [day0, day1, day2, day3, day4, day5, day6];

  const gamesByDate = useMemo(() => {
    const m = new Map<string, EnrichedGame[]>();
    gridDays.forEach((day, i) => {
      m.set(day.date, dayResults[i].games as EnrichedGame[]);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridDays, day0.games, day1.games, day2.games, day3.games, day4.games, day5.games, day6.games]);

  // Pivot teamOffense Record into a Map for the engine.
  const teamOffenseMap = useMemo(() => {
    if (!teamOffense) return undefined;
    const m = new Map<number, TeamOffense>();
    for (const [k, v] of Object.entries(teamOffense)) {
      m.set(Number(k), v);
    }
    return m;
  }, [teamOffense]);

  const scored = useMemo<WeekPitcherScore[]>(() => {
    if (faPool.length === 0 || scoredCategories.length === 0) return [];
    if (playableDays.length === 0) return [];

    const deps: PitcherProjectionDeps = {
      days: playableDays,
      gamesByDate,
      scoredCategories,
      teamOffense: teamOffenseMap,
      focusMap,
    };

    const out: WeekPitcherScore[] = [];
    for (const fa of faPool) {
      const active: ActivePitcher = {
        // Name-based matching — placeholder mlbId is fine.
        mlbId: 0,
        name: fa.name,
        teamAbbr: fa.editorial_team_abbr,
      };
      const projection = projectPitcherPlayer(active, deps);
      // Drop FAs that have zero projected starts in the pickup window —
      // they won't surface meaningfully on the board, and including them
      // pads the candidate count.
      if (projection.expectedStarts === 0) continue;
      out.push({ player: fa, projection });
    }
    return out;
  }, [faPool, scoredCategories, playableDays, gamesByDate, teamOffenseMap, focusMap]);

  const isLoading = dayResults.some(d => d.isLoading);

  return { scored, days: playableDays, isLoading };
}
