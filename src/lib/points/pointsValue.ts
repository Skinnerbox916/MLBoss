/**
 * Points-league player value — the dot-product of a player's per-event rate
 * vector against the league's `ScoringProfile.weights`, optionally scaled by
 * expected playing-time volume into expected points per week.
 *
 * This is the points-mode analog of `blendedCategoryScore` (categories). It
 * is talent-neutral and volume-aware in the same way `neutralWeek.ts` is:
 * per-event rates are intrinsic to the player; volume is a role-typical
 * weekly assumption that strips IL-stint / skipped-rotation distortion so the
 * comparison reflects roster shape, not who got hurt.
 *
 * Volume constants intentionally mirror the categories-side `neutralWeek.ts`
 * (TYPICAL_GAMES_PER_WEEK etc.) — same baseball facts, two engines.
 */

import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import type { PitcherTalent } from '@/lib/pitching/talent';
import {
  batterPointsRateVector,
  pitcherPointsRateVector,
  type PitcherRateOptions,
} from './rateVector';

// ---------------------------------------------------------------------------
// Volume model (mirrors src/lib/projection/neutralWeek.ts)
// ---------------------------------------------------------------------------

const TYPICAL_GAMES_PER_WEEK = 6;
const DEFAULT_PA_PER_GAME = 4.1;
const MIN_GP_FOR_PA_RATE = 5;

const TYPICAL_SP_STARTS_PER_WEEK = 1.2;
const TYPICAL_RP_IP_PER_WEEK = 3.0;
const TYPICAL_RP_APPEARANCES_PER_WEEK = 3.0;

const STAT_W = 28;
const STAT_SV = 32;

// ---------------------------------------------------------------------------
// Batter value
// ---------------------------------------------------------------------------

export interface BatterPointsValue {
  /** Expected fantasy points per plate appearance. */
  pointsPerPA: number;
  /** Player's own per-game PA rate (lineup-spot / role signal). */
  paPerGame: number;
  /** Role-typical weekly PA (paPerGame × typical games/week). */
  weeklyPA: number;
  /** Expected fantasy points per typical full week. */
  weeklyPoints: number;
  /** Expected fantasy points per game started. */
  pointsPerGame: number;
}

/** Pure rate: expected points per PA given the league's weights. */
export function batterPointsPerPA(
  stats: BatterSeasonStats,
  profile: ScoringProfile,
): number {
  const vec = batterPointsRateVector(stats);
  let sum = 0;
  for (const [statIdStr, weight] of Object.entries(profile.weights)) {
    const r = vec.perPA[Number(statIdStr)];
    if (r) sum += r * weight;
  }
  return sum;
}

export function batterPointsValue(
  stats: BatterSeasonStats,
  profile: ScoringProfile,
): BatterPointsValue {
  const pointsPerPA = batterPointsPerPA(stats, profile);
  const paPerGame =
    stats.gp >= MIN_GP_FOR_PA_RATE ? stats.pa / stats.gp : DEFAULT_PA_PER_GAME;
  const weeklyPA = paPerGame * TYPICAL_GAMES_PER_WEEK;
  return {
    pointsPerPA,
    paPerGame,
    weeklyPA,
    weeklyPoints: pointsPerPA * weeklyPA,
    pointsPerGame: pointsPerPA * paPerGame,
  };
}

// ---------------------------------------------------------------------------
// Pitcher value
// ---------------------------------------------------------------------------

export interface PitcherPointsValue {
  /** Expected points per IP from the rate events (Outs/K/ER/H/BB/HBP). */
  pointsPerIP: number;
  /** Role-typical weekly innings. */
  ipPerWeek: number;
  /** Expected fantasy points per typical full week, all sources. */
  weeklyPoints: number;
  /** Component breakdown of weeklyPoints. */
  breakdown: {
    rate: number; // per-IP events × ipPerWeek
    wins: number; // wPerStart × startsPerWeek × weight[W]
    saves: number; // svPerAppearance × appearancesPerWeek × weight[SV]
  };
  role: 'starter' | 'reliever' | 'inactive';
}

/** Pure rate: per-IP points from the rate events only (excludes W/SV, which
 *  are per-start / per-appearance, not per-IP). */
export function pitcherPointsPerIP(
  talent: PitcherTalent,
  profile: ScoringProfile,
  opts: PitcherRateOptions = {},
): number {
  const vec = pitcherPointsRateVector(talent, opts);
  let sum = 0;
  for (const [statIdStr, perIP] of Object.entries(vec.perIP)) {
    const w = profile.weights[Number(statIdStr)];
    if (w) sum += perIP * w;
  }
  return sum;
}

export function pitcherPointsValue(
  talent: PitcherTalent,
  profile: ScoringProfile,
  opts: PitcherRateOptions = {},
): PitcherPointsValue {
  const vec = pitcherPointsRateVector(talent, opts);
  const role = opts.role ?? talent.role;

  // Per-IP rate points.
  let ratePointsPerIP = 0;
  for (const [statIdStr, perIP] of Object.entries(vec.perIP)) {
    const w = profile.weights[Number(statIdStr)];
    if (w) ratePointsPerIP += perIP * w;
  }

  const isStarter = role === 'starter';
  const startsPerWeek = isStarter ? TYPICAL_SP_STARTS_PER_WEEK : 0;
  const ipPerWeek = isStarter
    ? startsPerWeek * talent.ipPerStart
    : role === 'reliever'
      ? TYPICAL_RP_IP_PER_WEEK
      : 0;
  const appearancesPerWeek =
    role === 'reliever'
      ? talent.appearancesPerWeek ?? TYPICAL_RP_APPEARANCES_PER_WEEK
      : 0;

  const rate = ratePointsPerIP * ipPerWeek;
  const wins = vec.wPerStart * startsPerWeek * (profile.weights[STAT_W] ?? 0);
  const saves =
    vec.svPerAppearance * appearancesPerWeek * (profile.weights[STAT_SV] ?? 0);

  return {
    pointsPerIP: ratePointsPerIP,
    ipPerWeek,
    weeklyPoints: rate + wins + saves,
    breakdown: { rate, wins, saves },
    role,
  };
}
