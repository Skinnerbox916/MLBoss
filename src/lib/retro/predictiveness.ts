/**
 * Retro study — how well does each metric predict FUTURE performance?
 *
 * Splits the season at a date, aggregates every player over the window
 * before it and the window after it (via `aggregateWindow`, so the
 * conventions match the as-of rows exactly), and asks the question the
 * talent layer's priors encode: given what a player had done by date D,
 * which measurement best forecasts what he does after D?
 *
 * Two things come out of it, and they set different constants:
 *   - **Predictiveness** (correlation of a window-A metric with a window-B
 *     outcome) says WHAT the talent layer should regress toward.
 *   - **Incremental value** (does the Statcast metric add signal on top of
 *     the traditional one in a two-variable fit?) says whether carrying it
 *     is earning its keep.
 * Pure statistics over the corpus — imports nothing from the engines and is
 * never imported by them. docs/forecast-verification.md#retro
 */

import { aggregateWindow, WOBA_WEIGHTS, type AggRow } from './asOf';

export interface PlayerWindow {
  id: number;
  pa: number;
  /** Metric name → value; null when the denominator was empty. */
  m: Record<string, number | null>;
}

/** Actual wOBA from counts using the season's linear weights (same as asOf). */
function actualWoba(r: AggRow, season: number): number | null {
  const w = WOBA_WEIGHTS[season];
  const den = r.ab + r.ubb + r.sf + r.hbp;
  if (!w || den <= 0) return null;
  return (w.ubb * r.ubb + w.hbp * r.hbp + w.s1 * r.s1 + w.s2 * r.s2 + w.s3 * r.s3 + w.hr * r.hr) / den;
}

const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Every metric a window yields, for either side of the ball. */
export function metricsOf(r: AggRow, season: number): Record<string, number | null> {
  const hits = r.s1 + r.s2 + r.s3 + r.hr;
  const tb = r.s1 + 2 * r.s2 + 3 * r.s3 + 4 * r.hr;
  return {
    // Statcast-derived (expected / batted-ball quality)
    xwoba: r.xwoba,
    xwobacon: r.xwobacon,
    xba: r.xba,
    xslg: r.xslg,
    hardHitPct: r.hardhit,
    barrelPerBbe: rate(r.barrels, r.bip),
    barrelPerPa: rate(r.barrels, r.pa),
    whiffPct: rate(r.whiffs, r.swings),
    // Traditional (outcome) counterparts
    woba: actualWoba(r, season),
    avg: rate(hits, r.ab),
    slg: rate(tb, r.ab),
    tbPerPa: rate(tb, r.pa),
    hrPerPa: rate(r.hr, r.pa),
    kPerPa: rate(r.so, r.pa),
    bbPerPa: rate(r.bb, r.pa),
    babip: rate(hits - r.hr, r.ab - r.so - r.hr + r.sf),
  };
}

export interface SplitWindows {
  season: number;
  splitDate: string;
  from: string;
  to: string;
  before: Map<number, PlayerWindow>;
  after: Map<number, PlayerWindow>;
}

export async function buildSplit(
  kind: 'batter' | 'pitcher',
  season: number,
  splitDate: string,
  from: string,
  toExclusive: string,
): Promise<SplitWindows> {
  const [a, b] = await Promise.all([
    aggregateWindow(kind, from, splitDate),
    aggregateWindow(kind, splitDate, toExclusive),
  ]);
  const wrap = (rows: AggRow[]) =>
    new Map(rows.map(r => [r.id, { id: r.id, pa: r.pa, m: metricsOf(r, season) }]));
  return { season, splitDate, from, to: toExclusive, before: wrap(a), after: wrap(b) };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

export function corr(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Fisher z standard error of a correlation. */
export const corrSe = (n: number) => 1 / Math.sqrt(Math.max(n - 3, 1));

/**
 * Williams' test for two DEPENDENT correlations that share the outcome
 * variable: is r(statcast, future) different from r(traditional, future)?
 * Treating them as independent (comparing error bars) is badly conservative
 * here — the two predictors are measured on the same players and are
 * themselves strongly correlated, which is exactly the case this test is for.
 * Returns t; |t| > 1.96 is p < 0.05 with df = n − 3.
 */
export function williamsT(rXY: number, rZY: number, rXZ: number, n: number): number {
  if (n < 5) return NaN;
  const detR = 1 - rXY * rXY - rZY * rZY - rXZ * rXZ + 2 * rXY * rZY * rXZ;
  const meanR2 = ((rXY + rZY) / 2) ** 2;
  const denom = (2 * ((n - 1) / (n - 3)) * detR) + meanR2 * (1 - rXZ) ** 3;
  if (denom <= 0) return NaN;
  return (rXY - rZY) * Math.sqrt(((n - 1) * (1 + rXZ)) / denom);
}

/**
 * Commonality (variance) decomposition of two predictor families against one
 * outcome. Statcast and box-score metrics are not rivals — they overlap and
 * each carries signal the other doesn't — so the useful summary is how the
 * explained variance splits three ways:
 *
 *   unique(box)      what only the traditional stat knows
 *   unique(statcast) what only the batted-ball measurement knows
 *   shared           what both encode (the same underlying skill)
 *
 * `fStat` tests whether adding the Statcast predictor to a model that
 * already contains the box-score one is a real improvement (df 1, n − 3).
 */
export interface Commonality {
  r2Box: number; r2Statcast: number; r2Both: number;
  uniqueBox: number; uniqueStatcast: number; shared: number;
  betaBox: number; betaStatcast: number;
  fStat: number; predictorCorr: number;
}

export function commonality(box: number[], statcast: number[], y: number[]): Commonality {
  const n = y.length;
  const rBY = corr(box, y), rSY = corr(statcast, y), rBS = corr(box, statcast);
  const r2Box = rBY * rBY, r2Statcast = rSY * rSY;
  const den = 1 - rBS * rBS;
  if (!Number.isFinite(den) || Math.abs(den) < 1e-9) {
    return { r2Box, r2Statcast, r2Both: Math.max(r2Box, r2Statcast), uniqueBox: 0, uniqueStatcast: 0, shared: Math.max(r2Box, r2Statcast), betaBox: NaN, betaStatcast: NaN, fStat: NaN, predictorCorr: rBS };
  }
  const betaBox = (rBY - rSY * rBS) / den;
  const betaStatcast = (rSY - rBY * rBS) / den;
  const r2Both = betaBox * rBY + betaStatcast * rSY;
  const uniqueStatcast = r2Both - r2Box;
  const uniqueBox = r2Both - r2Statcast;
  return {
    r2Box, r2Statcast, r2Both, uniqueBox, uniqueStatcast,
    shared: r2Both - uniqueBox - uniqueStatcast,
    betaBox, betaStatcast,
    fStat: r2Both < 1 ? (uniqueStatcast / ((1 - r2Both) / (n - 3))) : NaN,
    predictorCorr: rBS,
  };
}

/**
 * Two-predictor OLS: how much variance does `add` explain that `base`
 * doesn't? Returns R² for base alone, for both, and the standardized
 * partial coefficient on `add`.
 */
export function incremental(base: number[], add: number[], y: number[]): { r2Base: number; r2Both: number; betaAdd: number } {
  const z = (v: number[]) => { const m = mean(v); const sd = Math.sqrt(mean(v.map(x => (x - m) ** 2))); return sd > 0 ? v.map(x => (x - m) / sd) : v.map(() => 0); };
  const [b, a, t] = [z(base), z(add), z(y)];
  const rbt = corr(b, t), rat = corr(a, t), rba = corr(b, a);
  const r2Base = rbt * rbt;
  const den = 1 - rba * rba;
  if (Math.abs(den) < 1e-9) return { r2Base, r2Both: r2Base, betaAdd: 0 };
  const betaB = (rbt - rat * rba) / den;
  const betaA = (rat - rbt * rba) / den;
  return { r2Base, r2Both: betaB * rbt + betaA * rat, betaAdd: betaA };
}

export interface PairedSample { x: number[]; y: number[]; n: number }

/** Players present in both windows with enough sample, one predictor/target pair. */
export function paired(s: SplitWindows, predictor: string, target: string, minPaBefore: number, minPaAfter: number): PairedSample {
  const x: number[] = [], y: number[] = [];
  for (const [id, a] of s.before) {
    const b = s.after.get(id);
    if (!b || a.pa < minPaBefore || b.pa < minPaAfter) continue;
    const xv = a.m[predictor], yv = b.m[target];
    if (xv == null || yv == null || !Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    x.push(xv); y.push(yv);
  }
  return { x, y, n: x.length };
}
