/**
 * Game-state helpers.
 *
 * Centralises the "is this game effectively done" predicate that several
 * surfaces need (probable-pitcher day strip, projection route's
 * remaining-IP filter for today's slate, etc.). Keep this file tiny and
 * domain-only — no UI concerns.
 *
 * Upstream MLB Stats API populates the `detailedState` string with one of
 * a handful of values (`Scheduled`, `Pre-Game`, `Warmup`, `In Progress`,
 * `Final`, `Game Over`, `Completed Early`, `Postponed`, `Cancelled`,
 * `Forfeit`, and various `Suspended: <reason>` variants). We treat the
 * `In Progress` family as **not yet concluded** — the SP has begun
 * pitching but their total IP for the day is still uncertain (could
 * be 3 IP if pulled in the 4th, could be 7). The corrected/projection
 * surfaces want to keep counting that exposure as "remaining" until the
 * game is genuinely over.
 */

const CONCLUDED_STATUSES = new Set<string>([
  'Final',
  'Game Over',
  'Completed Early',
  'Postponed',
  'Cancelled',
  'Forfeit',
]);

/**
 * True when the pitcher's scheduled start for this game has either
 * already concluded (game finished or ended early) or won't happen
 * today (postponed / cancelled / suspended). Used by:
 *   - `/api/projection/pitcher-team` to drop today's done games before
 *     summing expectedIp (otherwise a finished 1pm game double-counts
 *     against the cap at 7pm).
 *   - `useWeekProbables` to render today's completed starts faintly /
 *     with a ✓ in the Boss Card day strip.
 *
 * In-progress games are intentionally treated as NOT concluded (the SP
 * may still be pitching, and their total IP for the day is uncertain).
 */
export function isStartConcluded(status: string): boolean {
  if (CONCLUDED_STATUSES.has(status)) return true;
  if (status.startsWith('Suspended')) return true;
  return false;
}
