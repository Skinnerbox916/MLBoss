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

/**
 * When does a roster add/drop made *now* first take effect? Yahoo's three
 * roster-change modes, keyed off `weekly_deadline` (verified against a live
 * next-day and immediate league — see docs/yahoo-api-reference.md#roster-change-timing):
 *
 *   - `'intraday'`     → **immediate** (Daily-Today): players lock at their
 *                        own game time; a pickup can play in today's not-yet-
 *                        started games.
 *   - `''` / undefined → **next-day** (Daily-Tomorrow): the nightly 11:59pm PT
 *                        deadline; today's roster is locked, a pickup plays
 *                        tomorrow. This is the app's historical assumption, so
 *                        an unknown value defaults here (conservative).
 *   - day number (`'1'`…) → **weekly**: the whole lineup locks for the week;
 *                        a pickup can't play until next week.
 *
 * `edit_key` (the earliest roster date the API will currently let you edit) is
 * the authoritative *date* — this enum is for labeling and as the fallback
 * when `edit_key` is unavailable. See `resolveEarliestPlayableDate`.
 */
export type RosterMoveTiming = 'immediate' | 'next-day' | 'weekly';

export function moveTimingForDeadline(weeklyDeadline: string | undefined | null): RosterMoveTiming {
  if (weeklyDeadline === 'intraday') return 'immediate';
  if (!weeklyDeadline) return 'next-day'; // '' or undefined
  return 'weekly';
}
