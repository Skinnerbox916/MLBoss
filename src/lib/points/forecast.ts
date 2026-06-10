/**
 * Expected points over a horizon = points RATE (Phase 1) × schedule VOLUME
 * (Phase 2). The horizon is whatever set of days the caller resolved volume
 * for — today, this week's remaining days, next week, etc.
 *
 * Talent-neutral by design (no per-game park / opp / weather). Matchup-quality
 * adjustment belongs to the Phase 3 lineup optimizer, where the day-level
 * start/sit decision lives; over a multi-day horizon, volume dominates value.
 */

import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import { batterPointsPerPA } from './pointsValue';
import { pitcherPointsRateVector } from './rateVector';
import type { PointsPitcherInput } from './pitcherInputs';
import type { BatterVolume, PitcherStartVolume, ReliefVolume } from './schedule';

const STAT_W = 28;
const STAT_SV = 32;

export interface BatterPointsForecast {
  expectedPoints: number;
  pointsPerPA: number;
  games: number;
  expectedPA: number;
}

export function forecastBatterPoints(
  stats: BatterSeasonStats,
  profile: ScoringProfile,
  volume: BatterVolume,
): BatterPointsForecast {
  const pointsPerPA = batterPointsPerPA(stats, profile);
  return {
    expectedPoints: pointsPerPA * volume.expectedPA,
    pointsPerPA,
    games: volume.games,
    expectedPA: volume.expectedPA,
  };
}

export interface PitcherPointsForecast {
  expectedPoints: number;
  pointsPerIP: number;
  role: 'starter' | 'reliever' | 'inactive';
  starts: number;
  reliefAppearances: number;
  expectedIP: number;
  breakdown: { rate: number; wins: number; saves: number };
}

/**
 * Expected pitcher points over a horizon. Starters: per-IP rate × start IP +
 * P(W) × starts × weight[W]. Relievers: per-IP rate × relief IP + save pace ×
 * appearances × weight[SV]. Volume comes from `schedule.ts`.
 */
export function forecastPitcherPoints(
  input: PointsPitcherInput,
  profile: ScoringProfile,
  startVolume: PitcherStartVolume,
  reliefVolume: ReliefVolume,
): PitcherPointsForecast {
  const vec = pitcherPointsRateVector(input.talent, {
    role: input.role,
    seasonSaves: input.seasonSaves,
    seasonGames: input.seasonGames,
  });

  // Per-IP rate points (Outs/K/ER/H/BB/HBP dotted with weights).
  let pointsPerIP = 0;
  for (const [statIdStr, perIP] of Object.entries(vec.perIP)) {
    const w = profile.weights[Number(statIdStr)];
    if (w) pointsPerIP += perIP * w;
  }

  const isStarter = input.role === 'starter';
  const expectedIP = isStarter ? startVolume.expectedIP : reliefVolume.expectedIP;
  const rate = pointsPerIP * expectedIP;
  const wins = isStarter
    ? vec.wPerStart * startVolume.starts * (profile.weights[STAT_W] ?? 0)
    : 0;
  const saves = !isStarter
    ? vec.svPerAppearance * reliefVolume.appearances * (profile.weights[STAT_SV] ?? 0)
    : 0;

  return {
    expectedPoints: rate + wins + saves,
    pointsPerIP,
    role: input.role,
    starts: isStarter ? startVolume.starts : 0,
    reliefAppearances: isStarter ? 0 : reliefVolume.appearances,
    expectedIP,
    breakdown: { rate, wins, saves },
  };
}
