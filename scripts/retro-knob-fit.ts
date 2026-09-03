/**
 * Per-knob calibration fit over the retro cohort.
 *
 * The scorecard can say "the matchup layer is over-scaled" but not which
 * knob, because a snapshot's combined modifier is one number. Snapshots now
 * carry the decomposition (`context.knobs.<knob>.<stat>`), so this fits
 *
 *   actual ~ Poisson( exp( a + b·log(neutral) + Σ c_k·log(knob_k) ) )
 *
 * where `neutral` is the talent-only expected count (predicted ÷ combined
 * modifier). A perfectly calibrated engine gives b = 1 and every c_k = 1.
 * c_k < 1 means that knob is applied too hard: the engine moves the forecast
 * further than the outcomes justify, and the fitted value is the fraction of
 * the current swing that the data actually supports.
 *
 * IDENTIFIABILITY: the batter decomposition works because each knob applies
 * a DIFFERENT multiplier per stat, so the columns vary independently. The
 * pitcher side stores one multiplier per knob for the whole start
 * (`context.mults`), which makes `platoon` and `opp` near-collinear — their
 * fitted coefficients come back with standard errors of ±10 or worse and
 * must not be read. Only the pitcher talent slope and `bullpen` are usable
 * at present; separating the rest needs per-stat pitcher attribution.
 *
 *   npx tsx scripts/retro-knob-fit.ts [engine=retro-batter-day] [minRows=500]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

const STATS = ['tb', 'h', 'hr', 'r', 'rbi', 'k', 'bb', 'sb', 'ip', 'er', 'pa'];
const KNOBS = ['pitcher', 'park', 'weather', 'order', 'platoon', 'hand', 'teamSb', 'opp', 'velocity', 'bullpen'];

/** Poisson IRLS with an arbitrary design matrix; returns coefficients + SEs. */
function poissonFit(X: number[][], y: number[]): { beta: number[]; se: number[] } | null {
  const k = X[0].length;
  let beta = new Array(k).fill(0);
  beta[0] = Math.log(Math.max(y.reduce((a, b) => a + b, 0) / y.length, 1e-3));
  for (let iter = 0; iter < 60; iter++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      const eta = X[i].reduce((s, v, j) => s + v * beta[j], 0);
      const mu = Math.exp(Math.min(eta, 20));
      const r = y[i] - mu;
      for (let a = 0; a < k; a++) {
        g[a] += r * X[i][a];
        for (let b = 0; b < k; b++) H[a][b] += mu * X[i][a] * X[i][b];
      }
    }
    const step = solve(H, g);
    if (!step) return null;
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  const H = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const row of X) {
    const mu = Math.exp(Math.min(row.reduce((s, v, j) => s + v * beta[j], 0), 20));
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) H[a][b] += mu * row[a] * row[b];
  }
  const inv = invert(H);
  return inv ? { beta, se: inv.map((r, i) => Math.sqrt(Math.abs(r[i]))) } : null;
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) { if (r === i) continue; const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function invert(A: number[][]): number[][] | null {
  const n = A.length, cols: number[][] = [];
  for (let j = 0; j < n; j++) { const e = new Array(n).fill(0); e[j] = 1; const c = solve(A, e); if (!c) return null; cols.push(c); }
  return Array.from({ length: n }, (_, i) => cols.map(c => c[i]));
}

async function main() {
  const engine = process.argv[2] ?? 'retro-batter-day';
  const minRows = Number(process.argv[3] ?? 500);
  // Optional slice: 'home' / 'away'. The park knob is the reason this exists —
  // a talent baseline built from season stats already contains roughly half
  // that player's home park, so applying the full park factor at home
  // double-counts it. If that is what is happening, the fitted park
  // coefficient should sit near 1.0 on the road and well below it at home.
  const slice = process.argv[4] as 'home' | 'away' | undefined;
  const res = await getDb().execute(sql`
    select s.predicted, s.context, a.batting, a.pitching
    from forecast_snapshots s join player_game_actuals a on a.game_date = s.game_date and a.mlb_id = s.mlb_id
    where s.engine = ${engine} and a.status = 'played'
      and (case when ${engine} like '%batter%' then a.batting is not null else a.pitching is not null end)`);
  let rows = res.rows as { predicted: Record<string, number>; context: Record<string, unknown>; batting: Record<string, number> | null; pitching: Record<string, number> | null }[];
  if (slice) rows = rows.filter(r => (r.context.isHome === true) === (slice === 'home'));
  console.log(`${engine}${slice ? ` [${slice}]` : ''}: ${rows.length} graded rows\n`);
  console.log(`  a knob coefficient of 1.00 means correctly scaled; 0.50 means only half the applied swing is justified\n`);

  for (const stat of STATS) {
    const knobsFor = KNOBS.filter(k => {
      let seen = 0;
      for (const r of rows) {
        const kn = (r.context.knobs as Record<string, Record<string, number>> | undefined)?.[k]?.[stat]
          ?? (r.context.mults as Record<string, number> | undefined)?.[k];
        if (kn != null) seen++;
      }
      return seen >= rows.length * 0.9;
    });
    const X: number[][] = [], y: number[] = [];
    for (const r of rows) {
      const act = (r.batting ?? r.pitching)?.[stat];
      const pred = r.predicted[stat];
      const mults = r.context.mults as Record<string, number> | undefined;
      const mods = (r.context.mods as Record<string, number> | undefined)?.[stat]
        ?? (mults ? Object.values(mults).reduce((a, v) => a * v, 1) : undefined);
      // Batter snapshots decompose per stat (context.knobs.<knob>.<stat>);
      // pitcher snapshots carry one multiplier per knob for the whole start
      // (context.mults.<knob>), which applies to every stat alike.
      const kn = (r.context.knobs as Record<string, Record<string, number>> | undefined)
        ?? (r.context.mults ? Object.fromEntries(Object.entries(r.context.mults as Record<string, number>).map(([k, v]) => [k, { [stat]: v }])) : undefined);
      if (act == null || pred == null || mods == null || !kn || pred <= 0 || mods <= 0) continue;
      const neutral = pred / mods;
      if (!(neutral > 0)) continue;
      const row = [1, Math.log(neutral), ...knobsFor.map(k => Math.log(kn[k]?.[stat] ?? 1))];
      if (row.some(v => !Number.isFinite(v))) continue;
      X.push(row); y.push(act);
    }
    // Drop knobs with (near) no variance in this sample: a column of
    // identical log-multipliers is collinear with the intercept and makes
    // the information matrix singular.
    const keep: number[] = [];
    for (let j = 0; j < knobsFor.length; j++) {
      const col = X.map(r => r[j + 2]);
      const m = col.reduce((a, b) => a + b, 0) / col.length;
      const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length);
      if (sd > 1e-6) keep.push(j);
    }
    const dropped = knobsFor.filter((_, j) => !keep.includes(j));
    const usedKnobs = keep.map(j => knobsFor[j]);
    const Xk = X.map(r => [r[0], r[1], ...keep.map(j => r[j + 2])]);
    if (Xk.length < minRows || usedKnobs.length === 0) { console.log(`  ${stat.padEnd(4)} n=${Xk.length} (skipped${dropped.length ? `; constant: ${dropped.join(',')}` : ''})`); continue; }
    const fit = poissonFit(Xk, y);
    if (!fit) { console.log(`  ${stat.padEnd(4)} fit failed`); continue; }
    const parts = usedKnobs.map((k, i) => {
      const c = fit.beta[i + 2], se = fit.se[i + 2];
      const flag = Math.abs(c - 1) > 1.96 * se ? '*' : ' ';
      return `${k} ${c.toFixed(2)}±${se.toFixed(2)}${flag}`;
    });
    console.log(`  ${stat.padEnd(4)} n=${String(Xk.length).padStart(6)}  talent ${fit.beta[1].toFixed(2)}±${fit.se[1].toFixed(2)}  │ ${parts.join('  ')}${dropped.length ? `  (constant, dropped: ${dropped.join(',')})` : ''}`);
  }
  console.log(`\n  * = differs from 1.00 at p<0.05`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
