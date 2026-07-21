/**
 * Category impact of a pitcher streaming add — the pitcher twin of
 * `streamCatImpact.ts` (batters). Same idea, different shape: price a
 * probable-start pickup in the league's own currency (net K/W/QS/IP added
 * + the ERA/WHIP shift it causes to your projected week), then one weighted
 * scalar for ranking:
 *
 *   impact = Σ_cats  pivotalityWeight(cat) × contribution(cat)
 *
 * Two structural differences from the batter engine:
 *
 *   1. **Pure addition, not displacement.** Streaming an SP adds starts you
 *      wouldn't otherwise have — there's no daily lineup slot he displaces
 *      (P-slot capacity over a week is rarely the binding constraint the
 *      way daily batter slots are, and the board has never modeled it). So
 *      the counting cats (K/W/QS/IP) ARE the net — you had zero of those
 *      starts. This is an honest, documented simplification: a league with
 *      a hard weekly IP cap or no open P slot would want a displacement
 *      model (see docs/projection.md).
 *
 *   2. **Ratio cats are net-of-YOUR-staff, which is the meaningful "net".**
 *      ERA/WHIP impact is the shift to your *projected week* ratio from
 *      adding his innings — an arm at 4.00 helps a 4.50 staff and hurts a
 *      2.90 one. Measured against the team-week baseline exactly like
 *      batter AVG is measured against team-week AB.
 *
 * Counting contributions are always ≥ 0 (you can't add negative Ks); only
 * the ratio cats can go negative — which is the whole point: a high-K,
 * high-ERA streamer shows K +11 alongside ERA +0.09, and the pivotality
 * weights decide whether that trade is worth it for THIS matchup.
 *
 * Normalizers are one league-average start's per-category output (2024-26
 * MLB). They set the cross-category SCALE of the impact scalar only — they
 * never enter a prediction (those come from the forecast layer, graded by
 * the `pitcher-start` ledger engine). Derived from `LEAGUE_IP_PER_START`.
 */

import { LEAGUE_IP_PER_START } from '@/lib/pitching/talent';
import type { CatDelta } from './streamCatImpact';
import type { PerCategoryProjection } from './batterTeam';

const STAT_K = 42;
const STAT_W = 28;
const STAT_QS = 83;
const STAT_IP = 50;
const STAT_ERA = 26;
const STAT_WHIP = 27;

// --- Reference: one league-average SP start's per-category output --------
// (2024-26 MLB; scale-only normalizers, see docblock). All keyed off
// LEAGUE_IP_PER_START so they move together if the IP anchor is retuned.
const REF_IP = LEAGUE_IP_PER_START;              // 5.4
const REF_K = (8.6 / 9) * LEAGUE_IP_PER_START;   // ~8.6 K/9 → ~5.16
const REF_W = 0.38;                              // P(W) league anchor (team ~50%, SP credited ~76%)
const REF_QS = 0.42;                             // league SP quality-start rate ~40-45%
const REF_ER = (4.10 / 9) * LEAGUE_IP_PER_START; // ~4.10 ERA → ~2.46 ER/start
const REF_BR = 1.28 * LEAGUE_IP_PER_START;       // ~1.28 WHIP → ~6.9 baserunners/start

/** League fallback rates (per IP), used only when the team-week baseline
 *  is missing so ratio impact still has something to measure against. */
const LEAGUE_ER_PER_IP = 4.10 / 9;
const LEAGUE_BR_PER_IP = 1.28;

const COUNTING_REF: Record<number, number> = {
  [STAT_K]: REF_K,
  [STAT_W]: REF_W,
  [STAT_QS]: REF_QS,
  [STAT_IP]: REF_IP,
};
const RATIO_REF_NUM: Record<number, number> = {
  [STAT_ERA]: REF_ER,
  [STAT_WHIP]: REF_BR,
};
const RATIO_LEAGUE_RATE: Record<number, number> = {
  [STAT_ERA]: LEAGUE_ER_PER_IP,
  [STAT_WHIP]: LEAGUE_BR_PER_IP,
};

export interface StreamPitcherCatImpactInput {
  /** The FA's projected window totals (`PitcherPlayerProjection.byCategory`):
   *  counting cats → summed count; ratio cats → { numerator, IP }. */
  faByCategory: Map<number, PerCategoryProjection>;
  /** My team's projected week (`PitcherTeamProjectionResponse.byCategory`) —
   *  the ratio baseline the ERA/WHIP shift is measured against. */
  teamByCategory: Record<number, { expectedCount: number; expectedDenom: number }>;
  /** statId → raw pivotality weight (0..1, 0 = conceded). */
  weights: Record<number, number>;
  /** Scored pitcher cats: id + direction. */
  cats: Array<{ statId: number; betterIs: 'higher' | 'lower' }>;
}

export interface StreamPitcherCatImpact {
  impact: number;
  /** Per-cat deltas in real units (counting: added count; ratio: the shift
   *  to your projected week ERA/WHIP), sorted by |contribution| desc. */
  deltas: CatDelta[];
}

export function computeStreamPitcherCatImpact(
  input: StreamPitcherCatImpactInput,
): StreamPitcherCatImpact {
  const { faByCategory, teamByCategory, weights, cats } = input;

  const deltas: CatDelta[] = [];
  let impact = 0;

  for (const cat of cats) {
    const w = Math.max(0, weights[cat.statId] ?? 1);
    const fa = faByCategory.get(cat.statId);

    // Ratio cats (ERA/WHIP): team-week baseline shift.
    if (cat.statId === STAT_ERA || cat.statId === STAT_WHIP) {
      const faNum = fa?.expectedCount ?? 0;   // ER (ERA) or BB+H (WHIP)
      const faIP = fa?.expectedDenom ?? 0;
      if (faIP <= 0) continue;

      const team = teamByCategory[cat.statId];
      const teamNum = team?.expectedCount ?? 0;
      const teamIP = team?.expectedDenom ?? 0;
      const baseRate = teamIP > 0 ? teamNum / teamIP : RATIO_LEAGUE_RATE[cat.statId];

      // "Num prevented vs the pace you'd otherwise run over those innings."
      // Positive = allows fewer than your rate = improves the cat.
      const prevented = baseRate * faIP - faNum;
      const contribution = w * (prevented / RATIO_REF_NUM[cat.statId]);
      impact += contribution;

      // Displayed delta = the actual shift to your projected week ratio.
      const mult = cat.statId === STAT_ERA ? 9 : 1;
      const baseline = teamIP > 0 ? (mult * teamNum) / teamIP : mult * baseRate;
      const shifted = (mult * (teamNum + faNum)) / (teamIP + faIP);
      deltas.push({
        statId: cat.statId,
        delta: shifted - baseline,   // negative = ERA/WHIP drops = good
        contribution,
        good: prevented >= 0,
      });
      continue;
    }

    // Counting cats (K/W/QS/IP): pure addition.
    const ref = COUNTING_REF[cat.statId];
    if (!ref) continue;
    const added = fa?.expectedCount ?? 0;
    if (added <= 0) continue;
    const contribution = w * (added / ref);
    impact += contribution;
    deltas.push({ statId: cat.statId, delta: added, contribution, good: true });
  }

  deltas.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { impact, deltas };
}
