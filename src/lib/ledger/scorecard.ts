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
  return {
    stat,
    n,
    predictedMean: round(n ? pSum / n : 0),
    actualMean: round(actualMean),
    bias: round(bias),
    biasPct: Math.abs(actualMean) >= 0.05 ? round(bias / actualMean, 3) : null,
    mae: round(mae),
    se: round(n > 1 ? Math.sqrt(variance / n) : 0, 4),
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
    const all = rows.filter(r => r.engine === engine);
    const future = all.filter(r => r.gameDate >= today);
    const past = all.filter(r => r.gameDate < today);
    const pendingActuals = past.filter(r => r.status === null);
    const resolved = past.filter(r => r.status !== null);

    const side: Side = engine.includes('batter') ? 'bat' : 'pit';
    const kind: 'pitcher-line' | 'batter-line' | 'points' =
      engine === 'pitcher-start' ? 'pitcher-line'
      : engine === 'batter-day' ? 'batter-line'
      : 'points';
    const played = resolved.filter(r =>
      side === 'pit' ? r.pitching != null && (r.pitching.gs ?? 0) > 0 : r.batting != null,
    );
    const didNotPlay = resolved.length - played.length;

    // Capture coverage: distinct dates vs the calendar span they cover.
    const dates = [...new Set(all.map(r => r.gameDate))].sort();
    const spanDays = dates.length
      ? Math.round(
          (Date.parse(`${dates[dates.length - 1] < today ? dates[dates.length - 1] : today}T00:00:00Z`) -
            Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000,
        ) + 1
      : 0;
    const coverage = { capturedDays: dates.filter(d => d <= today).length, spanDays: Math.max(spanDays, 0) };

    // Points engines grade one value per row: predicted vs realized points.
    let valueRows: { row: JoinedRow; pred: number; actual: number }[] = [];
    if (kind === 'points') {
      valueRows = played
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

    const statGrades = sliceGrades(played);

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
      coverage,
      stats: statGrades,
      byLeadDays,
      byModelVersion,
    };

    // ---- engine-specific views + findings ---------------------------------

    const minN = kind === 'batter-line' ? 300 : kind === 'pitcher-line' ? 50 : 30;
    findings.push(...biasFindings(engine, statGrades, minN));

    // Scratch / bench rate — a playing-time forecast miss, not noise.
    const dnpRate = resolved.length ? didNotPlay / resolved.length : 0;
    const dnpMin = side === 'bat' ? 200 : 50;
    const [dnpWatch, dnpFlag] = side === 'bat' ? [0.03, 0.05] : [0.1, 0.15];
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
          if (b.n >= 25 && Math.abs(gap) >= 0.06) {
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
        const f = sliceFinding(engine, played, 'pit', stat, 'home/away',
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
        const f = sliceFinding(engine, played, 'pit', stat, label, aName, aTest, bName, bTest);
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
      for (const [stat, label, aName, aTest, bName, bTest] of slices) {
        const f = sliceFinding(engine, played, 'bat', stat, label, aName, aTest, bName, bTest);
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
