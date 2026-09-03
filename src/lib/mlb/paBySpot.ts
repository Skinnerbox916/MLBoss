/**
 * Expected plate appearances per game by lineup spot — the volume half of
 * every batter projection, and the L3 rating's opportunity multiplier.
 *
 * ONE home on purpose: this shape previously lived twice (a ±8% linear
 * ramp in projection/batterTeam.ts and a mirrored copy in
 * mlb/batterRating.ts) and drifted from reality at the top of the order.
 * Calibration + sources: docs/projection.md#pa-by-lineup-spot
 *
 * THREE FACTORS, separately anchored:
 *   slot PA  ×  starter share  ×  platoon hook
 */

/** PA per game accrued by each lineup SLOT 1–9 (hard-sourced; see doc).
 *  A slot's PA includes everyone who bats in it — the starter AND any
 *  pinch-hitter / substitute who takes the spot after him. */
const PA_PER_GAME_SLOT = [4.65, 4.55, 4.43, 4.33, 4.24, 4.13, 4.01, 3.9, 3.77] as const;

/** Share of the slot's PA that goes to a STARTER who is NOT platoon-lifted
 *  (ledger-derived; see doc). We forecast players in posted lineups, so the
 *  starter is the population we grade — and starters lose PA to
 *  substitutions. Not monotone at the top because this factor also absorbs
 *  drift in the 2016 slot table's shape; only the product is calibrated. */
const STARTER_SHARE = [0.978, 0.978, 0.982, 0.982, 0.979, 0.975, 0.969, 0.956, 0.942] as const;

/**
 * What a starter WITH the platoon edge on the opposing starter keeps of that
 * share (ledger-derived; see doc). He is the batter lifted for a pinch hitter
 * when the opposing bullpen brings a same-hand arm, so he banks fewer PA than
 * his spot implies — barely at the top of the order, ~7% at the bottom, where
 * managers substitute freely. A batter WITHOUT the edge is a full-timer who
 * stays in, and a switch hitter is never platoon-hooked at all; both take 1.0.
 */
const PLATOON_HOOK = [0.985, 0.984, 0.980, 0.971, 0.958, 0.944, 0.935, 0.932, 0.934] as const;

/** Share of posted-lineup starters who have the platoon edge (measured on the
 *  retro cohort). Used only to average the hook away when the opposing hand
 *  isn't known — a week-long horizon, an unknown probable, a switch pitcher. */
const EDGE_SHARE = 0.514;

/** No-signal fallback when the batting order is unknown (estimated; see doc).
 *  Held ~1.7% below the starter-basis slot mean, as before: bats with no
 *  posted/cached spot skew part-time and bottom-of-order. */
export const PA_PER_GAME_NO_SPOT = 3.95;

/**
 * Whether the batter has the platoon edge on the opposing starter, which is
 * what decides if he is a pinch-hit candidate late. `null` = unknown hand on
 * either side (or a multi-day horizon), which takes the population average.
 */
export type PlatoonHook = 'edge' | 'held' | null;

/** Resolve the hook from the two hands. Switch hitters always turn to the
 *  advantage side, so they are never platoon-lifted — they are 'held'. */
export function platoonHookOf(
  bats: 'L' | 'R' | 'S' | null | undefined,
  facingHand: 'L' | 'R' | null | undefined,
): PlatoonHook {
  if (bats == null || facingHand == null) return null;
  if (bats === 'S') return 'held';
  return bats === facingHand ? 'held' : 'edge';
}

function hookFactor(i: number, hook: PlatoonHook): number {
  if (hook === 'held') return 1;
  if (hook === 'edge') return PLATOON_HOOK[i];
  return EDGE_SHARE * PLATOON_HOOK[i] + (1 - EDGE_SHARE);
}

/**
 * Expected PA per game for a batter starting at lineup `spot` (1–9).
 * Returns the no-signal fallback for null / out-of-range input.
 */
export function expectedPAperGame(spot: number | null, hook: PlatoonHook = null): number {
  if (spot == null || !Number.isFinite(spot) || spot < 1 || spot > 9) {
    return PA_PER_GAME_NO_SPOT;
  }
  const i = Math.round(spot) - 1;
  return PA_PER_GAME_SLOT[i] * STARTER_SHARE[i] * hookFactor(i, hook);
}

/**
 * Opportunity ratio vs the no-signal baseline — what the batter rating's
 * composite multiplies by. Self-consistent with the projection: a rating
 * at unknown order (ratio 1.0) implicitly assumes the fallback PA count.
 */
export function paOpportunityRatio(spot: number, hook: PlatoonHook = null): number {
  return expectedPAperGame(spot, hook) / PA_PER_GAME_NO_SPOT;
}
