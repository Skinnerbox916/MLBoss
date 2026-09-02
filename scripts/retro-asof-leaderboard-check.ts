/**
 * The definitive as-of check: with the corpus complete through yesterday,
 * the aggregate as of TODAY must reproduce the Savant season leaderboards
 * the engine actually reads (expected_statistics + custom skills + pitch
 * arsenals) — including the fields the date-range summary export can't
 * validate: xERA (via the fitted mapping), xwOBAcon, fastball velocity.
 *
 *   npx tsx scripts/retro-asof-leaderboard-check.ts [asOf=today] [minPA=100]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { pitchersAsOf, battersAsOf } from '@/lib/retro/asOf';
import { fetchXeraMapping } from '@/lib/retro/xera';
import { externalFetchText } from '@/lib/mlb/client';
import { parseCsv } from '@/lib/retro/statcast';

const BASE = 'https://baseballsavant.mlb.com';
const num = (v: string | undefined) => (v == null || v === '' ? null : Number(v));
async function csv(url: string) { return parseCsv((await externalFetchText(url, { accept: 'text/csv' })).replace(/^﻿/, '')); }

function report(label: string, pairs: [number, number, string][], digits = 3) {
  if (!pairs.length) { console.log(`  ${label.padEnd(24)} n=0`); return; }
  const d = pairs.map(([a, b, n]) => ({ ad: Math.abs(a - b), a, b, n })).sort((x, y) => y.ad - x.ad);
  const f = (v: number) => v.toFixed(digits);
  const mad = d.reduce((s, x) => s + x.ad, 0) / d.length;
  console.log(`  ${label.padEnd(24)} n=${String(d.length).padStart(3)} mean|diff| ${f(mad)}  p95 ${f(d[Math.floor(d.length * 0.05)].ad)}  max ${f(d[0].ad)} (${d[0].n}: ours ${f(d[0].a)} vs ${f(d[0].b)})`);
}

async function main() {
  const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const minPa = Number(process.argv[3] ?? 100);
  const season = Number(asOf.slice(0, 4));
  const xera = await fetchXeraMapping(season);
  const [p, b] = await Promise.all([pitchersAsOf(asOf, season, xera), battersAsOf(asOf, season)]);
  console.log(`as of ${asOf}: corpus ${p.coverage.from}..${p.coverage.to}, ${p.coverage.gameDays} game days, season-complete=${p.coverage.seasonComplete}`);

  for (const kind of ['pitcher', 'batter'] as const) {
    const res = kind === 'pitcher' ? p : b;
    const [xs, sk] = await Promise.all([
      csv(`${BASE}/leaderboard/expected_statistics?type=${kind}&year=${season}&position=&team=&min=1&csv=true`),
      csv(`${BASE}/leaderboard/custom?year=${season}&type=${kind}&filter=&min=1&selections=pa,xwobacon,k_percent,bb_percent,hard_hit_percent,whiff_percent,barrel_batted_rate&chart=false&x=pa&y=pa&r=no&chartType=beeswarm&csv=true`),
    ]);
    const skills = new Map(sk.map(r => [Number(r.player_id), r]));
    const P: Record<string, [number, number, string][]> = { pa: [], bip: [], xwoba: [], xera: [], xba: [], xslg: [], woba: [], xwobacon: [], k: [], bb: [], hh: [], whiff: [], barrel: [], velo: [] };
    let missing = 0, ahead = 0, behind = 0;
    for (const r of xs) {
      const id = Number(r.player_id); const pa = Number(r.pa);
      if (!(pa >= minPa)) continue;
      const o = res.rows.get(id) as Record<string, number | null> | undefined;
      if (!o) { missing++; continue; }
      const nm = `${r['last_name, first_name'] ?? r['last_name, first_name'.replace(/\s/g, '')] ?? id}`;
      const push = (k: string, a: number | null | undefined, v: number | null) => { if (a != null && v != null && Number.isFinite(a) && Number.isFinite(v)) P[k].push([a, v, nm]); };
      if (o.pa! > pa) ahead++; if (o.pa! < pa) behind++;
      push('pa', o.pa, pa); push('bip', o.bip, num(r.bip)); push('xwoba', o.xwoba, num(r.est_woba)); push('woba', o.woba, num(r.woba));
      if (kind === 'pitcher') push('xera', o.xera, num(r.xera)); else { push('xba', o.xba, num(r.est_ba)); push('xslg', o.xslg, num(r.est_slg)); }
      const s = skills.get(id);
      if (s) {
        push('xwobacon', o.xwobacon, num(s.xwobacon)); push('k', o.kRate == null ? null : o.kRate * 100, num(s.k_percent)); push('bb', o.bbRate == null ? null : o.bbRate * 100, num(s.bb_percent));
        push('hh', o.hardHitRate == null ? null : o.hardHitRate * 100, num(s.hard_hit_percent));
        if (kind === 'pitcher') { push('whiff', o.whiffPct == null ? null : o.whiffPct * 100, num(s.whiff_percent)); push('barrel', o.barrelPct == null ? null : o.barrelPct * 100, num(s.barrel_batted_rate)); }
      }
    }
    if (kind === 'pitcher') {
      // pitch-arsenals: per-type avg speed + per-type pitch counts (two exports);
      // usage-weight FF/SI/FC exactly as savant.ts does.
      const [speed, usage] = await Promise.all([
        csv(`${BASE}/leaderboard/pitch-arsenals?year=${season}&min=1&type=avg_speed&hand=&csv=true`),
        csv(`${BASE}/leaderboard/pitch-arsenals?year=${season}&min=1&type=n_&hand=&csv=true`),
      ]);
      const useBy = new Map(usage.map(r => [Number(r.pitcher), r]));
      for (const r of speed) {
        const id = Number(r.pitcher); const o = res.rows.get(id) as { avgFastballVelo: number | null; pa: number } | undefined;
        const u = useBy.get(id);
        if (!o || !u || o.pa < minPa || o.avgFastballVelo == null) continue;
        let wsum = 0, n = 0;
        for (const t of ['ff', 'si', 'fc']) {
          const v = num(r[`${t}_avg_speed`]); const c = num(u[`n_${t}`]);
          if (v != null && c != null && c > 0) { wsum += v * c; n += c; }
        }
        if (n > 0) P.velo.push([o.avgFastballVelo, wsum / n, String(r['last_name, first_name'] ?? id)]);
      }
    }
    console.log(`\n${kind}s vs SEASON LEADERBOARDS (min ${minPa} PA): leaderboard rows ${xs.filter(r => Number(r.pa) >= minPa).length}; absent from aggregate ${missing}; PA ahead of leaderboard ${ahead}, behind ${behind}`);
    report('PA', P.pa, 0); report('BIP', P.bip, 0); report('xwOBA', P.xwoba); report('wOBA (actual)', P.woba);
    if (kind === 'pitcher') report('xERA (fitted mapping)', P.xera, 2); else { report('xBA', P.xba); report('xSLG', P.xslg); }
    report('xwOBAcon', P.xwobacon); report('K %', P.k, 1); report('BB %', P.bb, 1); report('hard-hit %', P.hh, 1);
    if (kind === 'pitcher') { report('whiff %', P.whiff, 1); report('barrels/BBE %', P.barrel, 1); report('fastball velo (usage-wtd FF/SI/FC)', P.velo, 2); }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
