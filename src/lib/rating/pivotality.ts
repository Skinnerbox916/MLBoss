/**
 * Pivotality — the in-play weighting gradient shared by the matchup (L5)
 * and roster (L6) layers. See docs/pivotality-migration.md.
 *
 * A Gaussian on a competitive `distance ∈ [−1, +1]`: peaks at 0 (a
 * coin-flip is maximally worth fighting for) and decays symmetrically, so
 * a locked win and an out-of-reach loss both fall near zero on their own.
 * Direction-blind by design — direction is handled by the sign of each
 * play's production effect and by sign-aware *presentation* at the
 * extremes (decided win vs. conceded loss), never by this weight.
 *
 * This pure function is the ONLY thing the two layers share. Each layer
 * produces its own `distance` (L5: matchup margin; L6: RUPM moves-to-a-
 * winning-rank) — never feed one layer's distance into the other.
 */

/** Default gradient width. See docs/pivotality-migration.md#calibration-constants. */
export const PIVOTALITY_W = 0.35;

/**
 * @param distance competitive distance in [−1, +1]; 0 = coin-flip.
 * @param w        gradient width (how fast a cat stops mattering as it
 *                 gets decided). Defaults to `PIVOTALITY_W`.
 * @returns weight in (0, 1]; 1 at distance 0, decaying symmetrically.
 */
export function pivotality(distance: number, w: number = PIVOTALITY_W): number {
  return Math.exp(-(distance * distance) / (2 * w * w));
}
