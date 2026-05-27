/** User-set per-category emphasis. Drives the focus map that weights
 *  the rating composite (chase=2, neutral=1, punt=0, renormalised
 *  across the league's scored cats). Consumed by both batter and pitcher
 *  rating engines plus every UI surface that exposes chase/hold/punt. */
export type Focus = 'neutral' | 'chase' | 'punt';

/**
 * Pre-renormalization weight each focus state contributes. The rating
 * engines renormalize across non-zero cats, so only the ratios matter.
 */
const FOCUS_WEIGHT: Record<Focus, number> = { chase: 2, neutral: 1, punt: 0 };

/**
 * Bridge a chase/hold/punt focus map onto the numeric `categoryWeights`
 * the rating engines now consume. Transitional: this exists so the engine
 * substrate can be numeric (Phase 2 of the pivotality migration) while the
 * UI still produces focus maps. Once weight production moves to pivotality
 * (Phase 3, `buildCategoryWeights`), call sites pass weights directly and
 * this bridge — along with the `Focus` union — goes away.
 * See docs/pivotality-migration.md.
 */
export function focusToCategoryWeights(
  focusMap: Record<number, Focus>,
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [id, f] of Object.entries(focusMap)) {
    out[Number(id)] = FOCUS_WEIGHT[f];
  }
  return out;
}
