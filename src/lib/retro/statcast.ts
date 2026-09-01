/**
 * Retro corpus — Statcast pitch-event puller.
 *
 * Pulls one game date of raw pitch events from Baseball Savant's
 * `statcast_search/csv` export and ingests them into `statcast_events`
 * (schema: src/lib/db/schema.ts). This is the source the season-leaderboard
 * inputs (`src/lib/mlb/savant.ts`) are built from; having the events lets
 * the retro pipeline recompute those inputs *as of any date* — the piece a
 * season leaderboard can never give back. Idempotent: re-pulling a date is
 * a no-op on conflict.
 *
 * Not imported by engine code. See docs/forecast-verification.md (retro).
 */

import { sql } from 'drizzle-orm';
import { getDb, statcastEvents } from '@/lib/db';
import { externalFetchText } from '@/lib/mlb/client';

const SAVANT_BASE = 'https://baseballsavant.mlb.com';

/** Every column we ingest; pull aborts loudly if the export drops one. */
const REQUIRED_COLUMNS = [
  'game_pk', 'game_date', 'at_bat_number', 'pitch_number', 'inning', 'inning_topbot',
  'batter', 'pitcher', 'stand', 'p_throws', 'home_team', 'away_team', 'pitch_type',
  'release_speed', 'description', 'events', 'bb_type', 'launch_speed', 'launch_angle',
  'launch_speed_angle', 'estimated_ba_using_speedangle', 'estimated_woba_using_speedangle',
  'estimated_slg_using_speedangle', 'woba_value', 'woba_denom', 'babip_value', 'iso_value',
  'balls', 'strikes', 'outs_when_up',
] as const;

export function statcastSearchUrl(gameDate: string): string {
  const season = gameDate.slice(0, 4);
  const q = new URLSearchParams({
    all: 'true', hfGT: 'R|', hfSea: `${season}|`, player_type: 'batter',
    game_date_gt: gameDate, game_date_lt: gameDate,
    min_pitches: '0', min_results: '0', group_by: 'name', sort_col: 'pitches',
    player_event_sort: 'api_p_release_speed', sort_order: 'desc', min_pas: '0', type: 'details',
  });
  return `${SAVANT_BASE}/statcast_search/csv?${q.toString()}`;
}

/** RFC 4180 parser (quoted fields, embedded commas/quotes/newlines). Savant
 *  quotes every value and play descriptions contain commas. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const num = (v: string | undefined): number | null => {
  if (v == null || v === '' || v === 'null') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: string | undefined): number | null => {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
};
const str = (v: string | undefined): string | null => (v == null || v === '' || v === 'null' ? null : v);

export type StatcastEventInsert = typeof statcastEvents.$inferInsert;

export function toEventRow(r: Record<string, string>): StatcastEventInsert | null {
  const gamePk = int(r.game_pk); const atBat = int(r.at_bat_number); const pitchNo = int(r.pitch_number);
  const batter = int(r.batter); const pitcher = int(r.pitcher);
  if (gamePk == null || atBat == null || pitchNo == null || batter == null || pitcher == null || !r.game_date) return null;
  return {
    gamePk, gameDate: r.game_date, atBatNumber: atBat, pitchNumber: pitchNo,
    inning: int(r.inning), inningTopbot: str(r.inning_topbot),
    batter, pitcher, stand: str(r.stand), pThrows: str(r.p_throws),
    homeTeam: str(r.home_team), awayTeam: str(r.away_team),
    pitchType: str(r.pitch_type), releaseSpeed: num(r.release_speed),
    description: str(r.description), events: str(r.events), bbType: str(r.bb_type),
    launchSpeed: num(r.launch_speed), launchAngle: num(r.launch_angle), launchSpeedAngle: int(r.launch_speed_angle),
    estBa: num(r.estimated_ba_using_speedangle), estWoba: num(r.estimated_woba_using_speedangle),
    estSlg: num(r.estimated_slg_using_speedangle),
    wobaValue: num(r.woba_value), wobaDenom: num(r.woba_denom), babipValue: num(r.babip_value), isoValue: num(r.iso_value),
    balls: int(r.balls), strikes: int(r.strikes), outsWhenUp: int(r.outs_when_up),
  };
}

export interface PullResult {
  gameDate: string;
  csvBytes: number;
  parsedRows: number;
  /** Rows dropped for a missing identity column (should be 0). */
  skipped: number;
  inserted: number;
  games: number;
  plateAppearances: number;
}

/** Pull + ingest one game date. */
export async function pullStatcastDay(gameDate: string): Promise<PullResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) throw new Error(`bad date: ${gameDate}`);
  const csv = await externalFetchText(statcastSearchUrl(gameDate), { accept: 'text/csv', retries: 2 });
  const records = parseCsv(csv);
  if (records.length > 0) {
    const missing = REQUIRED_COLUMNS.filter(c => !(c in records[0]));
    if (missing.length) throw new Error(`Savant export is missing columns: ${missing.join(', ')}`);
  }
  const rows: StatcastEventInsert[] = [];
  let skipped = 0;
  for (const rec of records) {
    if (rec.game_date !== gameDate) continue; // defensive: server-side filter is inclusive
    const row = toEventRow(rec);
    if (row) rows.push(row); else skipped++;
  }
  const db = getDb();
  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await db.insert(statcastEvents).values(rows.slice(i, i + BATCH)).onConflictDoNothing()
      .returning({ pk: statcastEvents.gamePk });
    inserted += res.length;
  }
  return {
    gameDate, csvBytes: csv.length, parsedRows: records.length, skipped, inserted,
    games: new Set(rows.map(r => r.gamePk)).size,
    plateAppearances: rows.filter(r => r.events != null).length,
  };
}

/** Per-game batting totals from the ingested events — for reconciling a
 *  pull against MLB box scores. `pa` counts PA-ending pitches. */
export async function eventGameTotals(gameDate: string): Promise<
  { gamePk: number; pa: number; k: number; bb: number; hr: number; h: number; pitches: number }[]
> {
  const db = getDb();
  const rows = await db.execute(sql`
    select game_pk,
      count(*)::int as pitches,
      count(*) filter (where events is not null)::int as pa,
      count(*) filter (where events in ('strikeout','strikeout_double_play'))::int as k,
      count(*) filter (where events in ('walk','intent_walk'))::int as bb,
      count(*) filter (where events = 'home_run')::int as hr,
      count(*) filter (where events in ('single','double','triple','home_run'))::int as h
    from statcast_events where game_date = ${gameDate} group by game_pk order by game_pk`);
  return (rows.rows as Record<string, number>[]).map(r => ({
    gamePk: Number(r.game_pk), pitches: Number(r.pitches), pa: Number(r.pa), k: Number(r.k),
    bb: Number(r.bb), hr: Number(r.hr), h: Number(r.h),
  }));
}
