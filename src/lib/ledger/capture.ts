import { getDb, forecastSnapshots } from '@/lib/db';
import { buildGameForecast } from '@/lib/pitching/forecast';
import { getTeamOffense } from '@/lib/mlb/teams';
import type { EnrichedGame } from '@/lib/mlb/types';
import type { PointsStreamingAnalysis } from '@/lib/points/streaming';
import { MODEL_VERSION } from './modelVersion';

/**
 * Forecast capture — the write side of the ledger.
 *
 * A snapshot freezes what an engine predicted BEFORE the outcome exists;
 * rows are immutable and first-write-wins per identity (the DB unique
 * index is the guard). Captures are fire-and-forget from request paths:
 * they must never slow down or fail a page.
 *
 * Engines snapshotted here call the same canonical L1/L2 primitives the
 * product surfaces use — capture never re-implements forecast math.
 */

export type ForecastEngine = 'pitcher-start' | 'points-pitcher-start' | 'points-batter-day';

export interface SnapshotRow {
  gameDate: string; // YYYY-MM-DD
  engine: ForecastEngine;
  mlbId: number;
  playerName: string;
  leagueKey?: string;
  predicted: Record<string, number>;
  context: Record<string, unknown>;
}

/** Today's date in ET — MLB game dates are ET-anchored. */
export function todayEt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/** Whole days between ET-today and a game date (0 = day-of, negative → past). */
export function leadDaysFor(gameDate: string): number {
  const ms = Date.parse(`${gameDate}T00:00:00Z`) - Date.parse(`${todayEt()}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export async function insertSnapshots(rows: SnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const lead = new Map(rows.map(r => [r.gameDate, leadDaysFor(r.gameDate)]));
  // Past games can't be forecast — a "snapshot" written after the fact
  // would poison the ledger with hindsight.
  const valid = rows.filter(r => (lead.get(r.gameDate) ?? -1) >= 0);
  if (valid.length === 0) return 0;
  const inserted = await getDb()
    .insert(forecastSnapshots)
    .values(
      valid.map(r => ({
        gameDate: r.gameDate,
        engine: r.engine,
        mlbId: r.mlbId,
        playerName: r.playerName,
        leagueKey: r.leagueKey ?? '',
        leadDays: lead.get(r.gameDate)!,
        predicted: r.predicted,
        context: r.context,
        modelVersion: MODEL_VERSION,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: forecastSnapshots.id });
  return inserted.length;
}

// ---------------------------------------------------------------------------
// Engine: pitcher-start — every probable starter on a slate, league-free
// ---------------------------------------------------------------------------

/** Game statuses it's still honest to forecast from. Anything in-progress
 *  or finished is information leakage, not a prediction. */
const PREGAME_STATUSES = new Set(['Scheduled', 'Pre-Game', 'Warmup', 'Delayed Start']);

/**
 * Snapshot the L2 game forecast (`buildGameForecast`) for every talent-
 * stamped probable on the slate. League-independent raw stat lines —
 * this is the engine-bias workhorse: ~15–30 starts captured per day.
 */
export async function capturePitcherSlate(
  gameDate: string,
  games: EnrichedGame[],
): Promise<number> {
  const rows: SnapshotRow[] = [];
  for (const game of games) {
    if (!PREGAME_STATUSES.has(game.status)) continue;
    for (const isHome of [true, false]) {
      const pp = isHome ? game.homeProbablePitcher : game.awayProbablePitcher;
      if (!pp?.talent || !pp.mlbId) continue;
      const oppTeam = isHome ? game.awayTeam : game.homeTeam;
      const opposing = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;
      const forecast = buildGameForecast({
        pitcher: pp.talent,
        game,
        isHome,
        opposingOffense: await getTeamOffense(oppTeam.mlbId),
        opposingPitcher: opposing?.talent ?? null,
      });
      const g = forecast.expectedPerGame;
      rows.push({
        gameDate,
        engine: 'pitcher-start',
        mlbId: pp.mlbId,
        playerName: pp.name,
        predicted: {
          ip: g.ip, pa: g.pa, k: g.k, bb: g.bb, er: g.er, h: g.h, hr: g.hr,
          qs: forecast.probabilities.qs,
          w: forecast.probabilities.w,
          era: forecast.expectedERA,
          xwoba: forecast.xwobaAllowed,
        },
        context: {
          opponentTeamId: oppTeam.mlbId,
          opponentAbbr: oppTeam.abbreviation,
          isHome,
          venue: game.venue.name,
          parkKnown: game.park !== null,
          oppPitcherKnown: opposing?.talent != null,
        },
      });
    }
  }
  return insertSnapshots(rows);
}

// ---------------------------------------------------------------------------
// Fire-and-forget wrappers for request-path write-through
// ---------------------------------------------------------------------------

// Per-process memo so hot pages don't re-attempt inserts on every request.
// Not a correctness guard (the DB unique index is) — just skips redundant
// work until the process restarts or the lead-day rolls over.
const attempted = new Set<string>();

function inBackground(memoKey: string, run: () => Promise<number>): void {
  if (attempted.has(memoKey)) return;
  attempted.add(memoKey);
  void run().catch(err => {
    attempted.delete(memoKey); // let a later request retry a failed capture
    console.error(`[ledger] capture failed (${memoKey}):`, err);
  });
}

export function capturePitcherSlateInBackground(gameDate: string, games: EnrichedGame[]): void {
  const lead = leadDaysFor(gameDate);
  if (lead < 0) return;
  inBackground(`pitcher-start:${gameDate}:${lead}`, () => capturePitcherSlate(gameDate, games));
}

// ---------------------------------------------------------------------------
// Engines: points-pitcher-start / points-batter-day — write-through from
// the already-computed points streaming analysis (server-ranked)
// ---------------------------------------------------------------------------

/**
 * Map a computed points streaming analysis to snapshot rows. Board rank
 * is part of the FA pitcher context — it's what the rank-quality grade
 * (did the top picks beat the pool?) verifies.
 */
export function pointsSnapshotRows(
  leagueKey: string,
  analysis: PointsStreamingAnalysis,
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];

  analysis.pitcherStreams.forEach((row, i) => {
    if (!row.mlbId) return;
    for (const start of row.starts) {
      rows.push({
        gameDate: start.date,
        engine: 'points-pitcher-start',
        mlbId: row.mlbId,
        playerName: row.name,
        leagueKey,
        predicted: { points: start.expectedPoints, pointsPerIP: row.pointsPerIP },
        context: { opp: start.opp, owned: false, rank: i + 1, cadence: analysis.cadence },
      });
    }
  });

  for (const row of analysis.myPitcherFacts) {
    if (!row.mlbId) continue;
    for (const start of row.starts) {
      rows.push({
        gameDate: start.date,
        engine: 'points-pitcher-start',
        mlbId: row.mlbId,
        playerName: row.name,
        leagueKey,
        predicted: { points: start.expectedPoints },
        context: { opp: start.opp, owned: true, cadence: analysis.cadence },
      });
    }
  }

  analysis.batterFacts.forEach(row => {
    if (!row.mlbId) return;
    row.dayPoints.forEach((points, i) => {
      const day = analysis.days[i];
      if (!day || points <= 0) return;
      rows.push({
        gameDate: day.date,
        engine: 'points-batter-day',
        mlbId: row.mlbId!,
        playerName: row.name,
        leagueKey,
        predicted: { points },
        context: { owned: row.owned, injured: row.injured },
      });
    });
  });

  return rows;
}

export function capturePointsInBackground(
  leagueKey: string,
  analysis: PointsStreamingAnalysis,
): void {
  const windowStart = analysis.days[0]?.date;
  if (!windowStart) return;
  const memoKey = `points:${leagueKey}:${windowStart}:${leadDaysFor(windowStart)}`;
  inBackground(memoKey, () => insertSnapshots(pointsSnapshotRows(leagueKey, analysis)));
}
