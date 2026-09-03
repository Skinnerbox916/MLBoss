/**
 * Does Statcast predict the future better than the box score?
 *
 * Splits the season, then for players with enough sample on both sides asks:
 * given window-A metrics, which best forecasts window-B performance? Runs
 * head-to-head pairs (the Statcast metric vs its traditional counterpart)
 * and an incremental test (does the Statcast metric add signal on top?).
 *
 *   npx tsx scripts/retro-statcast-predictiveness.ts [split=2026-06-20] [minPA=150]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { buildSplit, paired, corr, incremental, williamsT } from '@/lib/retro/predictiveness';

/** [target, statcast predictor, traditional predictor, label] */
const MATCHUPS: [string, string, string, string][] = [
  ['woba', 'xwoba', 'woba', 'overall value (next-window wOBA)'],
  ['tbPerPa', 'xwobacon', 'slg', 'power output (next-window TB/PA)'],
  ['hrPerPa', 'barrelPerPa', 'hrPerPa', 'home runs (next-window HR/PA)'],
  ['kPerPa', 'whiffPct', 'kPerPa', 'strikeouts (next-window K/PA)'],
  ['avg', 'xba', 'avg', 'batting average (next-window AVG)'],
  ['tbPerPa', 'hardHitPct', 'tbPerPa', 'contact quality (next-window TB/PA)'],
];

function fmt(r: number) { return (r >= 0 ? ' ' : '') + r.toFixed(3); }

async function main() {
  const split = process.argv[2] ?? '2026-06-20';
  const minPa = Number(process.argv[3] ?? 150);
  const season = Number(split.slice(0, 4));
  const bounds = await getDb().execute(sql`select min(game_date)::text as f, max(game_date)::text as t, count(distinct game_date)::int as d from statcast_events where game_date >= ${`${season}-01-01`}`);
  const b = bounds.rows[0] as { f: string; t: string; d: number };
  const end = new Date(`${b.t}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  console.log(`corpus ${b.f}..${b.t} (${b.d} game days); split at ${split}; min ${minPa} PA each side\n`);

  for (const kind of ['batter', 'pitcher'] as const) {
    const s = await buildSplit(kind, season, split, b.f, end.toISOString().slice(0, 10));
    console.log(`\n================ ${kind.toUpperCase()}S  (before: ${s.before.size} players, after: ${s.after.size}) ================`);
      console.log(`${'question'.padEnd(38)} ${'n'.padStart(4)}  ${'statcast'.padStart(20)}  ${'traditional'.padStart(20)}  edge  Williams t   incremental R²   (* p<.05, ** p<.01)`);
    for (const [target, sc, trad, label] of MATCHUPS) {
      const a = paired(s, sc, target, minPa, minPa);
      const t = paired(s, trad, target, minPa, minPa);
      if (a.n < 20 || t.n !== a.n) { console.log(`${label.padEnd(38)} ${String(a.n).padStart(4)}  (insufficient)`); continue; }
      const rSc = corr(a.x, a.y), rTr = corr(t.x, t.y);
      const inc = incremental(t.x, a.x, a.y);
      const edge = rSc - rTr;
      const tw = williamsT(rSc, rTr, corr(a.x, t.x), a.n);
      const sig = Math.abs(tw) > 2.58 ? '**' : Math.abs(tw) > 1.96 ? '* ' : '  ';
      console.log(
        `${label.padEnd(38)} ${String(a.n).padStart(4)}  ${sc.padStart(12)} ${fmt(rSc)}  ${trad.padStart(12)} ${fmt(rTr)}  ${fmt(edge)}${sig}t=${tw.toFixed(2).padStart(6)}` +
        `  ${(inc.r2Base * 100).toFixed(1)}%→${(inc.r2Both * 100).toFixed(1)}% (β ${fmt(inc.betaAdd)})`,
      );
    }
    // How the edge depends on how much sample the metric has had — this is
    // what prior strength in the talent model is really calibrating.
    console.log(`\n  sample-size dependence — next-window wOBA, by window-A PA:`);
    for (const [lo, hi] of [[minPa, 250], [250, 400], [400, 10000]] as [number, number][]) {
      const xs: number[] = [], ts: number[] = [], ys: number[] = [];
      for (const [id, a] of s.before) {
        const bb = s.after.get(id);
        if (!bb || a.pa < lo || a.pa >= hi || bb.pa < minPa) continue;
        const xv = a.m.xwoba, tv = a.m.woba, yv = bb.m.woba;
        if (xv == null || tv == null || yv == null) continue;
        xs.push(xv); ts.push(tv); ys.push(yv);
      }
      if (xs.length < 20) { console.log(`    ${lo}–${hi === 10000 ? '∞' : hi} PA: n=${xs.length} (too few)`); continue; }
      console.log(`    ${String(lo).padStart(4)}–${(hi === 10000 ? '∞' : String(hi)).padEnd(4)} PA: n=${String(xs.length).padStart(3)}  xwOBA ${fmt(corr(xs, ys))}  wOBA ${fmt(corr(ts, ys))}  edge ${fmt(corr(xs, ys) - corr(ts, ys))}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
