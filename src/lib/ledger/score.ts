import { and, eq, isNull, lt } from 'drizzle-orm';
import { getDb, forecastSnapshots, playerGameActuals } from '@/lib/db';
import { getPitcherGameLines, getBatterGameLines } from '@/lib/mlb/players';
import { todayEt } from './capture';

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
  for (const p of pending) {
    const entry = byPlayer.get(p.mlbId) ?? { sides: new Set<Side>(), dates: new Set<string>() };
    entry.sides.add(sideOf(p.engine));
    entry.dates.add(p.gameDate);
    byPlayer.set(p.mlbId, entry);
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

  return { pendingPairs: pending.length, playersFetched, rowsWritten, playersSkipped };
}
