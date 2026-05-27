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
 * A category is conceded when its effective focus is `punt` — i.e. either the
 * user conceded it or the analyzer auto-suggested punt (a decided loss, or
 * transitionally a locked win). Everything else is in-play and weighted by how
 * contested it is via `pivotality(margin)`: a coin-flip cat (margin 0) carries
 * full weight, a near-decided cat far less. This replaces the old flat
 * chase=2 / neutral=1 magnitude — direction and magnitude now come from the
 * margin, not the label.
 *
 * Transitional note: concession is keyed off the existing `Focus` map so the
 * 3-state focus panels keep working until the UI collapse (Phase 5). When that
 * lands, concession becomes an explicit concede/contest override and the
 * decided-win-stays-in-play refinement moves here.
 */
export function buildCategoryWeights(
  analysis: MatchupAnalysis,
  focusMap: Record<number, Focus>,
  predicate?: (statId: number) => boolean,
): Record<number, number> {
  const weights: Record<number, number> = {};
  for (const row of analysis.rows) {
    if (predicate && !predicate(row.statId)) continue;
    weights[row.statId] =
      (focusMap[row.statId] ?? 'neutral') === 'punt' ? 0 : pivotality(row.margin);
  }
  return weights;
}
