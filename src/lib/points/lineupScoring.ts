/**
 * Client-side points scoring for the unified lineup page. Categories scores
 * each batter client-side via `getBatterRating`; this is the points analog so
 * the SAME `LineupManager` data flow (roster + stats + games hooks) serves
 * both modes — only the injected scorer differs. All deps are client-safe
 * (pure talent/points math, no server imports).
 */

import { toBatterSeasonStats } from '@/lib/mlb/adapters';
import { batterPointsValue } from './pointsValue';
import { adjustedBatterPointsPerPA } from './matchupAdjust';
import { expectedPAperGame } from '@/lib/projection/batterTeam';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import type { PlayerStatLine } from '@/lib/mlb/types';
import type { MatchupContext } from '@/lib/mlb/analysis';

export interface BatterPointsScore {
  /** Projected points for the selected day — matchup-adjusted (park /
   *  platoon / opposing staff) when game context is supplied. */
  today: number;
  /** Talent-neutral expected points per game (the anchor). */
  perGame: number;
  /** Talent-neutral expected points per typical week. */
  weekly: number;
  /** Today's matchup adjustment vs neutral; multiplier 1 / empty hint when
   *  idle or context is missing. */
  matchup: { multiplier: number; hint: string };
}

/**
 * Score one batter for the selected day. `gameCount` is 0 (idle), 1, or 2
 * (doubleheader); idle players collapse to 0 so they sink in sort/optimizer.
 * Pass `context` to matchup-adjust today's rate; perGame/weekly stay neutral.
 */
export function batterPointsScore(
  line: PlayerStatLine | null,
  profile: ScoringProfile,
  opts: { battingOrder: number | null; gameCount: number; context?: MatchupContext | null },
): BatterPointsScore {
  const noMatchup = { multiplier: 1, hint: '' };
  if (!line) return { today: 0, perGame: 0, weekly: 0, matchup: noMatchup };
  const stats = toBatterSeasonStats(line);
  const v = batterPointsValue(stats, profile);
  if (opts.gameCount <= 0) {
    return { today: 0, perGame: v.pointsPerGame, weekly: v.weeklyPoints, matchup: noMatchup };
  }
  const adj = adjustedBatterPointsPerPA(stats, profile, opts.context ?? null, opts.battingOrder);
  const today = adj.pointsPerPA * expectedPAperGame(opts.battingOrder) * opts.gameCount;
  return {
    today,
    perGame: v.pointsPerGame,
    weekly: v.weeklyPoints,
    matchup: { multiplier: adj.multiplier, hint: adj.hint },
  };
}
