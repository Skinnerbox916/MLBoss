/**
 * Matchup-week date windows.
 *
 * Yahoo H2H matchup weeks are USUALLY Mon–Sun, but not always: the season's
 * first week is short, and Yahoo merges the two all-star-break weeks into one
 * ~14-day matchup (2026 week 17 ran Jul 13–26). The authoritative per-week
 * date ranges come from Yahoo's `game_weeks` resource, surfaced to consumers
 * as a `WeekBounds` value (client: league context fields via
 * `useLeagueWeekBounds`; server: `getWeekBounds` in `@/lib/fantasy`).
 *
 * Every helper here takes an optional `bounds`. With bounds, windows follow
 * Yahoo's real calendar; without (context still loading, or the calendar
 * fetch failed), they fall back to the historical local Mon–Sun derivation so
 * nothing breaks during first paint.
 */
import { moveTimingForDeadline } from '@/lib/fantasy/scoringMode';

export type WeekTarget = 'current' | 'next';

/**
 * The real date span of the current matchup week (and the next one), sourced
 * from Yahoo's `game_weeks` calendar. `nextStart`/`nextEnd` are `null` on the
 * season's final week — there is no next matchup to stream toward.
 */
export interface WeekBounds {
  /** Yahoo week number of the current matchup week. */
  week?: number;
  /** First date (YYYY-MM-DD) of the current matchup week. */
  start: string;
  /** Last date (YYYY-MM-DD, inclusive) of the current matchup week. */
  end: string;
  /** First/last date of the following matchup week; null on the final week. */
  nextStart?: string | null;
  nextEnd?: string | null;
}

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

/** Hard cap on a single matchup week's length. Yahoo's longest observed week
 *  (the combined all-star week) is 14 days; 21 guards against a malformed
 *  calendar entry producing an unbounded loop. */
const MAX_WEEK_DAYS = 21;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Strict YYYY-MM-DD guard — Yahoo's date fields are date strings for MLB
 *  daily leagues, but type them defensively (declared loosely upstream). */
function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Bounds are only usable when both current-week dates are well-formed. */
function hasUsableBounds(bounds?: WeekBounds): bounds is WeekBounds {
  return !!bounds && isYmd(bounds.start) && isYmd(bounds.end) && bounds.start <= bounds.end;
}

/** The next-week range off a bounds value, or null when terminal/absent. */
function nextRange(bounds: WeekBounds): { start: string; end: string } | null {
  if (isYmd(bounds.nextStart) && isYmd(bounds.nextEnd) && bounds.nextStart <= bounds.nextEnd) {
    return { start: bounds.nextStart, end: bounds.nextEnd };
  }
  return null;
}

/**
 * Resolve a `WeekTarget` to its real date range. With bounds, this is Yahoo's
 * calendar; `'next'` returns null on the season's final week (no next
 * matchup exists — callers render an empty window). Without bounds, the
 * legacy local Mon–Sun derivation.
 */
function targetRange(
  now: Date,
  target: WeekTarget,
  bounds?: WeekBounds,
): { start: string; end: string } | null {
  if (hasUsableBounds(bounds)) {
    if (target === 'current') return { start: bounds.start, end: bounds.end };
    return nextRange(bounds);
  }
  const monday = targetMonday(now, target);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: ymd(monday), end: ymd(sunday) };
}

/**
 * Legacy fallback: resolve a `WeekTarget` to its Monday assuming Mon–Sun
 * weeks. Only used when no `WeekBounds` is available.
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
 * Return every day of the matchup week containing `now` — 7 entries for a
 * normal week, up to 14 for a combined week (all-star break) when real
 * bounds are supplied.
 *
 * The last day of the week is treated as still *inside* the week — stats
 * accrue into the matchup until midnight — matching how Yahoo's scoreboard
 * reads on a closing day.
 */
export function getMatchupWeekDays(now: Date = new Date(), bounds?: WeekBounds): WeekDay[] {
  return getWeekDays(now, 'current', bounds);
}

/**
 * Return next week's days — the week *after* the matchup week containing
 * `now`. Every day is `isRemaining=true` and none is `isToday` (today is in
 * the prior week). Used by the end-of-week streaming pivot so projection
 * routes can target the upcoming matchup directly. Empty on the season's
 * final week when bounds are supplied (no next matchup exists).
 */
export function getNextMatchupWeekDays(now: Date = new Date(), bounds?: WeekBounds): WeekDay[] {
  return getWeekDays(now, 'next', bounds);
}

/**
 * Generic by-target accessor — the two named helpers above are thin
 * wrappers. Callers that already hold a `WeekTarget` (route handlers,
 * projection orchestrators) can use this directly.
 */
export function getWeekDays(now: Date, target: WeekTarget, bounds?: WeekBounds): WeekDay[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const range = targetRange(now, target, bounds);
  if (!range) return [];
  return buildRange(range.start, range.end, ymd(today));
}

/**
 * Build the WeekDay array for an inclusive date range. `todayYmd` controls
 * the `isToday` / `isRemaining` flags so the same helper works for both
 * current-week and next-week grids.
 */
function buildRange(startYmd: string, endYmd: string, todayYmd: string): WeekDay[] {
  const days: WeekDay[] = [];
  const cursor = parseYmd(startYmd);
  for (let i = 0; i < MAX_WEEK_DAYS; i++) {
    const dStr = ymd(cursor);
    if (dStr > endYmd) break;
    days.push({
      date: dStr,
      dayLabel: DAY_LABELS[cursor.getDay()],
      dayName: DAY_NAMES[cursor.getDay()],
      isToday: dStr === todayYmd,
      isRemaining: dStr >= todayYmd,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Compact display label for a matchup week — "Wk 17 · 7/13–7/26". Undefined
 * without usable bounds (callers render nothing rather than a wrong range).
 * `target: 'next'` labels the following week; undefined on the final week.
 */
export function weekRangeLabel(
  bounds: WeekBounds | undefined,
  target: WeekTarget = 'current',
): string | undefined {
  if (!hasUsableBounds(bounds)) return undefined;
  const range = target === 'current' ? { start: bounds.start, end: bounds.end } : nextRange(bounds);
  if (!range) return undefined;
  const fmt = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  const weekNum =
    target === 'current' ? bounds.week
    : bounds.week !== undefined ? bounds.week + 1
    : undefined;
  const dates = `${fmt(range.start)}–${fmt(range.end)}`;
  return weekNum !== undefined ? `Wk ${weekNum} · ${dates}` : dates;
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
 *   immediate → today, next-day → tomorrow, weekly → next week's first day
 *   (real calendar via `bounds`, else next Monday).
 * Never returns a date before today.
 */
export function resolveEarliestPlayableDate(opts: {
  now?: Date;
  editKey?: string | null;
  weeklyDeadline?: string | null;
  bounds?: WeekBounds;
}): string {
  const now = opts.now ?? new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayYmd = ymd(today);

  // edit_key is authoritative when present and not in the past.
  if (isYmd(opts.editKey) && opts.editKey >= todayYmd) return opts.editKey;

  const timing = moveTimingForDeadline(opts.weeklyDeadline);
  if (timing === 'immediate') return todayYmd;
  if (timing === 'weekly') {
    const next = hasUsableBounds(opts.bounds) ? nextRange(opts.bounds) : null;
    if (next && next.start >= todayYmd) return next.start;
    return ymd(targetMonday(now, 'next'));
  }
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return ymd(tomorrow); // next-day
}

/**
 * The app's historical window floor when no per-league signal is supplied: a
 * pickup lands tomorrow, and on the week's closing day the current matchup is
 * effectively done so it lands on the next week's first day. With bounds the
 * closing day is Yahoo's real `week_end`; without, Sunday.
 */
function legacyFloor(now: Date, bounds?: WeekBounds): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayYmd = ymd(today);

  if (hasUsableBounds(bounds)) {
    if (todayYmd >= bounds.end) {
      const next = nextRange(bounds);
      if (next && next.start > todayYmd) return next.start;
    }
  } else if (today.getDay() === 0) {
    // Legacy Sunday pivot: Sunday is the last day of a Mon–Sun week.
    return ymd(targetMonday(now, 'next'));
  }
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return ymd(tomorrow);
}

/** Which matchup week a pickup landing on `floorYmd` belongs to. */
function weekTargetForFloor(now: Date, floorYmd: string, bounds?: WeekBounds): WeekTarget {
  if (hasUsableBounds(bounds)) {
    // A floor past the current week's real last day lands next week. On the
    // season's final week there is no next matchup — stay on 'current' (the
    // window just runs dry).
    return floorYmd > bounds.end && nextRange(bounds) !== null ? 'next' : 'current';
  }
  return floorYmd >= ymd(targetMonday(now, 'next')) ? 'next' : 'current';
}

/**
 * The matchup (`current` | `next`) the streaming page should frame, given the
 * earliest date a pickup can play. A next-day league pivots on the week's
 * closing day (floor = next week's first day), but an immediate league whose
 * closing-day pickup still plays that day stays on `current`. With real
 * bounds, mid-week Sundays inside a combined week do NOT pivot — only a floor
 * past Yahoo's `week_end` does.
 */
export function getStreamingWeekTarget(
  now: Date = new Date(),
  earliestPlayableDate?: string,
  bounds?: WeekBounds,
): WeekTarget {
  return weekTargetForFloor(now, earliestPlayableDate ?? legacyFloor(now, bounds), bounds);
}

/**
 * The full day grid the streaming page should render and fetch game-day data
 * for — every day of whichever matchup the pickup window lands in (7 for a
 * normal week, up to 14 for a combined week). `earliestPlayableDate` (a
 * pickup's floor, typically Yahoo `edit_key`) decides current vs next week.
 */
export function getStreamingGridDays(
  now: Date = new Date(),
  earliestPlayableDate?: string,
  bounds?: WeekBounds,
): WeekDay[] {
  const floor = earliestPlayableDate ?? legacyFloor(now, bounds);
  return getWeekDays(now, weekTargetForFloor(now, floor, bounds), bounds);
}

/**
 * The subset of `getStreamingGridDays` where a pickup made right now CAN
 * actually play — every grid day on or after the window floor.
 *
 *   - immediate league: today (if games remain) through the week's last day
 *   - next-day league : tomorrow through the week's last day
 *   - closing day / weekly : the next matchup week in full (the grid itself)
 *
 * With no `earliestPlayableDate` this is the historical "today excluded"
 * behavior (floor = tomorrow, or the next week's first day on the closing
 * day). Drives FA value calculations and the day-strip render.
 */
export function getPickupPlayableDays(
  now: Date = new Date(),
  earliestPlayableDate?: string,
  bounds?: WeekBounds,
): WeekDay[] {
  const floor = earliestPlayableDate ?? legacyFloor(now, bounds);
  return getStreamingGridDays(now, floor, bounds).filter(d => d.date >= floor);
}
