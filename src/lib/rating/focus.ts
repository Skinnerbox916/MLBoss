/** User-set per-category emphasis. Drives the focus map that weights
 *  the rating composite (chase=2, neutral=1, punt=0, renormalised
 *  across the league's scored cats). Consumed by both batter and pitcher
 *  rating engines plus every UI surface that exposes chase/hold/punt. */
export type Focus = 'neutral' | 'chase' | 'punt';
