/**
 * Rigor pass on the Statcast-contribution study.
 *
 *  1. OUT-OF-SAMPLE. In-sample R² only ever rises when a predictor is added,
 *     so every headline number is re-scored by 5-fold cross-validation.
 *  2. UNDERFIT CHECK. One metric per family understates what the family
 *     carries, so each side is also fitted as a multi-metric family.
 *  3. POWER. For every incremental test: the power it had against the effect
 *     observed, and the smallest effect it could have detected at 80%.
 *  4. MULTIPLICITY. Benjamini–Hochberg across the whole family of tests.
 *  5. WEIGHTING. Repeated on the ≥250 PA subset, where the window-A metrics
 *     are themselves less noisy.
 *
 *   npx tsx scripts/retro-statcast-rigor.ts [split=2026-06-20] [minPA=120]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { buildSplit, commonality, type SplitWindows } from '@/lib/retro/predictiveness';
import { cvR2, inSampleR2, adjR2, pFromF1, powerOfIncrement, benjaminiHochberg } from '@/lib/retro/fitEval';

const QUESTIONS: [string, string, string, string][] = [
  ['woba', 'woba', 'xwoba', 'value → wOBA'],
  ['avg', 'avg', 'xba', 'hits → AVG'],
  ['tbPerPa', 'slg', 'xwobacon', 'power → TB/PA'],
  ['tbPerPa', 'tbPerPa', 'hardHitPct', 'contact → TB/PA'],
  ['hrPerPa', 'hrPerPa', 'barrelPerPa', 'HR → HR/PA'],
  ['kPerPa', 'kPerPa', 'whiffPct', 'K → K/PA'],
];
const BOX_FAMILY = ['woba', 'kPerPa', 'bbPerPa', 'hrPerPa'];
const SC_FAMILY = ['xwoba', 'whiffPct', 'hardHitPct', 'barrelPerPa'];

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '   n/a').padStart(7);

/** Rows where every named metric is present on both sides. */
function matrix(s: SplitWindows, preds: string[], target: string, minPa: number, maxPa = Infinity) {
  const X: number[][] = [], y: number[] = [];
  for (const [id, a] of s.before) {
    const b = s.after.get(id);
    if (!b || a.pa < minPa || a.pa >= maxPa || b.pa < minPa) continue;
    const row = preds.map(p => a.m[p]);
    const t = b.m[target];
    if (t == null || row.some(v => v == null || !Number.isFinite(v))) continue;
    X.push(row as number[]); y.push(t);
  }
  return { X, y };
}

async function main() {
  const split = process.argv[2] ?? '2026-06-20';
  const minPa = Number(process.argv[3] ?? 120);
  const season = Number(split.slice(0, 4));
  const b = (await getDb().execute(sql`select min(game_date)::text as f, max(game_date)::text as t from statcast_events where game_date >= ${`${season}-01-01`}`)).rows[0] as { f: string; t: string };
  const end = new Date(`${b.t}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  console.log(`split ${split} · ≥${minPa} PA each side · corpus ${b.f}..${b.t}`);

  const tests: { key: string; p: number }[] = [];
  const lines: string[] = [];

  for (const kind of ['batter', 'pitcher'] as const) {
    const s = await buildSplit(kind, season, split, b.f, end.toISOString().slice(0, 10));
    lines.push(`\n================= ${kind.toUpperCase()}S =================`);
    lines.push(`${'question'.padEnd(17)} ${'n'.padStart(4)} │ in-sample box→both │ CROSS-VALIDATED box / SC / both │ ΔR²    power   MDE@80%   raw p`);
    for (const [target, box, sc, label] of QUESTIONS) {
      const m = matrix(s, [box, sc], target, minPa);
      if (m.y.length < 30) { lines.push(`${label.padEnd(17)} ${String(m.y.length).padStart(4)} │ (insufficient)`); continue; }
      const n = m.y.length;
      const Xb = m.X.map(r => [r[0]]), Xs = m.X.map(r => [r[1]]);
      const c = commonality(Xb.map(r => r[0]), Xs.map(r => r[0]), m.y);
      const cvB = cvR2(Xb, m.y), cvS = cvR2(Xs, m.y), cvBoth = cvR2(m.X, m.y);
      const pw = powerOfIncrement(c.uniqueStatcast, c.r2Both, n);
      const p = pFromF1(c.fStat, n - 3);
      tests.push({ key: `${kind}:${label}`, p });
      lines.push(
        `${label.padEnd(17)} ${String(n).padStart(4)} │ ${pct(c.r2Box)}→${pct(c.r2Both)}  │ ${pct(cvB)} ${pct(cvS)} ${pct(cvBoth)} │ ${pct(c.uniqueStatcast)} ${pw.power.toFixed(2).padStart(5)}  ${pct(pw.mdeDeltaR2)}  ${p < 0.001 ? '<.001' : p.toFixed(3)}`,
      );
    }
    // Underfit check: whole families, cross-validated.
    const fam = matrix(s, [...BOX_FAMILY, ...SC_FAMILY], 'woba', minPa);
    if (fam.y.length >= 40) {
      const nb = BOX_FAMILY.length;
      const Xb = fam.X.map(r => r.slice(0, nb)), Xs = fam.X.map(r => r.slice(nb)), n = fam.y.length;
      const isBoth = inSampleR2(fam.X, fam.y);
      lines.push(`\n  multi-metric families → next wOBA (n=${n}, ${nb}+${SC_FAMILY.length} predictors)`);
      lines.push(`    in-sample  box ${pct(inSampleR2(Xb, fam.y))}  SC ${pct(inSampleR2(Xs, fam.y))}  both ${pct(isBoth)}  (adj both ${pct(adjR2(isBoth, n, fam.X[0].length))})`);
      lines.push(`    5-fold CV  box ${pct(cvR2(Xb, fam.y))}  SC ${pct(cvR2(Xs, fam.y))}  both ${pct(cvR2(fam.X, fam.y))}   ← negative = no transferable signal`);
    }
    // Cleaner-sample robustness.
    const hi = matrix(s, ['woba', 'xwoba'], 'woba', 250);
    if (hi.y.length >= 40) {
      const c = commonality(hi.X.map(r => r[0]), hi.X.map(r => r[1]), hi.y);
      const pw = powerOfIncrement(c.uniqueStatcast, c.r2Both, hi.y.length);
      lines.push(`  ≥250 PA subset → next wOBA: n=${hi.y.length}  box ${pct(c.r2Box)} both ${pct(c.r2Both)} uniqueSC ${pct(c.uniqueStatcast)} power ${pw.power.toFixed(2)} CV both ${pct(cvR2(hi.X, hi.y))}`);
    }
  }
  console.log(lines.join('\n'));
  const adj = benjaminiHochberg(tests.map(t => t.p));
  console.log(`\n=== Benjamini–Hochberg across all ${tests.length} incremental tests (FDR 5%) ===`);
  tests.forEach((t, i) => console.log(`  ${t.key.padEnd(30)} raw p ${(t.p < 0.001 ? '<.001' : t.p.toFixed(3)).padStart(6)}  FDR-adj ${(adj[i] < 0.001 ? '<.001' : adj[i].toFixed(3)).padStart(6)}  ${adj[i] < 0.05 ? 'SURVIVES' : '—'}`));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
