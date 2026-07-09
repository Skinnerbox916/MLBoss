/**
 * L6 roster value — a batter's ROS value to a *specific* team, in
 * leverage-weighted move units.
 *
 * The three-piece model (see docs/roster-value-proposal.md; folded into
 * docs/roster-strategy.md on ship):
 *
 *   value(player) = Σ over scored cats:
 *       weight(cat) × signed contribution(cat, player) / RUPM(cat)
 *
 *   weight(cat)   = conceded ? 0 : pivotality(distance)
 *   distance(cat) = signed moves-from-a-winning-rank, scaled so the
 *                   reachability bar (REACHABLE_GAP_MOVES) lands on the
 *                   pivotality decided-boundary (0.7) — the same geometry
 *                   the L5 matchup pages use for margin.
 *
 * Everything here is a pure function usable on both server and client.
 * The forecast API returns the projection *facts* (per-player weekly
 * category lines, RUPM, rankings); the client applies the *strategy*
 * (concede overrides → weights → values) so a concede toggle re-ranks
 * instantly without a refetch.
 *
 * Layer discipline: this file produces L6's own `distance` for the shared
 * `pivotality()` primitive. Never feed it an L5 matchup margin — see
 * docs/pivotality-migration.md#layer-independence-load-bearing.
 */

import { pivotality } from '@/lib/rating/pivotality';
import {
  isRatioCat,
  REACHABLE_GAP_MOVES,
  type ForecastEntry,
} from './forecast';
import { RATIO_VOLUME_SHARE } from './rupm';

// ---------------------------------------------------------------------------
// Leverage — per-category weights from the league forecast
// ---------------------------------------------------------------------------

/**
 * Distance value the reachability bar maps to. Mirrors the L5 matchup
 * pages' DECIDED_LOSS_THRESHOLD (|margin| = 0.7 → decided) so both layers
 * feed `pivotality()` the same geometry: a cat exactly at the concede bar
 * (REACHABLE_GAP_MOVES away from a winning rank) gets the same residual
 * weight (~0.13) as a just-decided weekly cat. One move away ≈ 0.6;
 * at the boundary = 1.0. See docs/pivotality-migration.md#calibration-constants.
 */
export const DECIDED_DISTANCE = 0.7;

/**
 * Weight floor below which a category is treated as effectively out of
 * play for the flat-fallback check (owner decision: the page must always
 * rank *something* — if every cat is cushioned/conceded to nothing, drop
 * to unweighted talent value rather than showing a zeroed board).
 */
const FLAT_FALLBACK_EPS = 0.05;

export type ConcedeState = 'concede' | 'contest';

export type LeverageStatus = 'contested' | 'cushioned' | 'conceded';

export interface CategoryLeverage {
  statId: number;
  displayName: string;
  betterIs: 'higher' | 'lower';
  /**
   * Signed competitive distance, clamped to [−1, +1]. 0 = exactly at the
   * winning boundary (rank 2/3 line); positive = cushion above it in
   * scaled move units; negative = deficit below.
   */
  distance: number;
  /** pivotality(distance) — the in-play weight before concession. */
  pivotalWeight: number;
  /** Final weight: 0 when conceded; pivotalWeight otherwise (or 1 under
   *  the flat fallback). */
  weight: number;
  status: LeverageStatus;
  /** Conceded by the reachability rule with no user override. */
  autoConceded: boolean;
}

export interface RosterLeverage {
  byStatId: Map<number, CategoryLeverage>;
  /** True when every cat's resolved weight fell below the floor and the
   *  unweighted fallback engaged (all weights forced to 1). */
  flatFallback: boolean;
}

/**
 * Signed gap (in the cat's native value units) between two team values,
 * positive when `a` is better than `b` for this cat's direction.
 */
function signedGap(a: number, b: number, betterIs: 'higher' | 'lower'): number {
  return betterIs === 'higher' ? a - b : b - a;
}

/**
 * Competitive distance for one forecast entry:
 *  - Winning position (rank ≤ 2): +cushion over the best competitive
 *    (non-outlier) team below the winning boundary, in scaled move units.
 *    No challenger → fully cushioned (+1).
 *  - Behind with a reachable target: −movesToTarget, scaled.
 *  - Behind with nothing reachable: −1 (the auto-concede zone).
 *  - RUPM unavailable (no FA pool data): 0 — treat as contested rather
 *    than inventing a direction.
 */
export function forecastDistance(entry: ForecastEntry): number {
  const scale = DECIDED_DISTANCE / REACHABLE_GAP_MOVES;
  if (entry.me.rank <= 2) {
    if (entry.rupm <= 0) return 0;
    const challenger = entry.ranking.find(t => t.rank > 2 && !t.isOutlier);
    if (!challenger) return 1;
    const cushionMoves =
      signedGap(entry.me.projectedValue, challenger.projectedValue, entry.betterIs)
      / ratioAwareRupm(entry);
    return clamp(cushionMoves * scale, -1, 1);
  }
  if (entry.targetRank !== undefined && entry.movesToTarget !== undefined) {
    return clamp(-entry.movesToTarget * scale, -1, 1);
  }
  return -1;
}

/**
 * RUPM in *team-value* units for gap math. Counting cats: RUPM already is
 * the per-move team count change. Ratio cats: `computeRupm` pre-scaled the
 * player-rate gap by RATIO_VOLUME_SHARE, which converts it to a team-level
 * rate change — so it's directly comparable to team-value gaps too.
 * Kept as a named helper so the unit reasoning lives in one place.
 */
function ratioAwareRupm(entry: ForecastEntry): number {
  return entry.rupm;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Pitcher-side distance — z-based until pitcher RUPM exists.
 *
 * Pitcher cats have no RUPM (no pitcher FA-pool projection yet — see
 * docs/roster-strategy.md "Forward focus: v1"), so their distance maps
 * `zCompetitive` onto the same [−1, +1] scale: z = ±1.5σ (the old v1
 * LOCKED/HARD_PUNT bands) lands at ±1. This is a continuous port of the
 * v1 band semantics, replaced by real RUPM distance when the pitcher
 * pool projection lands.
 */
const PITCHER_Z_AT_EDGE = 1.5;

export function forecastDistanceZ(entry: ForecastEntry): number {
  return clamp(entry.zCompetitive / PITCHER_Z_AT_EDGE, -1, 1);
}

/** Auto-concede rule for one entry, side-aware (see computeCategoryLeverage). */
function isAutoConcededEntry(entry: ForecastEntry, useZDistance: boolean): boolean {
  if (useZDistance) {
    // v1-band port: catastrophic deficit, or below-average with nothing
    // reachable above.
    return (
      entry.zCompetitive <= -PITCHER_Z_AT_EDGE ||
      (entry.zCompetitive < -0.5 && entry.targetRank === undefined)
    );
  }
  return entry.me.rank > 2 && entry.targetRank === undefined;
}

/**
 * Resolve per-category leverage for one side's forecast entries.
 * `overrides` mirrors the L5 concede/contest store (`useCategoryWeights`):
 * user 'concede' forces weight 0, 'contest' un-concedes an auto-conceded
 * cat (it gets its natural — usually small — pivotality weight; the math
 * is honest that a 2-move gap buys little, but the user stays in charge).
 *
 * `opts.useZDistance` selects the pitcher-side z-based distance (no
 * pitcher RUPM yet); default is the batter RUPM distance.
 */
export function computeCategoryLeverage(
  entries: ForecastEntry[],
  overrides: Record<number, ConcedeState> = {},
  opts: { useZDistance?: boolean } = {},
): RosterLeverage {
  const byStatId = new Map<number, CategoryLeverage>();
  const useZ = opts.useZDistance ?? false;

  for (const entry of entries) {
    const distance = useZ ? forecastDistanceZ(entry) : forecastDistance(entry);
    const autoConceded = isAutoConcededEntry(entry, useZ);
    const ov = overrides[entry.statId];
    const conceded = ov === 'concede' ? true : ov === 'contest' ? false : autoConceded;
    const pivotalWeight = pivotality(distance);
    const status: LeverageStatus = conceded
      ? 'conceded'
      : distance >= DECIDED_DISTANCE ? 'cushioned' : 'contested';
    byStatId.set(entry.statId, {
      statId: entry.statId,
      displayName: entry.displayName,
      betterIs: entry.betterIs,
      distance,
      pivotalWeight,
      weight: conceded ? 0 : pivotalWeight,
      status,
      autoConceded: autoConceded && ov === undefined,
    });
  }

  // Flat fallback (owner decision): a board where nothing carries weight
  // ranks nothing — drop to unweighted so the page still orders players
  // by talent value. Fires both when the algo cushions/concedes everything
  // and when the user concedes everything by hand.
  const flatFallback =
    byStatId.size > 0 &&
    Array.from(byStatId.values()).every(l => l.weight < FLAT_FALLBACK_EPS);
  if (flatFallback) {
    for (const l of byStatId.values()) l.weight = 1;
  }

  return { byStatId, flatFallback };
}

// ---------------------------------------------------------------------------
// Per-player contributions and value
// ---------------------------------------------------------------------------

/**
 * Serialized per-player weekly category line, as returned by the forecast
 * API. `c`/`d` mirror `PerCategoryProjection.expectedCount/expectedDenom`
 * (kept terse — a league's worth of these rides in a Redis-cached bundle).
 * Role share (playing-time factor) is already applied server-side.
 */
export interface PlayerCatLine {
  name: string;
  teamAbbr: string;
  byCategory: Record<number, { c: number; d: number }>;
}

/**
 * A player's signed per-category contribution in move units:
 *   counting cats: ±weeklyCount / RUPM
 *   ratio cats:    ±(playerRate − competitiveMedianRate) × VOLUME_SHARE / RUPM
 * Sign flips for lower-is-better cats (a batter's strikeouts are negative
 * value when K is scored). Cats with no RUPM signal contribute 0.
 */
export function playerContributions(
  line: PlayerCatLine,
  entries: ForecastEntry[],
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const entry of entries) {
    const agg = line.byCategory[entry.statId];
    const rupm = entry.rupm;
    if (!agg || rupm <= 0) {
      out[entry.statId] = 0;
      continue;
    }
    const sign = entry.betterIs === 'higher' ? 1 : -1;
    const isRatio = isRatioCat({ name: entry.name, display_name: entry.displayName });
    if (isRatio) {
      if (agg.d <= 0) {
        out[entry.statId] = 0;
        continue;
      }
      const playerRate = agg.c / agg.d;
      out[entry.statId] =
        (sign * (playerRate - entry.competitiveMedian) * RATIO_VOLUME_SHARE) / rupm;
    } else {
      out[entry.statId] = (sign * agg.c) / rupm;
    }
  }
  return out;
}

/** Leverage-weighted sum of a player's contributions — the roster value. */
export function playerRosterValue(
  contributions: Record<number, number>,
  leverage: RosterLeverage,
): number {
  let value = 0;
  for (const [idStr, contrib] of Object.entries(contributions)) {
    const lev = leverage.byStatId.get(Number(idStr));
    if (!lev) continue;
    value += lev.weight * contrib;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Display index — 0-100 within a pool
// ---------------------------------------------------------------------------

/**
 * Owner decision (docs/roster-value-proposal.md#resolved-product-decisions):
 * raw move-units never render. Tables show a 0-100 index scaled within the
 * combined rostered + FA pool: p10 of the pool ≈ 0 (replacement-ish),
 * p99 ≈ 100 (the single best option — a lower ceiling flattened the top
 * half-dozen players into identical 100s). Percentile anchors rather than
 * min/max so one outlier can't compress everyone else.
 */
export function buildIndexScaler(poolValues: number[]): (v: number) => number {
  const sorted = poolValues.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return () => 0;
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const floor = q(0.10);
  const ceil = q(0.99);
  if (ceil <= floor) return () => 50;
  return (v: number) => Math.max(0, Math.min(100, Math.round(((v - floor) / (ceil - floor)) * 100)));
}
