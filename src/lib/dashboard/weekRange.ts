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
