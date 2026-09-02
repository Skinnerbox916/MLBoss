/** Golden test: retro snapshots vs the LIVE snapshots captured the morning of
 *  the same date (lead 0), player by player, stat by stat.
 *    npx tsx scripts/retro-compare.ts 2026-08-09
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

function stats(pairs: [number, number][]) {
  const n = pairs.length; if (!n) return null;
  const d = pairs.map(([r, l]) => r - l);
  const mean = d.reduce((a, b) => a + b, 0) / n, mad = d.reduce((a, b) => a + Math.abs(b), 0) / n;
  const mr = pairs.reduce((a, p) => a + p[0], 0) / n, ml = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [r, l] of pairs) { sxy += (r - mr) * (l - ml); sxx += (r - mr) ** 2; syy += (l - ml) ** 2; }
  return { n, liveMean: ml, retroMean: mr, meanDiff: mean, mad, corr: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, maxAbs: Math.max(...d.map(Math.abs)) };
}

async function main() {
  const date = process.argv[2]; if (!date) { console.error('usage: retro-compare.ts <date>'); process.exit(2); }
  for (const [live, retro] of [['pitcher-start', 'retro-pitcher-start'], ['batter-day', 'retro-batter-day']] as const) {
    const res = await getDb().execute(sql`
      select l.mlb_id, l.player_name, l.predicted as lp, r.predicted as rp, l.context as lc, r.context as rc
      from forecast_snapshots l join forecast_snapshots r on r.game_date = l.game_date and r.mlb_id = l.mlb_id and r.engine = ${retro}
      where l.game_date = ${date} and l.engine = ${live} and l.lead_days = 0`);
    const rows = res.rows as { mlb_id: number; player_name: string; lp: Record<string, number>; rp: Record<string, number>; lc: Record<string, unknown>; rc: Record<string, unknown> }[];
    const counts = await getDb().execute(sql`select engine, count(*)::int as n from forecast_snapshots where game_date = ${date} and engine in (${live}, ${retro}) and lead_days = 0 group by 1`);
    console.log(`\n=== ${live} vs ${retro} on ${date}: ${(counts.rows as { engine: string; n: number }[]).map(r => `${r.engine}=${r.n}`).join(', ')}; matched players ${rows.length}`);
    const keys = [...new Set(rows.flatMap(r => Object.keys(r.lp)))].filter(k => rows.every(r => typeof r.rp[k] === 'number'));
    console.log(`  ${'stat'.padEnd(8)} ${'n'.padStart(4)} ${'live mean'.padStart(10)} ${'retro mean'.padStart(11)} ${'retro−live'.padStart(11)} ${'mean|diff|'.padStart(11)} ${'corr'.padStart(6)} ${'max|diff|'.padStart(10)}`);
    for (const k of keys) {
      const s = stats(rows.map(r => [r.rp[k], r.lp[k]] as [number, number])); if (!s) continue;
      console.log(`  ${k.padEnd(8)} ${String(s.n).padStart(4)} ${s.liveMean.toFixed(3).padStart(10)} ${s.retroMean.toFixed(3).padStart(11)} ${(s.meanDiff >= 0 ? '+' : '') + s.meanDiff.toFixed(3).padStart(10)} ${s.mad.toFixed(3).padStart(11)} ${s.corr.toFixed(3).padStart(6)} ${s.maxAbs.toFixed(3).padStart(10)}`);
    }
    // context agreement: opposing SP identity + combined modifiers
    if (live === 'batter-day') {
      const sameOpp = rows.filter(r => r.lc.oppSpMlbId != null && r.lc.oppSpMlbId === r.rc.oppSpMlbId).length;
      const liveOpp = rows.filter(r => r.lc.oppSpMlbId != null).length;
      console.log(`  opposing SP identical in ${sameOpp}/${liveOpp} rows where live knew the SP; same lineup spot in ${rows.filter(r => r.lc.spot === r.rc.spot).length}/${rows.length}`);
      for (const k of ['tb', 'hr', 'k']) {
        const s = stats(rows.filter(r => (r.lc.mods as Record<string, number>)?.[k] != null && (r.rc.mods as Record<string, number>)?.[k] != null).map(r => [(r.rc.mods as Record<string, number>)[k], (r.lc.mods as Record<string, number>)[k]] as [number, number]));
        if (s) console.log(`  combined modifier ${k}: live ${s.liveMean.toFixed(3)} retro ${s.retroMean.toFixed(3)} mean|diff| ${s.mad.toFixed(3)} corr ${s.corr.toFixed(3)}`);
      }
    } else {
      const s = stats(rows.filter(r => (r.lc.mults as Record<string, number>)?.opp != null && (r.rc.mults as Record<string, number>)?.opp != null).map(r => [(r.rc.mults as Record<string, number>).opp, (r.lc.mults as Record<string, number>).opp] as [number, number]));
      if (s) console.log(`  opp multiplier: live ${s.liveMean.toFixed(3)} retro ${s.retroMean.toFixed(3)} mean|diff| ${s.mad.toFixed(3)}`);
      const worst = rows.map(r => ({ n: r.player_name, d: (r.rp.k ?? 0) - (r.lp.k ?? 0), lk: r.lp.k, rk: r.rp.k, le: r.lp.era, re: r.rp.era })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5);
      console.log('  largest K deltas:', worst.map(w => `${w.n} K ${w.lk?.toFixed(2)}→${w.rk?.toFixed(2)} ERA ${w.le?.toFixed(2)}→${w.re?.toFixed(2)}`).join(' | '));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
