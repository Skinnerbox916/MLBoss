import { and, eq, gte, inArray, isNull, lt, lte } from 'drizzle-orm';
import { getDb, forecastSnapshots, playerGameActuals } from '@/lib/db';
import { getPitcherGameLines, getBatterGameLines } from '@/lib/mlb/players';
import { addDaysIso, todayEt } from './capture';

/**
 * Actuals materialization — the read side of the grading join.
 *
 * Finds (player, past date) pairs that have snapshots but no actuals row,
 * fetches each player's season game log ONCE (1h-cached upstream), slices
 * it by date, and writes one row per pending date. Doubleheader entries
 * on the same date are summed — a day forecast is graded against the
 * whole day.
 *
 * Idempotent and resumable: rows are only ever inserted (never updated),
 * and anything that fails stays pending for the next run.
 */

type Side = 'pit' | 'bat';

function sideOf(engine: string): Side {
  return engine.includes('batter') ? 'bat' : 'pit';
}

export interface ScoreRunResult {
  /** (player, date) pairs that needed actuals when the run started. */
  pendingPairs: number;
  playersFetched: number;
  rowsWritten: number;
  /** Players skipped this run (empty/failed game-log fetch) — retried next run. */
  playersSkipped: number;
}

function addLine(into: Map<string, Record<string, number>>, date: string, line: object): void {
  const acc = into.get(date) ?? {};
  for (const [k, v] of Object.entries(line as Record<string, unknown>)) {
    if (k === 'date') continue;
    const n = typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : 0;
    // isStart → gs so the stored key reads like a stat line
    const key = k === 'isStart' ? 'gs' : k;
    acc[key] = (acc[key] ?? 0) + n;
  }
  into.set(date, acc);
}

export async function scorePendingActuals(maxPlayers = 300): Promise<ScoreRunResult> {
  const db = getDb();
  const pending = await db
    .selectDistinct({
      mlbId: forecastSnapshots.mlbId,
      gameDate: forecastSnapshots.gameDate,
      engine: forecastSnapshots.engine,
    })
    .from(forecastSnapshots)
    .leftJoin(
      playerGameActuals,
      and(
        eq(playerGameActuals.mlbId, forecastSnapshots.mlbId),
        eq(playerGameActuals.gameDate, forecastSnapshots.gameDate),
      ),
    )
    .where(and(isNull(playerGameActuals.mlbId), lt(forecastSnapshots.gameDate, todayEt())));

  const byPlayer = new Map<number, { sides: Set<Side>; dates: Set<string> }>();
  const need = (mlbId: number, side: Side, date: string) => {
    const entry = byPlayer.get(mlbId) ?? { sides: new Set<Side>(), dates: new Set<string>() };
    entry.sides.add(side);
    entry.dates.add(date);
    byPlayer.set(mlbId, entry);
  };
  for (const p of pending) need(p.mlbId, sideOf(p.engine), p.gameDate);

  // Week-window engines claim a Mon–Sun span keyed by its Monday: expand
  // each COMPLETE window into per-day actuals needs (off days materialize
  // as no_game rows — a legitimate zero inside a week, not a miss).
  const weekPending = await db
    .selectDistinct({ mlbId: forecastSnapshots.mlbId, gameDate: forecastSnapshots.gameDate })
    .from(forecastSnapshots)
    .where(and(
      eq(forecastSnapshots.engine, 'batter-week'),
      lte(forecastSnapshots.gameDate, addDaysIso(todayEt(), -7)),
    ));
  let weekPairs = 0;
  if (weekPending.length > 0) {
    const ids = [...new Set(weekPending.map(p => p.mlbId))];
    const dates = weekPending.map(p => p.gameDate).sort();
    const have = new Set(
      (
        await db
          .select({ mlbId: playerGameActuals.mlbId, gameDate: playerGameActuals.gameDate })
          .from(playerGameActuals)
          .where(and(
            inArray(playerGameActuals.mlbId, ids),
            gte(playerGameActuals.gameDate, dates[0]),
            lte(playerGameActuals.gameDate, addDaysIso(dates[dates.length - 1], 6)),
          ))
      ).map(r => `${r.mlbId}:${r.gameDate}`),
    );
    for (const p of weekPending) {
      for (let d = 0; d < 7; d++) {
        const date = addDaysIso(p.gameDate, d);
        if (have.has(`${p.mlbId}:${date}`)) continue;
        need(p.mlbId, 'bat', date);
        weekPairs++;
      }
    }
  }

  let playersFetched = 0;
  let rowsWritten = 0;
  let playersSkipped = 0;

  for (const [mlbId, need] of [...byPlayer.entries()].slice(0, maxPlayers)) {
    const seasons = [...new Set([...need.dates].map(d => Number(d.slice(0, 4))))];
    try {
      const pitByDate = new Map<string, Record<string, number>>();
      const batByDate = new Map<string, Record<string, number>>();

      if (need.sides.has('pit')) {
        const lines = (await Promise.all(seasons.map(s => getPitcherGameLines(mlbId, s)))).flat();
        // An empty log for a player we forecast starts for almost always
        // means the fetch failed, not that he never pitched — writing
        // no_game rows off it would poison the ledger permanently.
        if (lines.length === 0) throw new Error('empty pitching game log');
        for (const l of lines) addLine(pitByDate, l.date, l);
      }
      if (need.sides.has('bat')) {
        const lines = (await Promise.all(seasons.map(s => getBatterGameLines(mlbId, s)))).flat();
        if (lines.length === 0) throw new Error('empty batting game log');
        for (const l of lines) addLine(batByDate, l.date, l);
      }

      playersFetched++;
      const rows = [...need.dates].map(date => {
        const pitching = need.sides.has('pit') ? (pitByDate.get(date) ?? null) : null;
        const batting = need.sides.has('bat') ? (batByDate.get(date) ?? null) : null;
        return {
          gameDate: date,
          mlbId,
          status: (pitching || batting ? 'played' : 'no_game') as 'played' | 'no_game',
          pitching,
          batting,
        };
      });
      const inserted = await db
        .insert(playerGameActuals)
        .values(rows)
        .onConflictDoNothing()
        .returning({ mlbId: playerGameActuals.mlbId });
      rowsWritten += inserted.length;
    } catch (err) {
      playersSkipped++;
      console.error(`[ledger] actuals fetch skipped for mlbId=${mlbId}:`, err);
    }
  }

  return { pendingPairs: pending.length + weekPairs, playersFetched, rowsWritten, playersSkipped };
}
