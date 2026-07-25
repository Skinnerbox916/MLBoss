'use client';

import { useMemo } from 'react';
import { useGameDay, type EnrichedGame } from './useGameDay';
import {
  getStreamingGridDays,
  getPickupPlayableDays,
  type WeekBounds,
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
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import { usePitcherTalent } from './usePitcherTalent';
import { isLikelySamePlayer } from '@/lib/pitching/display';

export interface WeekPitcherScore {
  player: FreeAgentPlayer;
  projection: PitcherPlayerProjection;
}

interface UseWeekPitcherScoresResult {
  scored: WeekPitcherScore[];
  /** Pickup-playable window, floored at `earliestPlayableDate` — includes
   *  today for immediate leagues, tomorrow→Sunday for next-day, full next
   *  Mon-Sun on Sunday / weekly. */
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
 * Stable hook order: always fourteen `useGameDay` calls regardless of how
 * many days the grid holds (7 for a normal week, up to 14 for a combined
 * week), so React doesn't choke on conditional hooks. Slots past the grid
 * get `undefined` and skip their fetch. The projection iterates
 * `playableDays`; days outside the pickup window are fetched-but-unused
 * (their cache lines warm up for the StreamingBoard date strip too).
 */
export function useWeekPitcherScores(
  faPool: FreeAgentPlayer[],
  scoredCategories: EnrichedLeagueStatCategory[],
  teamOffense?: Record<number, TeamOffense>,
  categoryWeights?: Record<number, number>,
  earliestPlayableDate?: string,
  weekBounds?: WeekBounds,
): UseWeekPitcherScoresResult {
  const gridDays = useMemo(() => getStreamingGridDays(new Date(), earliestPlayableDate, weekBounds), [earliestPlayableDate, weekBounds]);
  const playableDays = useMemo(() => getPickupPlayableDays(new Date(), earliestPlayableDate, weekBounds), [earliestPlayableDate, weekBounds]);

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

  const gamesByDate = useMemo(() => {
    const m = new Map<string, EnrichedGame[]>();
    gridDays.forEach((day, i) => {
      m.set(day.date, (dayResults[i]?.games ?? []) as EnrichedGame[]);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridDays, ...dayResults.map(d => d.games)]);

  // Pivot teamOffense Record into a Map for the engine.
  const teamOffenseMap = useMemo(() => {
    if (!teamOffense) return undefined;
    const m = new Map<number, TeamOffense>();
    for (const [k, v] of Object.entries(teamOffense)) {
      m.set(Number(k), v);
    }
    return m;
  }, [teamOffense]);

  // Yahoo-confirmed starters the MLB slate doesn't back up. Yahoo names
  // tomorrow's starter before StatsAPI posts the probable slot, and when the
  // two disagree we believe Yahoo — but a pitcher with no posted probable has
  // no talent stamped on the slate, so we resolve talent for just these arms.
  // Gated on the date Yahoo ECHOED (it ignores the one we send and always
  // answers for the next game day) intersected with the playable window, so a
  // stale flag can never leak onto a later day.
  const playableDateSet = useMemo(() => new Set(playableDays.map(d => d.date)), [playableDays]);

  const yahooConfirmed = useMemo(() => {
    const out = new Map<string, string>(); // player_key -> confirmed date
    for (const fa of faPool) {
      const ss = fa.starting_status;
      if (!ss?.isStarting || !playableDateSet.has(ss.date)) continue;
      const games = gamesByDate.get(ss.date) ?? [];
      const posted = games.some(g =>
        (g.homeProbablePitcher && isLikelySamePlayer(fa.name, g.homeProbablePitcher.name)) ||
        (g.awayProbablePitcher && isLikelySamePlayer(fa.name, g.awayProbablePitcher.name)),
      );
      if (!posted) out.set(fa.player_key, ss.date);
    }
    return out;
  }, [faPool, playableDateSet, gamesByDate]);

  const needTalent = useMemo(
    () => faPool.filter(fa => yahooConfirmed.has(fa.player_key)),
    [faPool, yahooConfirmed],
  );
  const { getTalent } = usePitcherTalent(needTalent);

  const scored = useMemo<WeekPitcherScore[]>(() => {
    if (faPool.length === 0 || scoredCategories.length === 0) return [];
    if (playableDays.length === 0) return [];

    const deps: PitcherProjectionDeps = {
      days: playableDays,
      gamesByDate,
      scoredCategories,
      teamOffense: teamOffenseMap,
      categoryWeights,
    };

    const out: WeekPitcherScore[] = [];
    for (const fa of faPool) {
      const confirmedStartDate = yahooConfirmed.get(fa.player_key) ?? null;
      const active: ActivePitcher = {
        // Name-based matching — placeholder mlbId is fine.
        mlbId: 0,
        name: fa.name,
        teamAbbr: fa.editorial_team_abbr,
        confirmedStartDate,
        // Only the Yahoo-confirmed path needs pre-resolved talent; everyone
        // else reads it off the matched probable.
        talent: confirmedStartDate
          ? getTalent(fa.name, fa.editorial_team_abbr)?.talent ?? null
          : undefined,
      };
      const projection = projectPitcherPlayer(active, deps);
      // Drop FAs that have zero projected starts in the pickup window —
      // they won't surface meaningfully on the board, and including them
      // pads the candidate count.
      if (projection.expectedStarts === 0) continue;
      out.push({ player: fa, projection });
    }
    return out;
  }, [faPool, scoredCategories, playableDays, gamesByDate, teamOffenseMap, categoryWeights, yahooConfirmed, getTalent]);

  const isLoading = dayResults.some(d => d.isLoading);

  return { scored, days: playableDays, isLoading };
}
