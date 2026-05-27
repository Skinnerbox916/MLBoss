import { pivotality } from '@/lib/rating/pivotality';
import type { Focus } from '@/lib/rating/focus';
import type { MatchupAnalysis } from './analysis';

/**
 * Phase 3 of the pivotality migration: produce the numeric `categoryWeights`
 * the rating engines consume, from a matchup analysis + the page's effective
 * focus state. See docs/pivotality-migration.md.
 *
 *   weight(cat) = conceded ? 0 : pivotality(margin)
 *
 * A category is conceded (weight 0) only when it is punted **and losing** — a
 * decided/contested loss we give up on. A **decided win** (punted but `margin >
 * 0`, i.e. a locked lead) stays *in-play*, weighted by `pivotality(margin)`:
 * small, but never zero. This matters — when every category is a locked win,
 * conceding them all would zero the whole vector and collapse the composite to
 * the neutral 50 (which is exactly the bug the pitcher board surfaced). Keeping
 * decided wins in-play lets the composite still rank players on overall quality.
 *
 * Everything not conceded is weighted by how contested it is via
 * `pivotality(margin)`: a coin-flip cat (margin 0) carries full weight, a
 * near-decided cat far less. Direction and magnitude come from the margin, not
 * the label — this replaces the old flat chase=2 / neutral=1.
 *
 * Transitional note: concession is keyed off the existing `Focus` map + margin
 * sign so the 3-state focus panels keep working until the UI collapse (Phase
 * 5), when concession becomes an explicit concede/contest override.
 */
export function buildCategoryWeights(
  analysis: MatchupAnalysis,
  focusMap: Record<number, Focus>,
  predicate?: (statId: number) => boolean,
): Record<number, number> {
  const weights: Record<number, number> = {};
  for (const row of analysis.rows) {
    if (predicate && !predicate(row.statId)) continue;
    const conceded = (focusMap[row.statId] ?? 'neutral') === 'punt' && row.margin <= 0;
    weights[row.statId] = conceded ? 0 : pivotality(row.margin);
  }
  return weights;
}
