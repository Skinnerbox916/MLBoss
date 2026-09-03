/**
 * How does Statcast SUPPLEMENT the box score?
 *
 * The two are not rivals: they overlap, and each carries signal the other
 * doesn't. So for each forward-looking question this splits the explained
 * variance in next-window performance three ways — what only the box score
 * knows, what only the batted-ball measurement knows, and what both encode —
 * and tests whether the Statcast term is a real addition to a model that
 * already has the traditional one.
 *
 *   npx tsx scripts/retro-statcast-value.ts [split=2026-06-20] [minPA=120]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { buildSplit, paired, commonality } from '@/lib/retro/predictiveness';

/** [target, box-score predictor, statcast predictor, label] */
const QUESTIONS: [string, string, string, string][] = [
  ['woba', 'woba', 'xwoba', 'overall value  → next wOBA'],
  ['avg', 'avg', 'xba', 'hit frequency  → next AVG'],
  ['tbPerPa', 'slg', 'xwobacon', 'power output   → next TB/PA'],
  ['tbPerPa', 'tbPerPa', 'hardHitPct', 'contact qual.  → next TB/PA'],
  ['hrPerPa', 'hrPerPa', 'barrelPerPa', 'home runs      → next HR/PA'],
  ['kPerPa', 'kPerPa', 'whiffPct', 'strikeouts     → next K/PA'],
];

const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(6);
/** p-value for F(1, df) via a Wilson–Hilferty style normal approximation. */
function pFromF(f: number, df: number): number {
  if (!Number.isFinite(f) || f <= 0) return 1;
  const t = Math.sqrt(f); // F(1,df) = t²
  const x = t * (1 - 1 / (4 * df)) / Math.sqrt(1 + t * t / (2 * df));
  return 2 * (1 - 0.5 * (1 + erf(x / Math.SQRT2)));
}
function erf(x: number): number {
  const s = Math.sign(x); x = Math.abs(x);
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429], p = 0.3275911;
  const t = 1 / (1 + p * x);
  return s * (1 - ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-x * x));
}

async function main() {
  const split = process.argv[2] ?? '2026-06-20';
  const minPa = Number(process.argv[3] ?? 120);
  const season = Number(split.slice(0, 4));
  const bounds = await getDb().execute(sql`select min(game_date)::text as f, max(game_date)::text as t, count(distinct game_date)::int as d from statcast_events where game_date >= ${`${season}-01-01`}`);
  const b = bounds.rows[0] as { f: string; t: string; d: number };
  const end = new Date(`${b.t}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  console.log(`corpus ${b.f}..${b.t} (${b.d} game days) · split ${split} · ≥${minPa} PA each side`);
  console.log(`variance in NEXT-window performance explained by WINDOW-A metrics\n`);

  for (const kind of ['batter', 'pitcher'] as const) {
    const s = await buildSplit(kind, season, split, b.f, end.toISOString().slice(0, 10));
    console.log(`\n=================== ${kind.toUpperCase()}S ===================`);
    console.log(`${'question'.padEnd(28)} ${'n'.padStart(4)} ${'box'.padStart(7)} ${'+SC'.padStart(7)} ${'│ only box'.padStart(10)} ${'shared'.padStart(7)} ${'only SC'.padStart(8)} ${'│ SC share'.padStart(10)}  ${'F'.padStart(6)}   p`);
    for (const [target, box, sc, label] of QUESTIONS) {
      const bx = paired(s, box, target, minPa, minPa);
      const st = paired(s, sc, target, minPa, minPa);
      if (bx.n < 25 || st.n !== bx.n) { console.log(`${label.padEnd(28)} ${String(bx.n).padStart(4)}  (insufficient sample)`); continue; }
      const c = commonality(bx.x, st.x, bx.y);
      const p = pFromF(c.fStat, bx.n - 3);
      const share = c.r2Both > 0 ? c.uniqueStatcast / c.r2Both : 0;
      const stars = p < 0.01 ? '**' : p < 0.05 ? '* ' : '  ';
      console.log(
        `${label.padEnd(28)} ${String(bx.n).padStart(4)} ${pct(c.r2Box)} ${pct(c.r2Both)} │${pct(c.uniqueBox)} ${pct(c.shared)} ${pct(c.uniqueStatcast)} │${pct(share)}  ${c.fStat.toFixed(1).padStart(6)} ${p < 0.001 ? '<.001' : p.toFixed(3)}${stars}`,
      );
    }
    console.log(`  (box = box-score metric alone; +SC = both together; the three middle columns partition that total)`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
