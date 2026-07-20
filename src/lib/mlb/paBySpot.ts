/**
 * Expected plate appearances per game by lineup spot — the volume half of
 * every batter projection, and the L3 rating's opportunity multiplier.
 *
 * ONE home on purpose: this shape previously lived twice (a ±8% linear
 * ramp in projection/batterTeam.ts and a mirrored copy in
 * mlb/batterRating.ts) and drifted from reality at the top of the order.
 * Calibration + sources: docs/projection.md#pa-by-lineup-spot
 */

/** PA per game STARTED, lineup spots 1–9 (hard-sourced; see doc). */
const PA_PER_GAME_STARTED = [4.65, 4.55, 4.43, 4.33, 4.24, 4.13, 4.01, 3.9, 3.77] as const;

/** No-signal fallback when the batting order is unknown (estimated; see doc). */
export const PA_PER_GAME_NO_SPOT = 4.1;

/**
 * Expected PA per game for a batter starting at lineup `spot` (1–9).
 * Returns the no-signal fallback for null / out-of-range input.
 */
export function expectedPAperGame(spot: number | null): number {
  if (spot == null || !Number.isFinite(spot) || spot < 1 || spot > 9) {
    return PA_PER_GAME_NO_SPOT;
  }
  return PA_PER_GAME_STARTED[Math.round(spot) - 1];
}

/**
 * Opportunity ratio vs the no-signal baseline — what the batter rating's
 * composite multiplies by. Self-consistent with the projection: a rating
 * at unknown order (ratio 1.0) implicitly assumes the fallback PA count.
 */
export function paOpportunityRatio(spot: number): number {
  return expectedPAperGame(spot) / PA_PER_GAME_NO_SPOT;
}
