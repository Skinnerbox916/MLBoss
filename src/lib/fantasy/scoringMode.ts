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

export type LineupCadence = 'daily' | 'weekly';

/**
 * Map Yahoo's league `weekly_deadline` to a lineup cadence. Yahoo reports
 * `'intraday'` (or empty) for daily-lineup leagues and a day value (e.g. `'1'`
 * = Monday) for leagues whose lineups lock for the whole week. Weekly cadence
 * flips every points decision horizon to NEXT week — pickups and lineup
 * changes can't take effect mid-week.
 */
export function lineupCadenceForDeadline(weeklyDeadline: string | undefined | null): LineupCadence {
  if (!weeklyDeadline || weeklyDeadline === 'intraday') return 'daily';
  return 'weekly';
}
