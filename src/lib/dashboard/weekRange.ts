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

/**
 * Seven-day grid the streaming page should render and fetch game-day data
 * for. On Sunday this rolls forward to next Mon..Sun (per `isSundayPivot`)
 * because pickups made on a Sunday won't play until next Monday — the
 * current matchup is effectively closed for streaming purposes. Mon..Sat
 * returns the current matchup week (same as `getMatchupWeekDays`).
 */
export function getStreamingGridDays(now: Date = new Date()): WeekDay[] {
  return getWeekDays(now, isSundayPivot(now) ? 'next' : 'current');
}

/**
 * The subset of `getStreamingGridDays` where a pickup made right now CAN
 * actually play. A streamer added today doesn't enter a roster until the
 * next calendar day, so today is always excluded.
 *
 *   - Mon..Sat: tomorrow through Sunday of the current matchup week
 *   - Sunday  : next Mon..Sun in full (the grid itself)
 *
 * This drives FA value calculations and the day-strip render on the
 * streaming page, where "today" is misleading: the user can't act on it.
 */
export function getPickupPlayableDays(now: Date = new Date()): WeekDay[] {
  const grid = getStreamingGridDays(now);
  if (isSundayPivot(now)) return grid; // grid is already next Mon..Sun
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowYmd = ymd(tomorrow);
  return grid.filter(d => d.date >= tomorrowYmd);
}
