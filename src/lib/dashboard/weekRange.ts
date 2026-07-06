/**
 * Yahoo Fantasy Baseball H2H weeks run Mon–Sun. We derive the week's seven
 * dates from "now" client-side rather than reading `week_start` / `week_end`
 * off the scoreboard payload — Yahoo's schema isn't surfaced through our API
 * yet and the Mon–Sun assumption holds for every league we've observed.
 *
 * If we ever encounter a league with a different week pattern, replace this
 * helper with one that reads the actual range off the league settings.
 */

/**
 * Which matchup an analysis / projection describes:
 *   - `'current'` — the matchup containing `now` (Mon..Sun including today).
 *   - `'next'`    — next week's matchup (Mon..Sun starting next Monday).
 *
 * Streaming surfaces flip to `'next'` on Sunday because a pickup made today
 * cannot play in the closing matchup. Everywhere else defaults to `'current'`.
 *
 * Extendable to `'previous'` or absolute week numbers if a historical view
 * is ever needed; the union keeps the names self-documenting at call sites.
 */
import { moveTimingForDeadline } from '@/lib/fantasy/scoringMode';

export type WeekTarget = 'current' | 'next';

export interface WeekDay {
  /** YYYY-MM-DD in local time. */
  date: string;
  /** Day-of-week single-letter label (M, T, W, T, F, S, S). */
  dayLabel: string;
  /** Day-of-week three-letter name (Mon, Tue, ...). */
  dayName: string;
  /** True when the date is today or after. */
  isRemaining: boolean;
  /** True only on the current calendar day. */
  isToday: boolean;
}

const DAY_LABELS: ReadonlyArray<string> = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // indexed by getDay()
const DAY_NAMES: ReadonlyArray<string> = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Single source of truth for the "Sunday rolls forward" rule. Returns true
 * when `now` is a Sunday — the streaming page and any future surface that
 * needs to decide "which matchup is actionable from here" consults this.
 *
 * Changing the rule (e.g. "Sunday after 6pm Eastern" or a per-league
 * configurable cutover) edits exactly one function.
 */
export function isSundayPivot(now: Date = new Date()): boolean {
  return now.getDay() === 0;
}

/**
 * Resolve a `WeekTarget` to its Monday. Used by the per-target day helpers
 * and any caller that needs the start-of-week anchor (route handlers, cache
 * key construction, etc.).
 */
function targetMonday(now: Date, target: WeekTarget): Date {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const offsetToMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(today);
  monday.setDate(monday.getDate() - offsetToMonday);
  if (target === 'next') {
    monday.setDate(monday.getDate() + 7);
  }
  return monday;
}

/**
 * Return the seven days (Mon..Sun) of the matchup week containing `now`.
 *
 * If `now` is a Sunday, that Sunday is treated as the *last* day of the week
 * — not the first day of the next week — because that matches how Yahoo's
 * scoreboard reads on a Sunday: stats are still accruing into the same
 * matchup until midnight Eastern.
 */
export function getMatchupWeekDays(now: Date = new Date()): WeekDay[] {
  return getWeekDays(now, 'current');
}

/**
 * Return next week's seven days (Mon..Sun) — the week *after* the matchup
 * week containing `now`. Every day is `isRemaining=true` and none is
 * `isToday` (today is in the prior week). Used by the Sunday streaming
 * pivot so projection routes can target the upcoming matchup directly.
 */
export function getNextMatchupWeekDays(now: Date = new Date()): WeekDay[] {
  return getWeekDays(now, 'next');
}

/**
 * Generic by-target accessor — the two named helpers above are thin
 * wrappers. Callers that already hold a `WeekTarget` (route handlers,
 * projection orchestrators) can use this directly.
 */
export function getWeekDays(now: Date, target: WeekTarget): WeekDay[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return buildWeek(targetMonday(now, target), ymd(today));
}

/**
 * Helper: build a 7-day WeekDay array starting from a given Monday.
 * `todayYmd` controls the `isToday` / `isRemaining` flags so the same
 * helper works for both current-week and next-week grids.
 */
function buildWeek(monday: Date, todayYmd: string): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dStr = ymd(d);
    days.push({
      date: dStr,
      dayLabel: DAY_LABELS[d.getDay()],
      dayName: DAY_NAMES[d.getDay()],
      isToday: dStr === todayYmd,
      isRemaining: dStr >= todayYmd,
    });
  }
  return days;
}

/** Strict YYYY-MM-DD guard — Yahoo's `edit_key` is a date string for MLB
 *  daily leagues, but type it defensively (it's declared loosely upstream). */
function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * The earliest calendar date a roster add made *now* can first play — the
 * floor of the pickup-playable window. Everything about "when a move hits"
 * flows from this one value.
 *
 * Yahoo's `edit_key` is the earliest roster date the API will currently let
 * you edit; it already folds in the league's roster-change mode AND time-of-
 * day game locks (it rolls to tomorrow once today's games have locked), so
 * it's the authoritative signal. When it's missing/malformed we fall back to
 * the move timing derived from `weekly_deadline`:
 *   immediate → today, next-day → tomorrow, weekly → next Monday.
 * Never returns a date before today.
 */
export function resolveEarliestPlayableDate(opts: {
  now?: Date;
  editKey?: string | null;
  weeklyDeadline?: string | null;
}): string {
  const now = opts.now ?? new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayYmd = ymd(today);

  // edit_key is authoritative when present and not in the past.
  if (isYmd(opts.editKey) && opts.editKey >= todayYmd) return opts.editKey;

  const timing = moveTimingForDeadline(opts.weeklyDeadline);
  if (timing === 'immediate') return todayYmd;
  if (timing === 'weekly') return ymd(targetMonday(now, 'next'));
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return ymd(tomorrow); // next-day
}

/**
 * The app's historical window floor when no per-league signal is supplied: a
 * pickup lands tomorrow, and on Sunday the current matchup is closed so it
 * lands next Monday. Kept so the no-arg calls below behave exactly as before.
 */
function legacyFloor(now: Date): string {
  if (isSundayPivot(now)) return ymd(targetMonday(now, 'next'));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return ymd(tomorrow);
}

/** Which matchup week a pickup landing on `floorYmd` belongs to. */
function weekTargetForFloor(now: Date, floorYmd: string): WeekTarget {
  return floorYmd >= ymd(targetMonday(now, 'next')) ? 'next' : 'current';
}

/**
 * The matchup (`current` | `next`) the streaming page should frame, given the
 * earliest date a pickup can play. Replaces the pure day-of-week Sunday check:
 * a next-day league still pivots on Sunday (floor = next Monday), but an
 * immediate league whose Sunday pickup still plays Sunday stays on `current`.
 * With no floor supplied it reproduces the old `isSundayPivot` behavior.
 */
export function getStreamingWeekTarget(now: Date = new Date(), earliestPlayableDate?: string): WeekTarget {
  return weekTargetForFloor(now, earliestPlayableDate ?? legacyFloor(now));
}

/**
 * Seven-day grid the streaming page should render and fetch game-day data
 * for — the full Mon..Sun of whichever matchup the pickup window lands in.
 * `earliestPlayableDate` (a pickup's floor, typically Yahoo `edit_key`)
 * decides current vs next week; omit it for the legacy Sunday-pivot behavior.
 */
export function getStreamingGridDays(now: Date = new Date(), earliestPlayableDate?: string): WeekDay[] {
  const floor = earliestPlayableDate ?? legacyFloor(now);
  return getWeekDays(now, weekTargetForFloor(now, floor));
}

/**
 * The subset of `getStreamingGridDays` where a pickup made right now CAN
 * actually play — every grid day on or after the window floor.
 *
 *   - immediate league: today (if games remain) through Sunday
 *   - next-day league : tomorrow through Sunday of the current matchup week
 *   - Sunday / weekly : next Mon..Sun in full (the grid itself)
 *
 * With no `earliestPlayableDate` this is the historical "today excluded"
 * behavior (floor = tomorrow, or next Monday on Sunday). Drives FA value
 * calculations and the day-strip render.
 */
export function getPickupPlayableDays(now: Date = new Date(), earliestPlayableDate?: string): WeekDay[] {
  const floor = earliestPlayableDate ?? legacyFloor(now);
  return getStreamingGridDays(now, floor).filter(d => d.date >= floor);
}
