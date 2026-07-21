/**
 * Category impact of a slot-aware streaming add — the categories-league
 * answer to "what is this pickup actually worth?".
 *
 * The slot-aware engine (slotAware.ts) decides WHO starts when the FA is
 * added and who loses their start to make room. This module prices that
 * swap in the league's own currency: the NET change to each scored
 * category over the window (FA's production on the days he starts, minus
 * the displaced starter's production those same days), then one weighted
 * scalar for ranking:
 *
 *   impact = Σ_cats  pivotalityWeight(cat) × netΔ(cat) / starterWeek(cat)
 *
 *   - netΔ is in real units (SB, R, H …), playShare-scaled like the
 *     slot-aware value, sign-flipped for lower-is-better cats (batter K).
 *   - starterWeek normalizes units across cats: a league-average
 *     starter's weekly output of that cat (leagueMean per-PA rate ×
 *     NORM_WEEK_PA). "+1 SB" is worth ~5× "+1 TB" in impact terms.
 *   - Weights are the RAW pivotality weights (0..1, 0 = conceded) — NOT
 *     renormalized. An add that only boosts locked-up cats scores near
 *     zero no matter how large his raw production; the contested cats
 *     dominate the board. This is what makes the ranking agree with the
 *     Game Plan card above it.
 *
 * AVG (stat 3) is a ratio: its delta is the true team-AVG shift from the
 * swap's ΔH/ΔAB against the team's projected week totals, and its impact
 * contribution is hits-above-team-average (ΔH − teamAVG·ΔAB) on the H
 * scale — the standard ratio-cat linearization.
 *
 * Per-day production is decomposed from each player's WEEK aggregate
 * (byCategory × dayPA / weeklyPA) rather than re-deriving day-specific
 * rates — day-to-day matchup variation in category mix is real but small,
 * and both sides of the swap are treated identically.
 */

import { CATEGORY_BASELINE_CONFIG } from '@/lib/mlb/categoryBaselines';
import type { SlotAwarePerDay } from './slotAware';

/** PA volume of the normalizing "league-average starter week" — 6 games
 *  × ~4.1 PA (mirrors the neutral-week volume constants; the absolute
 *  value only sets the impact scale, ordering is unaffected). */
const NORM_WEEK_PA = 25;

const STAT_AVG = 3;
const STAT_H = 8;

/** Week-aggregate production for one player, decomposable to days. */
export interface PlayerWeekCats {
  /** statId → { count, denom } over the projected window. `denom` is AB
   *  for AVG; ignored for counting cats. */
  byCategory: Map<number, { expectedCount: number; expectedDenom: number }>;
  weeklyPA: number;
  /** date → that day's expected PA (absent/0 = no game). */
  paByDate: Map<string, number>;
}

export interface CatDelta {
  statId: number;
  /** Net change in real units over the window (AVG: team-AVG shift). */
  delta: number;
  /** Signed, weighted, unit-normalized contribution to `impact`. */
  contribution: number;
  /** True when the delta helps (handles lower-is-better cats). */
  good: boolean;
}

export interface StreamCatImpact {
  /** Weighted scalar for ranking. */
  impact: number;
  /** Per-cat net deltas, sorted by |contribution| descending. */
  deltas: CatDelta[];
}

export interface StreamCatImpactInput {
  /** Slot-aware per-day output for this FA (assignment + displacement). */
  perDay: SlotAwarePerDay[];
  fa: PlayerWeekCats;
  /** Roster players by player_key — displaced-starter lookups. */
  rosterByKey: Map<string, PlayerWeekCats>;
  /** Playing-time share (0,1] — same factor the slot-aware value uses. */
  playShare: number;
  /** statId → raw pivotality weight (0..1, 0 = conceded). */
  weights: Record<number, number>;
  /** Scored batter cats: id + direction. */
  cats: Array<{ statId: number; betterIs: 'higher' | 'lower' }>;
  /** Team projected week H/AB — the base the AVG shift is measured on. */
  teamWeek: { h: number; ab: number };
}

/** One player's expected production of `statId` on `date`. */
function dayCat(p: PlayerWeekCats, statId: number, date: string): number {
  if (p.weeklyPA <= 0) return 0;
  const cat = p.byCategory.get(statId);
  if (!cat) return 0;
  const pa = p.paByDate.get(date) ?? 0;
  return cat.expectedCount * (pa / p.weeklyPA);
}

/** AB share for the AVG denominator, same decomposition. */
function dayAB(p: PlayerWeekCats, date: string): number {
  if (p.weeklyPA <= 0) return 0;
  const cat = p.byCategory.get(STAT_AVG);
  if (!cat) return 0;
  const pa = p.paByDate.get(date) ?? 0;
  return cat.expectedDenom * (pa / p.weeklyPA);
}

export function computeStreamCatImpact(input: StreamCatImpactInput): StreamCatImpact {
  const { perDay, fa, rosterByKey, playShare, weights, cats, teamWeek } = input;

  // Accumulate net deltas across the days the FA actually starts.
  const net = new Map<number, number>();
  let dH = 0;
  let dAB = 0;
  for (const day of perDay) {
    if (!day.assignedSlot) continue;
    const displaced = day.displacedKeys
      .map(key => rosterByKey.get(key))
      .filter((p): p is PlayerWeekCats => !!p);

    for (const cat of cats) {
      if (cat.statId === STAT_AVG) continue; // handled via ΔH/ΔAB below
      let d = dayCat(fa, cat.statId, day.date);
      for (const p of displaced) d -= dayCat(p, cat.statId, day.date);
      net.set(cat.statId, (net.get(cat.statId) ?? 0) + d * playShare);
    }

    let h = dayCat(fa, STAT_H, day.date);
    let ab = dayAB(fa, day.date);
    for (const p of displaced) {
      h -= dayCat(p, STAT_H, day.date);
      ab -= dayAB(p, day.date);
    }
    dH += h * playShare;
    dAB += ab * playShare;
  }

  const scoresAvg = cats.some(c => c.statId === STAT_AVG);
  const teamAvg = teamWeek.ab > 0 ? teamWeek.h / teamWeek.ab : 0;
  const normH = (CATEGORY_BASELINE_CONFIG[STAT_H]?.leagueMean ?? 0.212) * NORM_WEEK_PA;

  const deltas: CatDelta[] = [];
  let impact = 0;

  for (const cat of cats) {
    const w = Math.max(0, weights[cat.statId] ?? 1);

    if (cat.statId === STAT_AVG) {
      if (!scoresAvg || teamWeek.ab <= 0) continue;
      const shifted = (teamWeek.h + dH) / (teamWeek.ab + dAB || 1);
      const deltaAvg = shifted - teamAvg;
      // Hits above team average, on the H starter-week scale.
      const contribution = w * ((dH - teamAvg * dAB) / normH);
      impact += contribution;
      deltas.push({ statId: STAT_AVG, delta: deltaAvg, contribution, good: deltaAvg >= 0 });
      continue;
    }

    const d = net.get(cat.statId) ?? 0;
    const mean = CATEGORY_BASELINE_CONFIG[cat.statId]?.leagueMean;
    if (!mean || mean <= 0) continue;
    const direction = cat.betterIs === 'lower' ? -1 : 1;
    const contribution = w * ((d * direction) / (mean * NORM_WEEK_PA));
    impact += contribution;
    deltas.push({ statId: cat.statId, delta: d, contribution, good: d * direction >= 0 });
  }

  deltas.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { impact, deltas };
}
