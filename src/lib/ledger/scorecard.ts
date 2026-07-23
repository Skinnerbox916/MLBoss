import { and, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { getDb, forecastSnapshots, playerGameActuals } from '@/lib/db';
import { getScoringProfile } from '@/lib/fantasy';
import { actualBatterPoints, actualPitcherPoints } from './actualPoints';
import { addDaysIso, todayEt } from './capture';
import type { ForecastEngine } from './capture';
import { liveCohortVersions } from './modelVersion';

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
 *   findings — significance-tested flags (see buildFindings). The page
 *     leads with these: per-game baseball stats are noisy enough that
 *     un-tested tables either scream everywhere or nowhere.
 *
 * Significance discipline: a finding needs |t| ≥ 3 (flag) or ≥ 2 (watch)
 * where t = bias / SE. The bar is deliberately high — we test many
 * stats × slices at once, and at ~30 comparisons a t of 2 appears by
 * chance about once per page. Treat "watch" as a hypothesis, "flag" as
 * a to-do. Rationale: docs/forecast-verification.md#findings.
 */

export interface StatGrade {
  stat: string;
  n: number;
  predictedMean: number;
  actualMean: number;
  bias: number;
  /** bias / actualMean — comparable across stats. Null when the actual
   *  mean is too small for a ratio to mean anything (< 0.05/game). */
  biasPct: number | null;
  mae: number;
  /** Standard error of the bias — the noise floor the findings test
   *  against. 0 when n < 2. */
  se: number;
  /** Calibration slope: ACTUAL regressed on PREDICTED. If predictions
   *  are honest conditional means the slope is exactly 1 — independent
   *  of how noisy the stat is. < 1 ⇒ over-spread (predictions more
   *  extreme than outcomes reward — the model over-trusts its own
   *  signal); > 1 ⇒ under-spread (too timid). Orthogonal to bias: a
   *  stat can have a clean mean and a dishonest spread, and vice versa.
   *  Null when predictions barely vary or n < 3. */
  slope: number | null;
  /** Standard error of the slope (null with it). */
  slopeSe: number | null;
  /** How many model versions this headline grade pools (live cohort). >1
   *  means the metric accumulated unbroken across a version bump that
   *  didn't touch it; 1 after a bump that did. Undefined on segmented
   *  views (by-version / by-lead-days), where it's meaningless. */
  versions?: number;
}

export interface CalibrationBucket {
  bucket: string;
  n: number;
  predictedMean: number;
  actualRate: number;
  /** Realized rate outside the binomial 95% band of the forecast rate. */
  significant: boolean;
}

export interface PlayerMiss {
  mlbId: number;
  playerName: string;
  n: number;
  biases: { stat: string; bias: number; significant: boolean }[];
}

export interface RankBucket {
  bucket: string;
  n: number;
  predictedMean: number;
  actualMean: number;
}

/** Predicted-composite-score buckets vs realized outcomes — the
 *  discrimination view: does a player we scored 70+ actually out-produce
 *  one we scored under 45? */
export interface ScoreBucket {
  bucket: string;
  n: number;
  outcomes: Record<string, number>;
}

export interface Finding {
  severity: 'flag' | 'watch';
  engine: ForecastEngine | 'ledger';
  title: string;
  detail: string;
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
  /** Distinct game dates captured vs calendar days in the captured span —
   *  quiet capture gaps silently bias "how are we doing" downstream. */
  coverage: { capturedDays: number; spanDays: number };
  stats: StatGrade[];
  byLeadDays: { leadDays: number; graded: number; stats: StatGrade[] }[];
  byModelVersion: { modelVersion: string; graded: number; stats: StatGrade[] }[];
  qsCalibration?: CalibrationBucket[];
  wCalibration?: CalibrationBucket[];
  /** FA board rank vs realized outcome (points-pitcher-start only). */
  rankBuckets?: RankBucket[];
  scoreBuckets?: ScoreBucket[];
  /** Players the engine persistently misses on. */
  worstMisses?: PlayerMiss[];
}

export interface Scorecard {
  engines: EngineScorecard[];
  findings: Finding[];
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

type Side = 'pit' | 'bat';

const round = (n: number, dp = 3) => Number(n.toFixed(dp));
const fmtSigned = (n: number, dp = 2) => `${n > 0 ? '+' : ''}${n.toFixed(dp)}`;

function gradeStat(rows: { pred: number; actual: number }[], stat: string): StatGrade {
  const n = rows.length;
  const pSum = rows.reduce((s, r) => s + r.pred, 0);
  const aSum = rows.reduce((s, r) => s + r.actual, 0);
  const bias = n ? (pSum - aSum) / n : 0;
  const mae = n ? rows.reduce((s, r) => s + Math.abs(r.pred - r.actual), 0) / n : 0;
  const variance = n > 1
    ? rows.reduce((s, r) => s + (r.pred - r.actual - bias) ** 2, 0) / (n - 1)
    : 0;
  const actualMean = n ? aSum / n : 0;
  const predMean = n ? pSum / n : 0;

  // Calibration slope (actual ~ predicted, OLS) + its standard error.
  // Guarded to null when the predictions carry no real spread to test —
  // a near-constant predictor makes the slope numerically explosive and
  // semantically empty.
  let slope: number | null = null;
  let slopeSe: number | null = null;
  if (n >= 3) {
    const sxx = rows.reduce((s, r) => s + (r.pred - predMean) ** 2, 0);
    if (sxx > 1e-9) {
      const sxy = rows.reduce((s, r) => s + (r.pred - predMean) * (r.actual - actualMean), 0);
      const b = sxy / sxx;
      const sse = rows.reduce(
        (s, r) => s + (r.actual - actualMean - b * (r.pred - predMean)) ** 2, 0);
      slope = round(b);
      slopeSe = round(Math.sqrt(sse / (n - 2) / sxx), 4);
    }
  }

  return {
    stat,
    n,
    predictedMean: round(predMean),
    actualMean: round(actualMean),
    bias: round(bias),
    biasPct: Math.abs(actualMean) >= 0.05 ? round(bias / actualMean, 3) : null,
    mae: round(mae),
    se: round(n > 1 ? Math.sqrt(variance / n) : 0, 4),
    slope,
    slopeSe,
  };
}

function lineOf(r: JoinedRow, side: Side): Record<string, number> {
  return (side === 'pit' ? r.pitching : r.batting)!;
}

function gradeOne(rows: JoinedRow[], stat: string, side: Side): StatGrade {
  return gradeStat(
    rows.map(r => ({ pred: r.predicted[stat] ?? 0, actual: lineOf(r, side)[stat] ?? 0 })),
    stat,
  );
}

function calibrate(rows: { p: number; hit: boolean }[]): CalibrationBucket[] {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const out: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inBucket = rows.filter(r => r.p >= edges[i] && r.p < edges[i + 1]);
    if (inBucket.length === 0) continue;
    const predictedMean = inBucket.reduce((s, r) => s + r.p, 0) / inBucket.length;
    const actualRate = inBucket.filter(r => r.hit).length / inBucket.length;
    const binomialSe = Math.sqrt(Math.max(predictedMean * (1 - predictedMean), 1e-9) / inBucket.length);
    out.push({
      bucket: `${Math.round(edges[i] * 100)}–${Math.min(100, Math.round(edges[i + 1] * 100))}%`,
      n: inBucket.length,
      predictedMean: round(predictedMean),
      actualRate: round(actualRate),
      significant: Math.abs(predictedMean - actualRate) > 1.96 * binomialSe,
    });
  }
  return out;
}

/** Per-stat predicted/actual keys graded for the raw stat-line engines
 *  (predicted keys and materialized actual-line keys are aligned by
 *  construction — see capture.ts and score.ts). */
const PITCHER_STATS = ['ip', 'k', 'bb', 'er', 'h', 'hr'];
const BATTER_STATS = ['pa', 'h', 'r', 'hr', 'rbi', 'sb', 'bb', 'k', 'tb', 'doubles', 'triples'];

const isQs = (p: Record<string, number>) => (p.outs ?? 0) >= 18 && (p.er ?? 0) <= 3;

function lineStatGrades(rows: JoinedRow[], stats: string[], side: Side): StatGrade[] {
  return stats.map(stat => gradeOne(rows, stat, side));
}

/** Per-player systematic misses over the graded rows (≥minN appearances). */
function playerMisses(rows: JoinedRow[], stats: string[], side: Side, minN: number): PlayerMiss[] {
  const byPlayer = new Map<number, JoinedRow[]>();
  for (const r of rows) byPlayer.set(r.mlbId, [...(byPlayer.get(r.mlbId) ?? []), r]);
  return [...byPlayer.entries()]
    .filter(([, rs]) => rs.length >= minN)
    .map(([mlbId, rs]) => ({
      mlbId,
      playerName: rs[0].playerName,
      n: rs.length,
      biases: stats.map(stat => {
        const g = gradeOne(rs, stat, side);
        return {
          stat,
          bias: round(g.bias, 2),
          significant: g.se > 0 && Math.abs(g.bias / g.se) >= 2,
        };
      }),
    }))
    .sort((a, b) =>
      b.biases.reduce((s, x) => s + Math.abs(x.bias), 0) -
      a.biases.reduce((s, x) => s + Math.abs(x.bias), 0),
    )
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Findings — the "what should jump out" layer
// ---------------------------------------------------------------------------

const T_FLAG = 3;
const T_WATCH = 2;

/** Overall per-stat bias, tested against its own noise floor. */
function biasFindings(engine: ForecastEngine, grades: StatGrade[], minN: number): Finding[] {
  const out: Finding[] = [];
  for (const g of grades) {
    if (g.n < minN || g.se <= 0 || g.biasPct === null) continue;
    const t = g.bias / g.se;
    const relOk = Math.abs(g.biasPct) >= 0.03;
    if (Math.abs(t) < T_WATCH || !relOk) continue;
    const severity: Finding['severity'] =
      Math.abs(t) >= T_FLAG && Math.abs(g.biasPct) >= 0.05 ? 'flag' : 'watch';
    out.push({
      severity,
      engine,
      title: `${engine} ${t > 0 ? 'over' : 'under'}-forecasts ${g.stat.toUpperCase()} by ${Math.round(Math.abs(g.biasPct) * 100)}%`,
      detail: `predicted ${g.predictedMean} vs actual ${g.actualMean} per game (bias ${fmtSigned(g.bias)}, n=${g.n})`,
    });
  }
  return out;
}

/** Calibration-slope findings: is each stat's prediction SPREAD honest,
 *  independent of its mean? Tested as (slope − 1) against the slope's own
 *  SE with the shared t-bars, plus a ±0.15 magnitude floor so trivial
 *  mis-spread doesn't page. Over-spread points at the talent layer
 *  trusting thin samples too much, or a multiplicative modifier
 *  amplifying the tails (the 2026-07 K log5 bug was both). */
function spreadFindings(engine: ForecastEngine, grades: StatGrade[], minN: number): Finding[] {
  const out: Finding[] = [];
  for (const g of grades) {
    if (g.n < minN || g.slope === null || g.slopeSe === null || g.slopeSe <= 0) continue;
    const dev = g.slope - 1;
    const t = dev / g.slopeSe;
    if (Math.abs(t) < T_WATCH || Math.abs(dev) < 0.15) continue;
    const severity: Finding['severity'] =
      Math.abs(t) >= T_FLAG && Math.abs(dev) >= 0.25 ? 'flag' : 'watch';
    out.push({
      severity,
      engine,
      title: `${engine} ${g.stat.toUpperCase()} forecasts ${dev < 0 ? 'over-spread' : 'under-spread'} (slope ${g.slope})`,
      detail: `actual-on-predicted slope ${g.slope} ± ${g.slopeSe} vs 1.0 (n=${g.n}) — ` +
        (dev < 0
          ? 'predictions are more extreme than outcomes reward; the model over-trusts its own signal'
          : 'predictions are too timid; the model under-uses real signal'),
    });
  }
  return out;
}

/** Conditional bias: same stat, two context groups. Where aggregate
 *  tables hide systematic misses. */
function sliceFinding(
  engine: ForecastEngine,
  rows: JoinedRow[],
  side: Side,
  stat: string,
  label: string,
  aName: string,
  aTest: (r: JoinedRow) => boolean,
  bName: string,
  bTest: (r: JoinedRow) => boolean,
  minN = 50,
): Finding | null {
  const a = gradeOne(rows.filter(aTest), stat, side);
  const b = gradeOne(rows.filter(bTest), stat, side);
  if (a.n < minN || b.n < minN || a.se <= 0 || b.se <= 0) return null;
  const t = (a.bias - b.bias) / Math.sqrt(a.se ** 2 + b.se ** 2);
  if (!Number.isFinite(t) || Math.abs(t) < T_WATCH) return null;
  return {
    severity: Math.abs(t) >= T_FLAG ? 'flag' : 'watch',
    engine,
    title: `${engine}: ${stat.toUpperCase()} bias differs by ${label}`,
    detail: `${aName} ${fmtSigned(a.bias)} (n=${a.n}) vs ${bName} ${fmtSigned(b.bias)} (n=${b.n})`,
  };
}

function scoreBuckets(
  rows: JoinedRow[],
  side: Side,
  outcomes: [string, (line: Record<string, number>) => number][],
): ScoreBucket[] {
  const edges: [string, number, number][] = [
    ['<45', -1, 45], ['45–55', 45, 55], ['55–70', 55, 70], ['70+', 70, 101],
  ];
  const scored = rows.filter(r => typeof r.predicted.score === 'number');
  return edges
    .map(([bucket, lo, hi]) => {
      const slice = scored.filter(r => r.predicted.score >= lo && r.predicted.score < hi);
      const out: Record<string, number> = {};
      for (const [name, fn] of outcomes) {
        out[name] = round(slice.reduce((s, r) => s + fn(lineOf(r, side)), 0) / (slice.length || 1), 2);
      }
      return { bucket, n: slice.length, outcomes: out };
    })
    .filter(b => b.n > 0);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Build the scorecard for every engine present (or the one filtered).
 * `userId` is the operator's — used only to resolve points scoring
 * profiles for the leagues in the ledger.
 */
export async function buildScorecard(
  userId: string,
  filters: ScorecardFilters = {},
): Promise<Scorecard> {
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
  const findings: Finding[] = [];

  // Week-window engines join actuals across their whole Mon–Sun span, not
  // just the keyed Monday — fetch those actuals once, keyed player:date.
  const weekRowsAll = rows.filter(r => r.engine === 'batter-week');
  const weekActuals = new Map<string, { status: 'played' | 'no_game'; batting: Record<string, number> | null }>();
  if (weekRowsAll.length > 0) {
    const ids = [...new Set(weekRowsAll.map(r => r.mlbId))];
    const ds = weekRowsAll.map(r => r.gameDate).sort();
    const actRows = await db
      .select({
        mlbId: playerGameActuals.mlbId,
        gameDate: playerGameActuals.gameDate,
        status: playerGameActuals.status,
        batting: playerGameActuals.batting,
      })
      .from(playerGameActuals)
      .where(and(
        inArray(playerGameActuals.mlbId, ids),
        gte(playerGameActuals.gameDate, ds[0]),
        lte(playerGameActuals.gameDate, addDaysIso(ds[ds.length - 1], 6)),
      ));
    for (const a of actRows) {
      weekActuals.set(`${a.mlbId}:${a.gameDate}`, {
        status: a.status,
        batting: a.batting as Record<string, number> | null,
      });
    }
  }

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

  const cards = engines.sort().map(engine => {
    const rawAll = rows.filter(r => r.engine === engine);

    // One row per (player, game/window, league): traffic re-captures the
    // same prediction at shrinking leads, and those rows are near-perfectly
    // correlated — counting them all would overstate every n and shrink
    // every noise floor. Grade the closest-to-game forecast; the raw
    // multi-lead rows feed ONLY the by-lead-days comparison view.
    const byIdentity = new Map<string, JoinedRow>();
    for (const r of rawAll) {
      const k = `${r.mlbId}:${r.gameDate}:${r.leagueKey}`;
      const prev = byIdentity.get(k);
      if (!prev || r.leadDays < prev.leadDays) byIdentity.set(k, r);
    }
    const all = [...byIdentity.values()];

    let future: JoinedRow[];
    let pendingActuals: JoinedRow[];
    let resolved: JoinedRow[];

    if (engine === 'batter-week') {
      future = [];
      pendingActuals = [];
      resolved = [];
      for (const r of all) {
        if (addDaysIso(r.gameDate, 6) >= today) { future.push(r); continue; }
        const days = Array.from({ length: 7 }, (_, d) => weekActuals.get(`${r.mlbId}:${addDaysIso(r.gameDate, d)}`));
        if (days.some(d => d === undefined)) { pendingActuals.push(r); continue; }
        const lines = days.flatMap(d => (d!.batting != null ? [d!.batting] : []));
        const summed: Record<string, number> = {};
        for (const line of lines) {
          for (const [key, v] of Object.entries(line)) summed[key] = (summed[key] ?? 0) + v;
        }
        resolved.push({
          ...r,
          status: lines.length > 0 ? 'played' : 'no_game',
          batting: lines.length > 0 ? summed : null,
        });
      }
    } else {
      future = all.filter(r => r.gameDate >= today);
      const past = all.filter(r => r.gameDate < today);
      pendingActuals = past.filter(r => r.status === null);
      resolved = past.filter(r => r.status !== null);
    }

    const side: Side = engine.includes('batter') ? 'bat' : 'pit';
    const kind: 'pitcher-line' | 'batter-line' | 'points' =
      engine === 'pitcher-start' ? 'pitcher-line'
      : engine === 'batter-day' || engine === 'batter-week' ? 'batter-line'
      : 'points';
    const isPlayed = (r: JoinedRow) =>
      side === 'pit' ? r.pitching != null && (r.pitching.gs ?? 0) > 0 : r.batting != null;
    const played = resolved.filter(isPlayed);
    const didNotPlay = resolved.length - played.length;

    // All-leads graded rows — exclusively for the by-lead-days view, where
    // the same appearance at different leads is the comparison, not a dupe.
    // (batter-week's window synthesis only ran on deduped rows, so it keeps
    // its post-dedupe view there.)
    const playedAllLeads = engine === 'batter-week'
      ? played
      : rawAll.filter(r => r.gameDate < today && r.status !== null && isPlayed(r));
    const playedSet = new Set(played);

    // Capture coverage: distinct dates vs the calendar span they cover
    // (week engines count in Mon–Sun windows, not days).
    const dates = [...new Set(all.map(r => r.gameDate))].sort();
    const rawSpanDays = dates.length
      ? Math.round(
          (Date.parse(`${dates[dates.length - 1] < today ? dates[dates.length - 1] : today}T00:00:00Z`) -
            Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000,
        ) + 1
      : 0;
    const coverage = {
      capturedDays: dates.filter(d => d <= today).length,
      spanDays: engine === 'batter-week'
        ? (dates.length ? Math.floor(Math.max(rawSpanDays - 1, 0) / 7) + 1 : 0)
        : Math.max(rawSpanDays, 0),
    };

    // Points engines grade one value per row: predicted vs realized points.
    // Built over all leads so the by-lead-days view can price its slices;
    // everything else filters back down to the deduped `played` set.
    let valueRows: { row: JoinedRow; pred: number; actual: number }[] = [];
    if (kind === 'points') {
      valueRows = playedAllLeads
        .filter(row => weightsByLeague.has(row.leagueKey))
        .map(row => {
          const w = weightsByLeague.get(row.leagueKey)!;
          const actual = side === 'pit' ? actualPitcherPoints(w, row.pitching!) : actualBatterPoints(w, row.batting!);
          return { row, pred: row.predicted.points ?? 0, actual };
        });
    }

    const sliceGrades = (slice: JoinedRow[]): StatGrade[] => {
      if (kind === 'pitcher-line') return lineStatGrades(slice, PITCHER_STATS, 'pit');
      if (kind === 'batter-line') return lineStatGrades(slice, BATTER_STATS, 'bat');
      const vs = valueRows.filter(v => slice.includes(v.row));
      return [gradeStat(vs.map(v => ({ pred: v.pred, actual: v.actual })), 'points')];
    };

    // Headline grades read the LIVE COHORT per stat: pool every version that
    // is model-equivalent to the current build for that metric, drop the
    // ones a change since then superseded. So an untouched stat pools its
    // whole history across a bump, while a touched stat resets to post-change
    // data only. The full split stays visible in `byModelVersion`.
    const presentVersions = [...new Set(played.map(r => r.modelVersion))];
    const cohortRows = (stat: string): JoinedRow[] => {
      const cohort = liveCohortVersions(engine, stat, presentVersions);
      return played.filter(r => cohort.has(r.modelVersion));
    };
    const headlineGrade = (stat: string, gradeFn: (rows: JoinedRow[]) => StatGrade): StatGrade => {
      const rows = cohortRows(stat);
      return { ...gradeFn(rows), versions: new Set(rows.map(r => r.modelVersion)).size };
    };

    let statGrades: StatGrade[];
    if (kind === 'pitcher-line') {
      statGrades = PITCHER_STATS.map(s => headlineGrade(s, rows => gradeOne(rows, s, 'pit')));
    } else if (kind === 'batter-line') {
      statGrades = BATTER_STATS.map(s => headlineGrade(s, rows => gradeOne(rows, s, 'bat')));
    } else {
      statGrades = [headlineGrade('points', rows => {
        const set = new Set(rows);
        const vs = valueRows.filter(v => set.has(v.row));
        return gradeStat(vs.map(v => ({ pred: v.pred, actual: v.actual })), 'points');
      })];
    }

    const byLeadDays = [...new Set(playedAllLeads.map(r => r.leadDays))].sort((a, b) => a - b).map(ld => {
      const slice = playedAllLeads.filter(r => r.leadDays === ld);
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
      coverage,
      stats: statGrades,
      byLeadDays,
      byModelVersion,
    };

    // ---- engine-specific views + findings ---------------------------------

    const minN =
      engine === 'batter-week' ? 150 : kind === 'batter-line' ? 300 : kind === 'pitcher-line' ? 50 : 30;
    findings.push(...biasFindings(engine, statGrades, minN));
    findings.push(...spreadFindings(engine, statGrades, minN));

    // Scratch / bench rate — a playing-time forecast miss, not noise.
    // (For week windows this means zero games all week — IL / demotion —
    // so the acceptable baseline is higher.)
    const dnpRate = resolved.length ? didNotPlay / resolved.length : 0;
    const [dnpMin, dnpWatch, dnpFlag] =
      engine === 'batter-week' ? [100, 0.08, 0.15]
      // points-batter-day predicts by SCHEDULE (team plays), not posted
      // lineup — routine rest days are expected, ~10-15% is the baseline
      // for a pool that includes part-timers, not a forecast miss.
      : engine === 'points-batter-day' ? [300, 0.18, 0.28]
      : side === 'bat' ? [200, 0.03, 0.05]
      : [50, 0.1, 0.15];
    if (resolved.length >= dnpMin && dnpRate >= dnpWatch) {
      findings.push({
        severity: dnpRate >= dnpFlag ? 'flag' : 'watch',
        engine,
        title: `${engine}: ${Math.round(dnpRate * 100)}% of predicted appearances didn't happen`,
        detail: `${didNotPlay} of ${resolved.length} resolved snapshots (scratches / skipped starts / bench days)`,
      });
    }

    if (engine === 'pitcher-start') {
      card.qsCalibration = calibrate(played.map(r => ({ p: r.predicted.qs ?? 0, hit: isQs(r.pitching!) })));
      card.wCalibration = calibrate(played.map(r => ({ p: r.predicted.w ?? 0, hit: (r.pitching!.w ?? 0) > 0 })));
      card.worstMisses = playerMisses(played, ['k', 'er'], 'pit', 3);
      card.scoreBuckets = scoreBuckets(played, 'pit', [
        ['k', l => l.k ?? 0],
        ['er', l => l.er ?? 0],
        ['qsRate', l => (isQs(l) ? 1 : 0)],
      ]);

      for (const [name, buckets] of [['QS', card.qsCalibration], ['W', card.wCalibration]] as const) {
        for (const b of buckets) {
          const gap = b.predictedMean - b.actualRate;
          // Gate on the binomial band, not just gap size — a fixed gap
          // threshold alone fires on small-n buckets that are pure noise.
          if (b.n >= 25 && b.significant && Math.abs(gap) >= 0.06) {
            findings.push({
              severity: Math.abs(gap) >= 0.1 ? 'flag' : 'watch',
              engine,
              title: `${name} probability miscalibrated in the ${b.bucket} band`,
              detail: `forecast ${Math.round(b.predictedMean * 100)}% vs realized ${Math.round(b.actualRate * 100)}% (n=${b.n})`,
            });
          }
        }
      }

      for (const stat of ['k', 'er']) {
        const f = sliceFinding(engine, cohortRows(stat), 'pit', stat, 'home/away',
          'home', r => r.context.isHome === true, 'away', r => r.context.isHome === false);
        if (f) findings.push(f);
      }

      // Knob grading: bias split by how hard a modifier was applied. A
      // significant difference means the knob itself is mis-scaled, not
      // the underlying talent estimate. Multiplier semantics: >1 boosts
      // the pitcher (see ContextMultiplier in pitching/forecast.ts).
      const mult = (r: JoinedRow, key: string): number | undefined =>
        (r.context.mults as Record<string, number> | undefined)?.[key];
      const knobSlices: [string, string, string, (r: JoinedRow) => boolean, string, (r: JoinedRow) => boolean][] = [
        ['er', 'park modifier', 'pitcher-friendly (≥+3%)', r => (mult(r, 'park') ?? 1) >= 1.03,
          'hitter-friendly (≤−3%)', r => (mult(r, 'park') ?? 1) <= 0.97],
        ['k', 'opponent modifier', 'weak offenses (≥+3%)', r => (mult(r, 'opp') ?? 1) >= 1.03,
          'strong offenses (≤−3%)', r => (mult(r, 'opp') ?? 1) <= 0.97],
      ];
      for (const [stat, label, aName, aTest, bName, bTest] of knobSlices) {
        const f = sliceFinding(engine, cohortRows(stat), 'pit', stat, label, aName, aTest, bName, bTest);
        if (f) findings.push(f);
      }
    }

    if (engine === 'batter-week') {
      card.worstMisses = playerMisses(played, ['pa', 'tb'], 'bat', 3);
      // Ownership slice: does the playing-time model treat the FA pool
      // (Upgrade Targets) the same as rostered bats (Your Batters)? An
      // asymmetry here directly mis-prices every suggested swap.
      for (const stat of ['pa', 'tb']) {
        const f = sliceFinding(engine, cohortRows(stat), 'bat', stat, 'ownership',
          'rostered', r => r.context.owned === true,
          'free agents', r => r.context.owned === false);
        if (f) findings.push(f);
      }
    }

    if (engine === 'batter-day') {
      // PA bias isolates the playing-time model; TB/K biases the rate model.
      card.worstMisses = playerMisses(played, ['pa', 'tb', 'k'], 'bat', 5);
      card.scoreBuckets = scoreBuckets(played, 'bat', [
        ['tb', l => l.tb ?? 0],
        ['r+rbi', l => (l.r ?? 0) + (l.rbi ?? 0)],
      ]);

      const slices: [string, string, string, (r: JoinedRow) => boolean, string, (r: JoinedRow) => boolean][] = [
        ['tb', 'platoon side', 'vs LHP', r => r.context.spThrows === 'L', 'vs RHP', r => r.context.spThrows === 'R'],
        ['tb', 'home/away', 'home', r => r.context.isHome === true, 'away', r => r.context.isHome === false],
        ['tb', 'park', 'hitter parks (PF≥103)', r => typeof r.context.parkFactor === 'number' && r.context.parkFactor >= 103,
          'pitcher parks (PF≤97)', r => typeof r.context.parkFactor === 'number' && r.context.parkFactor <= 97],
        ['pa', 'lineup spot', 'spots 1–3', r => typeof r.context.spot === 'number' && r.context.spot <= 3,
          'spots 7–9', r => typeof r.context.spot === 'number' && r.context.spot >= 7],
        // Knob grading: total applied context modifier vs realized TB. A
        // significant split = modifiers over/under-applied as a class.
        ['tb', 'applied TB modifier', 'boosted (≥+5%)',
          r => ((r.context.mods as Record<string, number> | undefined)?.tb ?? 1) >= 1.05,
          'dampened (≤−5%)',
          r => ((r.context.mods as Record<string, number> | undefined)?.tb ?? 1) <= 0.95],
      ];
      // Slices read the LIVE COHORT per stat, same as the headline grades:
      // a stat a version bump touched (e.g. the PA re-anchor) must not mix
      // pre/post-change rows, or a corrected bias keeps re-flagging for weeks.
      for (const [stat, label, aName, aTest, bName, bTest] of slices) {
        const f = sliceFinding(engine, cohortRows(stat), 'bat', stat, label, aName, aTest, bName, bTest);
        if (f) findings.push(f);
      }
    }

    // Discrimination: the top score bucket must out-produce the bottom one
    // on the primary outcome, or the composite isn't ranking anything.
    if (card.scoreBuckets && card.scoreBuckets.length >= 2) {
      const top = card.scoreBuckets.find(b => b.bucket === '70+');
      const bottom = card.scoreBuckets.find(b => b.bucket === '<45');
      const primary = side === 'pit' ? 'k' : 'tb';
      if (top && bottom && top.n >= 30 && bottom.n >= 30 && top.outcomes[primary] <= bottom.outcomes[primary]) {
        findings.push({
          severity: 'flag',
          engine,
          title: `${engine}: score buckets don't separate on ${primary.toUpperCase()}`,
          detail: `70+ scored players produced ${top.outcomes[primary]} vs ${bottom.outcomes[primary]} for <45 (n=${top.n}/${bottom.n})`,
        });
      }
    }

    if (engine === 'points-pitcher-start') {
      const ranked = valueRows.filter(v =>
        playedSet.has(v.row) && v.row.context.owned === false && typeof v.row.context.rank === 'number',
      );
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

      const top = card.rankBuckets.find(b => b.bucket === '1–3');
      const rest = card.rankBuckets.find(b => b.bucket === '11+');
      if (top && rest && top.n >= 20 && rest.n >= 20 && top.actualMean <= rest.actualMean) {
        findings.push({
          severity: 'flag',
          engine,
          title: 'FA board rank inverted: top picks underperform rank 11+',
          detail: `ranks 1–3 realized ${top.actualMean} pts/start (n=${top.n}) vs ${rest.actualMean} for 11+ (n=${rest.n})`,
        });
      }
    }

    // Operational findings.
    if (coverage.spanDays >= 10 && coverage.capturedDays / coverage.spanDays < 0.75) {
      findings.push({
        severity: 'watch',
        engine,
        title: `${engine}: capture gaps — ${coverage.spanDays - coverage.capturedDays} of ${coverage.spanDays} days missing`,
        detail: 'Snapshots only accrue on days the slate was loaded or captured; consider scheduling the capture endpoint.',
      });
    }
    if (pendingActuals.length >= 300) {
      findings.push({
        severity: 'watch',
        engine,
        title: `${engine}: ${pendingActuals.length} snapshots awaiting actuals`,
        detail: 'Run "Score pending actuals" — grading is idempotent and cheap.',
      });
    }

    return card;
  });

  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'flag' ? -1 : 1));
  return { engines: cards, findings };
}
