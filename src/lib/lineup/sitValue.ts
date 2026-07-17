/**
 * Per-player-per-day sit-vs-start value (L5/L7).
 *
 * The composite `getBatterRating` score answers "how good is this player vs
 * a league-average bat?" — its neutral baseline is 50 = average. That's the
 * WRONG counterfactual for a sit decision: when you bench a player the slot's
 * counterfactual is ZERO production (empty slot), not an average replacement.
 * A below-average-but-productive bat scores ~45 yet is worth starting because
 * he still adds real counting stats vs the nothing you'd get sitting him.
 *
 * This engine answers the actual question: **does PLAYING this batter today
 * move my matchup favorably, net, given the game plan?** It sums the margin
 * movement that playing causes in each scored category, weighted by each
 * category's **pivotality weight** (how contested it is; 0 if conceded), in
 * the same margin-point unit the matchup analyzer uses (so the terms are
 * comparable):
 *
 *   - Counting, higher-better (HR/R/RBI/TB/H/SB/BB): playing always adds a
 *     favorable `E[count] / scale`. A locked win carries a small pivotality
 *     weight (its lead is safe, so extra production barely matters) and a
 *     conceded cat carries 0 — which is what unlocks sitting for ratios.
 *   - Batter K (lower-better counting): you can't strike out from the bench,
 *     so playing always adds an UNfavorable `E[K] / scale`.
 *   - AVG (rate): playing shifts team AVG toward the player's expected AVG.
 *     Marginal dilution against the team's projected AVG/AB anchor; negative
 *     when he hits below the team's projected average.
 *
 * `net < 0` means the K/AVG harm outweighs the counting value the plan still
 * cares about → sitting (empty slot) beats playing. A small deadband avoids
 * benching on negligible margins.
 *
 * Expected counts come from the same game-context substrate as the projection
 * engine: `rating.categories[].expected` (per-PA rate; per-AB for AVG) ×
 * expected PA, exactly as `projectBatterPlayer` derives them. Park / weather /
 * opposing SP are already folded into `expected`.
 */

import type { BatterRating } from '@/lib/mlb/batterRating';
import { RATE_SCALE, CORRECTED_COUNTING_SCALE, LOCKED_THRESHOLD } from '@/lib/matchup/analysis';
import { pivotality } from '@/lib/rating/pivotality';

/** Matches `AB_PER_PA` in projection/batterTeam.ts — AB ≈ PA × 0.91. */
const AB_PER_PA = 0.91;

const AVG_STAT_ID = 3;

/** Net margin below which playing is deemed net-harmful enough to sit.
 *  Small negative deadband so we don't bench on noise. */
export const SIT_DEADBAND = 0.03;

export interface SitCatContribution {
  statId: number;
  label: string;
  /** Signed margin movement from PLAYING in this cat. Positive = playing
   *  helps the matchup; negative = playing hurts it. */
  marginDelta: number;
  /** Short note for the "why benched" line, e.g. "+1.3 K", "dilutes AVG". */
  note: string;
}

export interface BatterSitValue {
  /** Sum of per-cat margin deltas from playing. < 0 → net-harmful to play. */
  net: number;
  /** Non-zero contributions, sorted by absolute impact descending. */
  perCat: SitCatContribution[];
  /** True when `net` is below the negative deadband — a sit candidate. */
  shouldSit: boolean;
}

export interface SitValueInputs {
  rating: BatterRating;
  /** Expected plate appearances on this day (PA/game × game count).
   *  Doubleheaders double both harm and value, which falls out naturally. */
  expectedPA: number;
  /**
   * AVG dilution anchor. `oppAvg` is the OPPONENT's projected team AVG — the
   * bar you must clear to win the category. We deliberately do NOT anchor on
   * your own projected AVG: a hot, small-sample team AVG (e.g. .333) makes
   * every realistic bat look dilutive. The category is won by beating the
   * opponent, so a bat above their projected AVG is accretive and below it is
   * a drag. `myWeekAB` is your projected AB volume — the denominator for how
   * much one bat's ABs move your team rate. When omitted, AVG is skipped.
   */
  avgAnchor?: { oppAvg: number; myWeekAB: number };
  /** Pivotality weight per stat_id (0 = conceded). The per-cat importance in
   *  the sit calc: a contested cat ≈ 1, a locked win small, a conceded cat 0.
   *  Missing entries are treated as 0 (not in play). */
  categoryWeights: Record<number, number>;
  deadband?: number;
}

/**
 * Compute the net matchup value of playing a batter today. The focus per
 * category is read from `rating.categories[].focus` — i.e. the same focusMap
 * the rating was built with — so chase/hold/punt weighting is consistent
 * with the game plan the user sees.
 */
export function computeBatterSitValue(input: SitValueInputs): BatterSitValue {
  const { rating, expectedPA, avgAnchor, categoryWeights } = input;
  const deadband = input.deadband ?? SIT_DEADBAND;
  const expectedAB = expectedPA * AB_PER_PA;

  const perCat: SitCatContribution[] = [];

  for (const cat of rating.categories) {
    const w = categoryWeights[cat.statId] ?? 0;
    if (w === 0) continue; // conceded — playing adds nothing we value

    if (cat.statId === AVG_STAT_ID) {
      if (!avgAnchor || avgAnchor.myWeekAB <= 0) continue;
      const playerAvg = cat.expected;
      // Marginal shift of my team AVG from this bat's ABs, measured against
      // the opponent's AVG bar rather than my own inflated current AVG.
      const deltaVsBar =
        (expectedAB * (playerAvg - avgAnchor.oppAvg)) / avgAnchor.myWeekAB;
      const marginDelta = (w * deltaVsBar) / RATE_SCALE.AVG;
      if (marginDelta === 0) continue;
      perCat.push({
        statId: cat.statId,
        label: cat.label,
        marginDelta,
        note: playerAvg < avgAnchor.oppAvg ? 'dilutes AVG' : 'lifts AVG',
      });
      continue;
    }

    const scale = CORRECTED_COUNTING_SCALE[cat.statId];
    if (scale === undefined) continue;
    const eCount = cat.expected * expectedPA;
    const sign = cat.betterIs === 'lower' ? -1 : 1;
    const marginDelta = (sign * w * eCount) / scale;
    if (marginDelta === 0) continue;
    perCat.push({
      statId: cat.statId,
      label: cat.label,
      marginDelta,
      // For lower-better cats (batter K) playing ADDS the stat, which hurts —
      // show it as "+N K" so the harm reads naturally in the why-benched line.
      note: `${sign < 0 ? '+' : ''}${eCount.toFixed(1)} ${cat.label}`,
    });
  }

  perCat.sort((a, b) => Math.abs(b.marginDelta) - Math.abs(a.marginDelta));
  const net = perCat.reduce((s, c) => s + c.marginDelta, 0);

  return { net, perCat, shouldSit: net < -deadband };
}

// ---------------------------------------------------------------------------
// Endgame sit plan
// ---------------------------------------------------------------------------

/** Batter K stat_id (lower-better counting). */
const BATTER_K_STAT_ID = 21;

/** Higher-better batter counting cats — the production sitting sacrifices. */
const COUNTING_HIGHER = new Set([7, 8, 12, 13, 16, 18, 23]);

/** Cats sitting can actively protect: AVG (rate) and batter K. */
const RATIO_OR_K = new Set([AVG_STAT_ID, BATTER_K_STAT_ID]);

/** Pivotality (≈ at |margin| ~0.4) above which a ratio/K cat counts as
 *  contested — close enough to be worth protecting. */
const CONTESTED_RATIO = 0.5;

/** The chase stops once the protected cat is projected to be won by this
 *  much margin (≈ 1 K on the K scale) — a small cushion past the flip, not
 *  a license to keep benching a race that's already won. */
const SIT_WIN_BUFFER = 0.1;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Numeric corrected end-of-week totals for one scored batter cat — the
 *  same values `analyzeMatchup` saw (parse of the corrected row). */
export interface SitPlanRow {
  statId: number;
  betterIs: 'higher' | 'lower';
  my: number;
  opp: number;
}

export interface SitPlanCandidate {
  key: string;
  name: string;
  /** Rating for THIS day's matchup — only `categories[].expected` (per-PA,
   *  matchup-adjusted) is consumed; weights on the rating are ignored. */
  rating: BatterRating;
  /** Expected PA today (PA/game × game count — doubleheaders count double). */
  expectedPA: number;
}

export interface SitPlanInput {
  /** One row per scored batter cat. The caller must pass a COMPLETE set —
   *  if any scored batter cat lacks comparable corrected values, don't
   *  call this (we can't verify it's safe to sacrifice what we can't see). */
  rows: SitPlanRow[];
  /** stat_ids currently conceded (weight 0 — auto or user override). */
  concededSet: Set<number>;
  /** Movable game-day batters (editable, not injured, not NS). */
  candidates: SitPlanCandidate[];
  /** AVG dilution anchor — see `SitValueInputs.avgAnchor`. */
  avgAnchor?: { oppAvg: number; myWeekAB: number };
  /** Days elapsed in the matchup week — drives the AVG margin's
   *  week-progress confidence factor, mirroring `computeMargin`. */
  daysElapsed: number;
  /** Total days in the matchup week (default 7) — irregular Yahoo weeks
   *  (short week 1, combined all-star week) pass the real span. */
  weekLengthDays?: number;
  deadband?: number;
}

export interface SitPlanSit {
  key: string;
  name: string;
  net: number;
  reasons: string[];
}

export interface SitPlan {
  sits: SitPlanSit[];
}

/**
 * The endgame sit plan — which bats (if any) to bench today to protect a
 * losing K/AVG race. Auto-sitting is restricted to the matchup's endgame,
 * when it has reduced to one live question. Greedy, one bat at a time,
 * re-deriving margins after each sit; every iteration re-checks three rules:
 *
 *  1. **Everything sitting hurts is already decided.** Every higher-better
 *     counting cat must be conceded or locked (|margin| ≥ LOCKED_THRESHOLD).
 *     One contested counting cat anywhere → no sitting at all. (K and AVG
 *     are exempt — they're what we're managing.)
 *  2. **The locks survive the sitting.** Before each bench, the candidate's
 *     expected production is subtracted from the projected totals; if any
 *     locked win would drop below the lock threshold, stop. This closes the
 *     fragile-lock hole that killed the original sit-to-flip PRD (margins
 *     assume you keep playing; benches erode them).
 *  3. **Sit only while it changes the answer, above the noise floor.** A
 *     chased cat must be contested AND at-or-below `SIT_WIN_BUFFER`; once
 *     the projection flips past the buffer, the chase disarms. A bat sits
 *     only when his net harm clears `SIT_DEADBAND` (`shouldSit`), so the
 *     optimizer can never bench on a coin-flip net ≈ 0.
 *
 * Rules 2+3 together are the stopping condition: the loop ends when the
 * race flips, when a lock would wobble, or when no bat is harmful beyond
 * noise — whichever comes first. If the race can't flip, sitting continues
 * only while it's genuinely free (everything else locked and staying
 * locked), which is the correct play in that state.
 *
 * This applies to TODAY only — Optimize Week always fills future days
 * (a Thursday shouldn't pre-bench Sunday when Sunday can be re-decided
 * with real information). See docs/history.md "2026-06 — Endgame rewrite".
 */
export function computeSitPlan(input: SitPlanInput): SitPlan {
  const { rows, concededSet, candidates, avgAnchor, daysElapsed } = input;
  const weekLengthDays = input.weekLengthDays ?? 7;
  const deadband = input.deadband ?? SIT_DEADBAND;

  // Mutable copy of my projected totals; opponent totals are fixed.
  const myTotal = new Map<number, number>();
  for (const r of rows) myTotal.set(r.statId, r.my);

  // Unclamped margin from current totals — unclamped so erosion bookkeeping
  // works past the display clamp (a 1.37 lock eroding to 1.27 is still
  // locked; storing the clamped 1.0 would misread that as erosion).
  const marginOf = (r: SitPlanRow): number => {
    const my = myTotal.get(r.statId) ?? r.my;
    const dir = r.betterIs === 'lower' ? -1 : 1;
    if (r.statId === AVG_STAT_ID) {
      const confidence = 0.15 + 0.85 * clamp(daysElapsed / Math.max(weekLengthDays, 1), 0.1, 1);
      return (((my - r.opp) * dir) / RATE_SCALE.AVG) * confidence;
    }
    const scale = CORRECTED_COUNTING_SCALE[r.statId];
    if (scale === undefined) return 0;
    return ((my - r.opp) * dir) / scale;
  };

  // Subtract (or restore, sign=-1) one candidate's expected production for
  // today from my projected totals.
  const applySit = (c: SitPlanCandidate, sign: 1 | -1) => {
    for (const cat of c.rating.categories) {
      if (cat.statId === AVG_STAT_ID) {
        if (!avgAnchor || avgAnchor.myWeekAB <= 0) continue;
        // Same approximation as the sit-value AVG term: his ABs shift the
        // team rate by (AB × (his AVG − bar)) / weekAB; sitting removes it.
        const expectedAB = c.expectedPA * AB_PER_PA;
        const shift = (expectedAB * (cat.expected - avgAnchor.oppAvg)) / avgAnchor.myWeekAB;
        myTotal.set(cat.statId, (myTotal.get(cat.statId) ?? 0) - sign * shift);
        continue;
      }
      if (!COUNTING_HIGHER.has(cat.statId) && cat.statId !== BATTER_K_STAT_ID) continue;
      const eCount = cat.expected * c.expectedPA;
      myTotal.set(cat.statId, (myTotal.get(cat.statId) ?? 0) - sign * eCount);
    }
  };

  const sits: SitPlanSit[] = [];
  const pool = [...candidates];

  for (let iter = 0; iter <= candidates.length && pool.length > 0; iter++) {
    const margins = new Map<number, number>();
    for (const r of rows) margins.set(r.statId, marginOf(r));

    // Rule 1 — every higher-better counting cat decided (conceded or locked).
    let allDecided = true;
    for (const r of rows) {
      if (!COUNTING_HIGHER.has(r.statId)) continue;
      if (concededSet.has(r.statId)) continue;
      if (Math.abs(margins.get(r.statId) ?? 0) >= LOCKED_THRESHOLD) continue;
      allDecided = false;
      break;
    }
    if (!allDecided) break;

    // Rule 3 (chase half) — a live K/AVG race: contested and not yet won
    // past the buffer.
    const hasChase = rows.some(r => {
      if (!RATIO_OR_K.has(r.statId)) return false;
      if (concededSet.has(r.statId)) return false;
      const m = margins.get(r.statId) ?? 0;
      return pivotality(clamp(m, -1, 1)) >= CONTESTED_RATIO && m <= SIT_WIN_BUFFER;
    });
    if (!hasChase) break;

    // Weights from the CURRENT (post-prior-sits) margins — clamped to match
    // what `analyzeMatchup` would feed `pivotality`.
    const weights: Record<number, number> = {};
    for (const r of rows) {
      weights[r.statId] = concededSet.has(r.statId)
        ? 0
        : pivotality(clamp(margins.get(r.statId) ?? 0, -1, 1));
    }

    // Worst offender beyond the noise floor.
    let worst: { c: SitPlanCandidate; sv: BatterSitValue } | null = null;
    for (const c of pool) {
      const sv = computeBatterSitValue({
        rating: c.rating,
        expectedPA: c.expectedPA,
        avgAnchor,
        categoryWeights: weights,
        deadband,
      });
      if (!sv.shouldSit) continue;
      if (!worst || sv.net < worst.sv.net) worst = { c, sv };
    }
    if (!worst) break;

    // Rule 2 — would this bench erode any lock below the threshold?
    applySit(worst.c, 1);
    let erodes = false;
    for (const r of rows) {
      if (!COUNTING_HIGHER.has(r.statId)) continue;
      if (concededSet.has(r.statId)) continue;
      const before = margins.get(r.statId) ?? 0;
      if (before >= LOCKED_THRESHOLD && marginOf(r) < LOCKED_THRESHOLD) {
        erodes = true;
        break;
      }
    }
    if (erodes) {
      applySit(worst.c, -1); // restore — this bench (and any further) is unsafe
      break;
    }

    sits.push({
      key: worst.c.key,
      name: worst.c.name,
      net: worst.sv.net,
      reasons: worst.sv.perCat
        .filter(p => p.marginDelta < 0)
        .slice(0, 2)
        .map(p => p.note),
    });
    pool.splice(pool.indexOf(worst.c), 1);
  }

  return { sits };
}
