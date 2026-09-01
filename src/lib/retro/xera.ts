/**
 * Retro corpus — Savant xERA mapping.
 *
 * Savant's xERA is "xwOBA translated to the ERA scale"; the formula isn't
 * published, but on the 2026 pitcher expected_statistics leaderboard xERA
 * is a smooth function of xwOBA alone (a cubic fits to rmse 0.004 ERA on
 * pitchers with ≥50 PA; residuals are uncorrelated with PA, xSLG, xBA).
 * The scale is tied to a season's run environment, so the mapping is
 * fit from that season's leaderboard rather than hard-coded. The retro
 * pipeline applies it to as-of xwOBA rebuilt from `statcast_events` to
 * recover the xERA input the pitcher talent layer reads
 * (src/lib/mlb/savant.ts). Not imported by engine code.
 */

import { externalFetchText } from '@/lib/mlb/client';
import { parseCsv } from './statcast';

export interface XeraMapping {
  season: number;
  /** Polynomial coefficients, lowest order first: xERA = c0 + c1·x + c2·x² + c3·x³. */
  coef: [number, number, number, number];
  /** Fit domain — outside it the cubic is extrapolating. */
  domain: [number, number];
  n: number;
  rmse: number;
  maxAbsResidual: number;
}

export interface XeraPoint { xwoba: number; xera: number; pa: number }

/** Solve the normal equations for a small least-squares polynomial fit. */
function polyfit(xs: number[], ys: number[], degree: number): number[] {
  const k = degree + 1;
  const A: number[][] = Array.from({ length: k }, () => Array(k + 1).fill(0));
  for (let i = 0; i < xs.length; i++) {
    const pow = Array.from({ length: 2 * k }, (_, p) => xs[i] ** p);
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a][b] += pow[a + b];
      A[a][k] += pow[a] * ys[i];
    }
  }
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

/** Fit the season mapping from (xwOBA, xERA, PA) leaderboard rows. Pure. */
export function fitXeraMapping(points: XeraPoint[], season: number, minPa = 50): XeraMapping {
  const pts = points.filter(p => p.pa >= minPa && Number.isFinite(p.xwoba) && Number.isFinite(p.xera));
  if (pts.length < 20) throw new Error(`fitXeraMapping: only ${pts.length} pitchers with PA ≥ ${minPa}`);
  const xs = pts.map(p => p.xwoba);
  const ys = pts.map(p => p.xera);
  const coef = polyfit(xs, ys, 3) as [number, number, number, number];
  const pred = (x: number) => coef[0] + coef[1] * x + coef[2] * x * x + coef[3] * x * x * x;
  const res = pts.map(p => p.xera - pred(p.xwoba));
  return {
    season, coef,
    domain: [Math.min(...xs), Math.max(...xs)],
    n: pts.length,
    rmse: Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length),
    maxAbsResidual: Math.max(...res.map(Math.abs)),
  };
}

/** xERA for an xwOBA under a fitted mapping (clamped to the fit domain —
 *  a cubic explodes outside it, and a thin-sample as-of xwOBA can sit there). */
export function xeraFromXwoba(m: XeraMapping, xwoba: number): number {
  const x = Math.min(m.domain[1], Math.max(m.domain[0], xwoba));
  const [c0, c1, c2, c3] = m.coef;
  return c0 + c1 * x + c2 * x * x + c3 * x * x * x;
}

/** Fetch the season's pitcher expected_statistics leaderboard and fit. */
export async function fetchXeraMapping(season: number): Promise<XeraMapping> {
  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher&year=${season}&position=&team=&min=1&csv=true`;
  const csv = await externalFetchText(url, { accept: 'text/csv' });
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  const pts: XeraPoint[] = rows
    .map(r => ({ xwoba: Number(r.est_woba), xera: Number(r.xera), pa: Number(r.pa) }))
    .filter(p => Number.isFinite(p.xwoba) && Number.isFinite(p.xera) && Number.isFinite(p.pa));
  return fitXeraMapping(pts, season);
}
