/**
 * Recover Savant's leaderboard wOBA linear weights for a season by least
 * squares: leaderboard wOBA × (AB + uBB + SF + HBP) = Σ w_e · count_e over
 * batters with ≥100 PA, counts from the corpus as of today. Paste the result
 * into WOBA_WEIGHTS in src/lib/retro/asOf.ts at season end (or when the
 * leaderboard check's wOBA row drifts). Requires the corpus through yesterday.
 *
 *   npx tsx scripts/retro-woba-weights.ts [season]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { externalFetchText } from '@/lib/mlb/client';
import { parseCsv } from '@/lib/retro/statcast';

function solve(A: number[][], b: number[]): number[] {
  const n = A.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let r = 0; r < n; r++) { if (r === i) continue; const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

async function main() {
  const season = Number(process.argv[2] ?? new Date().getFullYear());
  const lb = parseCsv((await externalFetchText(`https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${season}&position=&team=&min=1&csv=true`, { accept: 'text/csv' })).replace(/^﻿/, ''));
  const res = await getDb().execute(sql`
    select batter as id,
      count(*) filter (where events = 'walk')::int as ubb, count(*) filter (where events = 'hit_by_pitch')::int as hbp,
      count(*) filter (where events = 'single')::int as s1, count(*) filter (where events = 'double')::int as s2,
      count(*) filter (where events = 'triple')::int as s3, count(*) filter (where events = 'home_run')::int as hr,
      count(*) filter (where events in ('sac_fly','sac_fly_double_play'))::int as sf,
      count(*) filter (where events is not null and events not in ('truncated_pa','walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','catcher_interf','sac_fly_double_play','sac_bunt_double_play'))::int as ab
    from statcast_events where game_date >= ${`${season}-01-01`} group by 1`);
  const counts = new Map((res.rows as Record<string, unknown>[]).map(r => [Number(r.id), r]));
  const X: number[][] = []; const y: number[] = []; const rows: { c: number[]; d: number; w: number }[] = [];
  for (const r of lb) {
    const id = Number(r.player_id); const c = counts.get(id); const w = Number(r.woba);
    if (!c || !(Number(r.pa) >= 100) || !Number.isFinite(w)) continue;
    const v = ['ubb', 'hbp', 's1', 's2', 's3', 'hr'].map(k => Number(c[k]));
    const d = Number(c.ab) + Number(c.ubb) + Number(c.sf) + Number(c.hbp);
    X.push(v); y.push(w * d); rows.push({ c: v, d, w });
  }
  const k = 6;
  const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => X.reduce((s, x) => s + x[a] * x[b], 0)));
  const B = Array.from({ length: k }, (_, a) => X.reduce((s, x, i) => s + x[a] * y[i], 0));
  const wts = solve(A, B);
  const resid = rows.map(r => Math.abs(r.c.reduce((s, v, i) => s + v * wts[i], 0) / r.d - r.w)).sort((a, b) => a - b);
  console.log(`season ${season}: n=${rows.length} batters (≥100 PA)`);
  console.log(`  ${season}: { ubb: ${wts[0].toFixed(3)}, hbp: ${wts[1].toFixed(3)}, s1: ${wts[2].toFixed(3)}, s2: ${wts[3].toFixed(3)}, s3: ${wts[4].toFixed(3)}, hr: ${wts[5].toFixed(3)} },`);
  console.log(`  residual vs leaderboard wOBA: mean ${(resid.reduce((s, v) => s + v, 0) / resid.length).toFixed(4)}, p95 ${resid[Math.floor(resid.length * 0.95)].toFixed(4)}, max ${resid[resid.length - 1].toFixed(4)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
