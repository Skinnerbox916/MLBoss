/**
 * Expected plate appearances per game by lineup spot — the volume half of
 * every batter projection, and the L3 rating's opportunity multiplier.
 *
 * ONE home on purpose: this shape previously lived twice (a ±8% linear
 * ramp in projection/batterTeam.ts and a mirrored copy in
 * mlb/batterRating.ts) and drifted from reality at the top of the order.
 * Calibration + sources: docs/projection.md#pa-by-lineup-spot
 */

/** PA per game accrued by each lineup SLOT 1–9 (hard-sourced; see doc).
 *  A slot's PA includes everyone who bats in it — the starter AND any
 *  pinch-hitter / substitute who takes the spot after him. */
const PA_PER_GAME_SLOT = [4.65, 4.55, 4.43, 4.33, 4.24, 4.13, 4.01, 3.9, 3.77] as const;

/** Share of the slot's PA that goes to the STARTER at that slot
 *  (estimated, ledger-derived; see doc). We forecast players in posted
 *  lineups, so the starter is the population we grade — and starters
 *  lose PA to substitutions, increasingly so down the order. */
const STARTER_SHARE = [0.987, 0.981, 0.975, 0.968, 0.962, 0.956, 0.949, 0.943, 0.937] as const;

/** No-signal fallback when the batting order is unknown (estimated; see doc). */
export const PA_PER_GAME_NO_SPOT = 4.0;

/**
 * Expected PA per game for a batter starting at lineup `spot` (1–9).
 * Returns the no-signal fallback for null / out-of-range input.
 */
export function expectedPAperGame(spot: number | null): number {
  if (spot == null || !Number.isFinite(spot) || spot < 1 || spot > 9) {
    return PA_PER_GAME_NO_SPOT;
  }
  const i = Math.round(spot) - 1;
  return PA_PER_GAME_SLOT[i] * STARTER_SHARE[i];
}

/**
 * Opportunity ratio vs the no-signal baseline — what the batter rating's
 * composite multiplies by. Self-consistent with the projection: a rating
 * at unknown order (ratio 1.0) implicitly assumes the fallback PA count.
 */
export function paOpportunityRatio(spot: number): number {
  return expectedPAperGame(spot) / PA_PER_GAME_NO_SPOT;
}
