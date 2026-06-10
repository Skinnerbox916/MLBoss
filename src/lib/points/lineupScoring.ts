/**
 * Client-side points scoring for the unified lineup page. Categories scores
 * each batter client-side via `getBatterRating`; this is the points analog so
 * the SAME `LineupManager` data flow (roster + stats + games hooks) serves
 * both modes — only the injected scorer differs. All deps are client-safe
 * (pure talent/points math, no server imports).
 */

import { toBatterSeasonStats } from '@/lib/mlb/adapters';
import { batterPointsValue } from './pointsValue';
import { expectedPAperGame } from '@/lib/projection/batterTeam';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import type { PlayerStatLine } from '@/lib/mlb/types';

export interface BatterPointsScore {
  /** Projected points for the selected day (per-PA × that day's expected PA). */
  today: number;
  /** Talent-neutral expected points per game. */
  perGame: number;
  /** Talent-neutral expected points per typical week. */
  weekly: number;
}

/**
 * Score one batter for the selected day. `gameCount` is 0 (idle), 1, or 2
 * (doubleheader); idle players collapse to 0 so they sink in sort/optimizer.
 */
export function batterPointsScore(
  line: PlayerStatLine | null,
  profile: ScoringProfile,
  opts: { battingOrder: number | null; gameCount: number },
): BatterPointsScore {
  if (!line) return { today: 0, perGame: 0, weekly: 0 };
  const stats = toBatterSeasonStats(line);
  const v = batterPointsValue(stats, profile);
  const today = opts.gameCount > 0 ? v.pointsPerPA * expectedPAperGame(opts.battingOrder) * opts.gameCount : 0;
  return { today, perGame: v.pointsPerGame, weekly: v.weeklyPoints };
}
