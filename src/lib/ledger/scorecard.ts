import { and, eq, gte, lte, type SQL } from 'drizzle-orm';
import { getDb, forecastSnapshots, playerGameActuals } from '@/lib/db';
import { getScoringProfile } from '@/lib/fantasy';
import { actualBatterPoints, actualPitcherPoints } from './actualPoints';
import { todayEt } from './capture';
import type { ForecastEngine } from './capture';

/**
 * Scorecard — grade the ledger. All aggregation happens here in app code
 * over one joined query; a full season of snapshots is tens of thousands
 * of rows, trivial to fold in-process, and keeping metrics out of SQL
 * means adding a new slice never needs a migration.
 *
 * Vocabulary:
 *   bias  — mean(predicted − actual); systematic over/under-forecast.
 *   mae   — mean |predicted − actual|; typical per-game miss (noise included).
 *   calibration — for probability forecasts (QS, W): group by predicted
 *     probability, compare against the realized rate in each bucket.
 */

export interface StatGrade {
  stat: string;
  n: number;
  predictedMean: number;
  actualMean: number;
  bias: number;
  mae: number;
}

export interface CalibrationBucket {
  bucket: string;
  n: number;
  predictedMean: number;
  actualRate: number;
}

export interface PlayerMiss {
  mlbId: number;
  playerName: string;
  starts: number;
  kBias: number;
  erBias: number;
}

export interface RankBucket {
  bucket: string;
  n: number;
  predictedMean: number;
  actualMean: number;
}

export interface EngineScorecard {
  engine: ForecastEngine;
  snapshots: number;
  future: number;
  pendingActuals: number;
  graded: number;
  /** Predicted appearance that never happened (scratch / skipped start /
   *  bench day). Rate of these is itself a forecast-quality signal. */
  didNotPlay: number;
  stats: StatGrade[];
  byLeadDays: { leadDays: number; graded: number; stats: StatGrade[] }[];
  byModelVersion: { modelVersion: string; graded: number; stats: StatGrade[] }[];
  qsCalibration?: CalibrationBucket[];
  wCalibration?: CalibrationBucket[];
  /** FA board rank vs realized outcome (points-pitcher-start only). */
  rankBuckets?: RankBucket[];
  /** Players the engine persistently misses on (≥3 graded starts). */
  worstMisses?: PlayerMiss[];
}

export interface ScorecardFilters {
  engine?: ForecastEngine;
  from?: string;
  to?: string;
}

interface JoinedRow {
  engine: string;
  gameDate: string;
  mlbId: number;
  playerName: string;
  leagueKey: string;
  leadDays: number;
  predicted: Record<string, number>;
  context: Record<string, unknown>;
  modelVersion: string;
  status: 'played' | 'no_game' | null; // null = actuals not materialized yet
  pitching: Record<string, number> | null;
  batting: Record<string, number> | null;
}

const round = (n: number, dp = 3) => Number(n.toFixed(dp));

function gradeStat(
  rows: { pred: number; actual: number }[],
  stat: string,
): StatGrade {
  const n = rows.length;
  const pSum = rows.reduce((s, r) => s + r.pred, 0);
  const aSum = rows.reduce((s, r) => s + r.actual, 0);
  const mae = n ? rows.reduce((s, r) => s + Math.abs(r.pred - r.actual), 0) / n : 0;
  return {
    stat,
    n,
    predictedMean: round(n ? pSum / n : 0),
    actualMean: round(n ? aSum / n : 0),
    bias: round(n ? (pSum - aSum) / n : 0),
    mae: round(mae),
  };
}

function calibrate(rows: { p: number; hit: boolean }[]): CalibrationBucket[] {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const out: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inBucket = rows.filter(r => r.p >= edges[i] && r.p < edges[i + 1]);
    if (inBucket.length === 0) continue;
    out.push({
      bucket: `${Math.round(edges[i] * 100)}–${Math.min(100, Math.round(edges[i + 1] * 100))}%`,
      n: inBucket.length,
      predictedMean: round(inBucket.reduce((s, r) => s + r.p, 0) / inBucket.length),
      actualRate: round(inBucket.filter(r => r.hit).length / inBucket.length),
    });
  }
  return out;
}

/** Per-stat (predicted key → actual line key) pairs graded for pitcher-start. */
const PITCHER_STATS: [string, string][] = [
  ['ip', 'ip'], ['k', 'k'], ['bb', 'bb'], ['er', 'er'], ['h', 'h'], ['hr', 'hr'],
];

const isQs = (p: Record<string, number>) => (p.outs ?? 0) >= 18 && (p.er ?? 0) <= 3;

function pitcherStatGrades(rows: JoinedRow[]): StatGrade[] {
  return PITCHER_STATS.map(([pk, ak]) =>
    gradeStat(rows.map(r => ({ pred: r.predicted[pk] ?? 0, actual: r.pitching![ak] ?? 0 })), pk),
  );
}

/**
 * Build the scorecard for every engine present (or the one filtered).
 * `userId` is the operator's — used only to resolve points scoring
 * profiles for the leagues in the ledger.
 */
export async function buildScorecard(
  userId: string,
  filters: ScorecardFilters = {},
): Promise<EngineScorecard[]> {
  const db = getDb();
  const conds: SQL[] = [];
  if (filters.engine) conds.push(eq(forecastSnapshots.engine, filters.engine));
  if (filters.from) conds.push(gte(forecastSnapshots.gameDate, filters.from));
  if (filters.to) conds.push(lte(forecastSnapshots.gameDate, filters.to));

  const joined = await db
    .select({
      engine: forecastSnapshots.engine,
      gameDate: forecastSnapshots.gameDate,
      mlbId: forecastSnapshots.mlbId,
      playerName: forecastSnapshots.playerName,
      leagueKey: forecastSnapshots.leagueKey,
      leadDays: forecastSnapshots.leadDays,
      predicted: forecastSnapshots.predicted,
      context: forecastSnapshots.context,
      modelVersion: forecastSnapshots.modelVersion,
      status: playerGameActuals.status,
      pitching: playerGameActuals.pitching,
      batting: playerGameActuals.batting,
    })
    .from(forecastSnapshots)
    .leftJoin(
      playerGameActuals,
      and(
        eq(playerGameActuals.mlbId, forecastSnapshots.mlbId),
        eq(playerGameActuals.gameDate, forecastSnapshots.gameDate),
      ),
    )
    .where(conds.length ? and(...conds) : undefined);

  const rows = joined as JoinedRow[];
  const today = todayEt();
  const engines = [...new Set(rows.map(r => r.engine))] as ForecastEngine[];

  // Points profiles, one per league seen in points snapshots.
  const pointsLeagues = [...new Set(rows.filter(r => r.engine.startsWith('points-')).map(r => r.leagueKey))];
  const weightsByLeague = new Map<string, Record<number, number>>();
  for (const lk of pointsLeagues) {
    if (!lk) continue;
    try {
      const profile = await getScoringProfile(userId, lk, '');
      weightsByLeague.set(lk, profile.weights);
    } catch (err) {
      console.error(`[ledger] scoring profile unavailable for ${lk}:`, err);
    }
  }

  return engines.sort().map(engine => {
    const all = rows.filter(r => r.engine === engine);
    const future = all.filter(r => r.gameDate >= today);
    const past = all.filter(r => r.gameDate < today);
    const pendingActuals = past.filter(r => r.status === null);
    const resolved = past.filter(r => r.status !== null);

    const side: 'pit' | 'bat' = engine === 'points-batter-day' ? 'bat' : 'pit';
    const played = resolved.filter(r =>
      side === 'pit' ? r.pitching != null && (r.pitching.gs ?? 0) > 0 : r.batting != null,
    );
    const didNotPlay = resolved.length - played.length;

    // predicted/actual value per row, per engine flavor
    let valueRows: { row: JoinedRow; pred: number; actual: number }[] = [];
    if (engine === 'pitcher-start') {
      valueRows = played.map(row => ({ row, pred: row.predicted.k ?? 0, actual: row.pitching!.k ?? 0 }));
    } else {
      valueRows = played
        .filter(row => weightsByLeague.has(row.leagueKey))
        .map(row => {
          const w = weightsByLeague.get(row.leagueKey)!;
          const actual = side === 'pit' ? actualPitcherPoints(w, row.pitching!) : actualBatterPoints(w, row.batting!);
          return { row, pred: row.predicted.points ?? 0, actual };
        });
    }

    const statGrades = engine === 'pitcher-start'
      ? pitcherStatGrades(played)
      : [gradeStat(valueRows.map(v => ({ pred: v.pred, actual: v.actual })), 'points')];

    const sliceGrades = (slice: JoinedRow[]): StatGrade[] => {
      if (engine === 'pitcher-start') return pitcherStatGrades(slice);
      const vs = valueRows.filter(v => slice.includes(v.row));
      return [gradeStat(vs.map(v => ({ pred: v.pred, actual: v.actual })), 'points')];
    };

    const byLeadDays = [...new Set(played.map(r => r.leadDays))].sort((a, b) => a - b).map(ld => {
      const slice = played.filter(r => r.leadDays === ld);
      return { leadDays: ld, graded: slice.length, stats: sliceGrades(slice) };
    });

    const byModelVersion = [...new Set(played.map(r => r.modelVersion))].sort().map(mv => {
      const slice = played.filter(r => r.modelVersion === mv);
      return { modelVersion: mv, graded: slice.length, stats: sliceGrades(slice) };
    });

    const card: EngineScorecard = {
      engine,
      snapshots: all.length,
      future: future.length,
      pendingActuals: pendingActuals.length,
      graded: played.length,
      didNotPlay,
      stats: statGrades,
      byLeadDays,
      byModelVersion,
    };

    if (engine === 'pitcher-start') {
      card.qsCalibration = calibrate(played.map(r => ({ p: r.predicted.qs ?? 0, hit: isQs(r.pitching!) })));
      card.wCalibration = calibrate(played.map(r => ({ p: r.predicted.w ?? 0, hit: (r.pitching!.w ?? 0) > 0 })));

      const byPlayer = new Map<number, JoinedRow[]>();
      for (const r of played) byPlayer.set(r.mlbId, [...(byPlayer.get(r.mlbId) ?? []), r]);
      card.worstMisses = [...byPlayer.entries()]
        .filter(([, rs]) => rs.length >= 3)
        .map(([mlbId, rs]) => ({
          mlbId,
          playerName: rs[0].playerName,
          starts: rs.length,
          kBias: round(rs.reduce((s, r) => s + ((r.predicted.k ?? 0) - (r.pitching!.k ?? 0)), 0) / rs.length, 2),
          erBias: round(rs.reduce((s, r) => s + ((r.predicted.er ?? 0) - (r.pitching!.er ?? 0)), 0) / rs.length, 2),
        }))
        .sort((a, b) => Math.abs(b.kBias) + Math.abs(b.erBias) - (Math.abs(a.kBias) + Math.abs(a.erBias)))
        .slice(0, 10);
    }

    if (engine === 'points-pitcher-start') {
      const ranked = valueRows.filter(v => v.row.context.owned === false && typeof v.row.context.rank === 'number');
      const buckets: [string, (r: number) => boolean][] = [
        ['1–3', r => r <= 3],
        ['4–10', r => r > 3 && r <= 10],
        ['11+', r => r > 10],
      ];
      card.rankBuckets = buckets
        .map(([label, test]) => {
          const slice = ranked.filter(v => test(v.row.context.rank as number));
          return {
            bucket: label,
            n: slice.length,
            predictedMean: round(slice.reduce((s, v) => s + v.pred, 0) / (slice.length || 1), 1),
            actualMean: round(slice.reduce((s, v) => s + v.actual, 0) / (slice.length || 1), 1),
          };
        })
        .filter(b => b.n > 0);
    }

    return card;
  });
}
