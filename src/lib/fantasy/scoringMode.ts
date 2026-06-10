/**
 * Pure, client-safe scoring-mode helpers — NO server imports.
 *
 * Split out of `scoringProfile.ts` so client components (LeagueSwitcher,
 * useActiveLeague) can map a Yahoo `scoring_type` to an engine family without
 * pulling the server-only `YahooFantasyAPI` (→ `next/headers`) into the client
 * bundle. `scoringProfile.ts` re-uses these for the full resolver.
 *
 * Yahoo `scoring_type` taxonomy (MLB):
 *   'head'      → Head-to-Head Categories
 *   'roto'      → Rotisserie (season-long categories)
 *   'headpoint' → Head-to-Head Points
 *   'point'     → Points (season-long cumulative)
 */

export type ScoringMode = 'categories' | 'points';

export const POINTS_SCORING_TYPES = new Set(['point', 'points', 'headpoint']);
export const HEAD_TO_HEAD_SCORING_TYPES = new Set(['head', 'headpoint']);

/** Map a Yahoo `scoring_type` to the engine family. No fetch — lets the
 *  client pick points vs categories UI from the league list alone. */
export function scoringModeForType(scoringType: string | undefined | null): ScoringMode {
  return scoringType && POINTS_SCORING_TYPES.has(scoringType) ? 'points' : 'categories';
}
