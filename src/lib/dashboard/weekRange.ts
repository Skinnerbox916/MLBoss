/**
 * Yahoo Fantasy Baseball H2H weeks run Mon–Sun. We derive the week's seven
 * dates from "now" client-side rather than reading `week_start` / `week_end`
 * off the scoreboard payload — Yahoo's schema isn't surfaced through our API
 * yet and the Mon–Sun assumption holds for every league we've observed.
 *
 * If we ever encounter a league with a different week pattern, replace this
 * helper with one that reads the actual range off the league settings.
 */

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
 * Return the seven days (Mon..Sun) of the matchup week containing `now`.
 *
 * If `now` is a Sunday, that Sunday is treated as the *last* day of the week
 * — not the first day of the next week — because that matches how Yahoo's
 * scoreboard reads on a Sunday: stats are still accruing into the same
 * matchup until midnight Eastern.
 */
export function getMatchupWeekDays(now: Date = new Date()): WeekDay[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayYmd = ymd(today);

  // JS getDay(): 0 = Sun, 1 = Mon, ... 6 = Sat.
  // We want offset to Monday: Mon -> 0, Tue -> 1, ... Sun -> 6.
  const dow = today.getDay();
  const offsetToMonday = dow === 0 ? 6 : dow - 1;

  const monday = new Date(today);
  monday.setDate(monday.getDate() - offsetToMonday);

  return buildWeek(monday, todayYmd);
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
 * for. On Sunday this rolls forward to next Mon..Sun because pickups made
 * on a Sunday won't play until next Monday — the current matchup is
 * effectively closed for streaming purposes. Mon..Sat returns the current
 * matchup week (same as `getMatchupWeekDays`).
 */
export function getStreamingGridDays(now: Date = new Date()): WeekDay[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayYmd = ymd(today);

  if (today.getDay() === 0) {
    // Sunday → grid is next Mon..Sun. `isToday` will be false on every
    // day of the grid (today is one day before the grid starts), and
    // `isRemaining` will be true on every day (all dates > today).
    const nextMonday = new Date(today);
    nextMonday.setDate(nextMonday.getDate() + 1);
    return buildWeek(nextMonday, todayYmd);
  }
  return getMatchupWeekDays(now);
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
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const grid = getStreamingGridDays(now);
  if (today.getDay() === 0) {
    // Sunday — the grid is already next Mon..Sun, all playable.
    return grid;
  }
  // Mon..Sat — drop today.
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowYmd = ymd(tomorrow);
  return grid.filter(d => d.date >= tomorrowYmd);
}
