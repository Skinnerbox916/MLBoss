/**
 * Check the as-of aggregator against Savant: rows as of <asOf> must equal
 * Savant's per-player summary over [corpus start, asOf − 1] — same numbers,
 * and nothing from asOf or later. Also prints coverage so a partial-season
 * window is never mistaken for season-to-date.
 *
 *   npx tsx scripts/retro-asof-check.ts 2026-08-10 [minPA=50]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { pitchersAsOf, battersAsOf } from '@/lib/retro/asOf';
import { fetchXeraMapping } from '@/lib/retro/xera';
import { externalFetchText } from '@/lib/mlb/client';
import { parseCsv } from '@/lib/retro/statcast';

function summaryUrl(kind: 'batter' | 'pitcher', from: string, to: string, minPa: number): string {
  const q = new URLSearchParams({ all: 'true', hfGT: 'R|', hfSea: `${from.slice(0, 4)}|`, player_type: kind,
    game_date_gt: from, game_date_lt: to, min_pitches: '0', min_results: '0', group_by: 'name', sort_col: 'pitches',
    player_event_sort: 'api_p_release_speed', sort_order: 'desc', min_pas: String(minPa) });
  return `https://baseballsavant.mlb.com/statcast_search/csv?${q.toString()}`;
}
const dayBefore = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

function report(label: string, pairs: [number, number, string][], digits = 3) {
  if (!pairs.length) { console.log(`  ${label.padEnd(26)} n=0`); return; }
  const d = pairs.map(([a, b, n]) => ({ ad: Math.abs(a - b), a, b, n })).sort((x, y) => y.ad - x.ad);
  const mad = d.reduce((s, x) => s + x.ad, 0) / d.length;
  const f = (v: number) => v.toFixed(digits);
  console.log(`  ${label.padEnd(26)} n=${String(d.length).padStart(3)} mean|diff| ${f(mad)}  p95 ${f(d[Math.floor(d.length * 0.05)].ad)}  max ${f(d[0].ad)} (${d[0].n}: ${f(d[0].a)} vs ${f(d[0].b)})`);
}

async function main() {
  const asOf = process.argv[2]; const minPa = Number(process.argv[3] ?? 50);
  if (!asOf) { console.error('usage: retro-asof-check.ts <asOf YYYY-MM-DD> [minPA]'); process.exit(2); }
  const season = Number(asOf.slice(0, 4));
  const xera = await fetchXeraMapping(season);
  const [p, b] = await Promise.all([pitchersAsOf(asOf, season, xera), battersAsOf(asOf, season)]);
  console.log(`as of ${asOf}: window ${p.coverage.from}..${p.coverage.to} (${p.coverage.gameDays} game days), season-complete=${p.coverage.seasonComplete}; ${p.rows.size} pitchers, ${b.rows.size} batters`);
  if (!p.coverage.from) process.exit(1);
  const to = dayBefore(asOf);
  const num = (v: string) => (v === '' || v == null ? null : Number(v));
  for (const [kind, res] of [['pitcher', p], ['batter', b]] as const) {
    const csv = await externalFetchText(summaryUrl(kind, p.coverage.from, to, minPa), { accept: 'text/csv' });
    const sav = parseCsv(csv.replace(/^﻿/, ''));
    console.log(`\n${kind}s vs Savant summary ${p.coverage.from}..${to} (min ${minPa} PA): ${sav.length} Savant rows`);
    const P: Record<string, [number, number, string][]> = { pa: [], xwoba: [], xba: [], xslg: [], k: [], bb: [], hh: [], whiff: [], barrel: [], rv100: [] };
    let missing = 0, leaked = 0;
    for (const s of sav) {
      const id = Number(s.player_id); const o = res.rows.get(id) as Record<string, number | null> | undefined;
      if (!o) { missing++; continue; }
      const nm = s.player_name;
      const push = (k: string, a: number | null | undefined, b: number | null) => { if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) P[k].push([a, b, nm]); };
      push('pa', o.pa, num(s.pa)); if (o.pa! > Number(s.pa)) leaked++;
      push('xwoba', o.xwoba, num(s.xwoba)); push('xba', o.xba, num(s.xba)); push('xslg', o.xslg, num(s.xslg));
      push('k', o.kRate == null ? null : o.kRate * 100, num(s.k_percent)); push('bb', o.bbRate == null ? null : o.bbRate * 100, num(s.bb_percent));
      push('hh', o.hardHitRate == null ? null : o.hardHitRate * 100, num(s.hardhit_percent));
      if (kind === 'pitcher') {
        push('whiff', o.whiffPct == null ? null : o.whiffPct * 100, num(s.swing_miss_percent));
        push('barrel', o.barrelPct == null ? null : o.barrelPct * 100, num(s.barrels_per_bbe_percent));
        push('rv100', o.runValuePer100, num(s.batter_run_value_per_100));
      }
    }
    console.log(`  Savant players absent from aggregate: ${missing}; players with MORE PA than Savant's window (leak check): ${leaked}`);
    report('PA', P.pa, 0); report('xwOBA', P.xwoba); report('xBA', P.xba); report('xSLG', P.xslg);
    report('K %', P.k, 1); report('BB %', P.bb, 1); report('hard-hit %', P.hh, 1);
    if (kind === 'pitcher') { report('whiff %', P.whiff, 1); report('barrels/BBE %', P.barrel, 1); report('run value /100 pitches', P.rv100, 2);
      const xe = [...res.rows.values()].filter(r => r.pa >= 150).map(r => (r as { xera: number | null }).xera).filter((v): v is number => v != null).sort((a, b) => a - b);
      console.log(`  xERA (150+ PA, n=${xe.length}): min ${xe[0]?.toFixed(2)} median ${xe[Math.floor(xe.length / 2)]?.toFixed(2)} max ${xe[xe.length - 1]?.toFixed(2)}`);
      const fb = [...res.rows.values()].filter(r => r.pa >= 150).map(r => (r as { avgFastballVelo: number | null }).avgFastballVelo).filter((v): v is number => v != null).sort((a, b) => a - b);
      console.log(`  fastball velo (150+ PA): min ${fb[0]?.toFixed(1)} median ${fb[Math.floor(fb.length / 2)]?.toFixed(1)} max ${fb[fb.length - 1]?.toFixed(1)}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
