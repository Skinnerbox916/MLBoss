/** Fit and print the season's Savant xERA↔xwOBA mapping, with a hold-out
 *  check on pitchers the fit didn't see (150+ PA).
 *    npx tsx scripts/retro-xera-mapping.ts [season]
 */
import { fetchXeraMapping, fitXeraMapping, xeraFromXwoba } from '@/lib/retro/xera';
import { externalFetchText } from '@/lib/mlb/client';
import { parseCsv } from '@/lib/retro/statcast';

async function main() {
  const season = Number(process.argv[2] ?? new Date().getFullYear());
  const m = await fetchXeraMapping(season);
  console.log(`season ${season}: n=${m.n}, domain xwOBA ${m.domain[0].toFixed(3)}–${m.domain[1].toFixed(3)}`);
  console.log(`xERA = ${m.coef.map((c, i) => `${c.toFixed(3)}${i ? `·x^${i}` : ''}`).join(' + ')}`);
  console.log(`fit rmse ${m.rmse.toFixed(4)} ERA, max |residual| ${m.maxAbsResidual.toFixed(3)}`);
  for (const x of [0.25, 0.30, 0.32, 0.35, 0.40]) console.log(`  xwOBA ${x.toFixed(3)} → xERA ${xeraFromXwoba(m, x).toFixed(2)}`);
  // Hold-out: fit on even-indexed pitchers, score odd-indexed ones.
  const csv = await externalFetchText(`https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher&year=${season}&position=&team=&min=1&csv=true`, { accept: 'text/csv' });
  const pts = parseCsv(csv.replace(/^﻿/, '')).map(r => ({ xwoba: Number(r.est_woba), xera: Number(r.xera), pa: Number(r.pa) })).filter(p => p.pa >= 50);
  const train = pts.filter((_, i) => i % 2 === 0), test = pts.filter((_, i) => i % 2 === 1);
  const mt = fitXeraMapping(train, season);
  const res = test.map(p => p.xera - xeraFromXwoba(mt, p.xwoba));
  console.log(`hold-out (${test.length} pitchers unseen by the fit): rmse ${Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length).toFixed(4)}, max |res| ${Math.max(...res.map(Math.abs)).toFixed(3)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
