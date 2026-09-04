/**
 * Did park-neutralising the baseline actually equalise home and away?
 *
 * The bug: a season rate already contains roughly half of the batter's own
 * home park, so applying today's factor on top charges for it twice at home
 * and carries the wrong park on the road. The fitted signature was park
 * coefficients of 0.17–0.57 at home against 0.40–1.00 away, where 1.00 is
 * calibrated and the arithmetic predicts ~0.5 / ~1.0 for exactly this error.
 *
 * This re-grades the stored cohort ANALYTICALLY rather than re-capturing it:
 * snapshots carry the applied park knob, the batter's team and the home/away
 * flag, so the new knob is recoverable as `oldKnob / parkExposureFactor(...)`
 * without re-running the engine or writing a row. Same trick the platoon
 * re-grade used.
 *
 * A successful fix moves the home and away coefficients TOWARD EACH OTHER.
 * Whatever gap remains after that is a separate over-application problem and
 * belongs in the knob-reliability table, not here.
 *
 *   npx tsx scripts/retro-park-neutralize-check.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { poissonFit } from '@/lib/retro/fitEval';
import { getParkByTeam } from '@/lib/mlb/parks';
import { parkExposureFactor } from '@/lib/mlb/parkAdjustment';

const STATS: [string, number][] = [
  ['tb', 23], ['h', 8], ['hr', 12], ['r', 7], ['rbi', 13], ['k', 21], ['bb', 18],
];
/** What fraction of each baseline came from park-exposed actuals — mirrors
 *  `blendedBaselineForCategory`: only xBA/xSLG are park-neutral by
 *  construction, so the cats that blend them expose their 40% actual side and
 *  everything else — K% and BB% included, they are observed rates — is fully
 *  exposed. */
const EXPOSED: Record<number, number> = { 3: 0.4, 8: 0.4, 23: 0.4, 21: 0, 18: 1, 12: 1, 7: 1, 13: 1 };
const OTHER = ['pitcher', 'weather', 'order', 'platoon'];
const f = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '  — ');

async function main() {
  const db = getDb();
  const hands = await db.execute(sql`
    select batter, count(*) filter (where stand='L') l, count(*) filter (where stand='R') r
    from statcast_events group by 1`);
  const bats = new Map<number, 'L' | 'R' | 'S'>();
  for (const h of hands.rows as Record<string, string | number>[]) {
    const l = Number(h.l), r = Number(h.r);
    if (l + r === 0) continue;
    bats.set(Number(h.batter), Math.min(l, r) / (l + r) > 0.05 ? 'S' : l > r ? 'L' : 'R');
  }

  const res = await db.execute(sql`
    select s.predicted, s.context, a.batting
    from forecast_snapshots s join player_game_actuals a on a.game_date=s.game_date and a.mlb_id=s.mlb_id
    where s.engine='retro-batter-day' and a.status='played' and a.batting is not null`);

  type Row = { pred: Record<string, number>; ctx: Record<string, unknown>; act: Record<string, number>; bats: 'L'|'R'|'S'; isHome: boolean };
  const rows: Row[] = [];
  for (const r of res.rows as Record<string, unknown>[]) {
    const ctx = r.context as Record<string, unknown>;
    const b = bats.get(Number((ctx as Record<string, number>).mlbId ?? 0)) ?? null;
    const act = r.batting as Record<string, number>;
    rows.push({ pred: r.predicted as Record<string, number>, ctx, act, bats: (b ?? 'R'), isHome: ctx.isHome === true });
  }
  // batter hand keyed by mlb_id isn't in context; re-read it alongside
  const res2 = await db.execute(sql`
    select s.mlb_id, s.predicted, s.context, a.batting
    from forecast_snapshots s join player_game_actuals a on a.game_date=s.game_date and a.mlb_id=s.mlb_id
    where s.engine='retro-batter-day' and a.status='played' and a.batting is not null`);
  rows.length = 0;
  for (const r of res2.rows as Record<string, unknown>[]) {
    const ctx = r.context as Record<string, unknown>;
    const b = bats.get(Number(r.mlb_id));
    if (!b) continue;
    rows.push({ pred: r.predicted as Record<string, number>, ctx, act: r.batting as Record<string, number>, bats: b, isHome: ctx.isHome === true });
  }
  console.log(`${rows.length} graded rows with a known batter hand\n`);

  const fitSlice = (slice: Row[], stat: string, statId: number, neutralised: boolean) => {
    const X: number[][] = [], y: number[] = [];
    for (const r of slice) {
      const knobs = r.ctx.knobs as Record<string, Record<string, number>> | undefined;
      const mods = (r.ctx.mods as Record<string, number> | undefined)?.[stat];
      const park = knobs?.park?.[stat];
      const pred = r.pred[stat], act = r.act[stat];
      const paA = r.act.pa, paP = r.pred.pa;
      if (park == null || mods == null || pred == null || act == null || !(pred > 0) || !(mods > 0)) continue;
      if (!(paA > 0) || !(paP > 0)) continue;
      let parkKnob = park;
      if (neutralised) {
        const home = getParkByTeam(String(r.ctx.teamAbbr ?? '')) ?? null;
        const e = parkExposureFactor({ homePark: home, statId, batterHand: r.bats, exposedShare: EXPOSED[statId] ?? 1 });
        if (e > 0) parkKnob = park / e;
      }
      const row = [1, Math.log(pred / mods), Math.log(parkKnob),
        ...OTHER.map(k => Math.log(knobs?.[k]?.[stat] ?? 1)), Math.log(paA / paP)];
      if (row.some(v => !Number.isFinite(v))) continue;
      X.push(row); y.push(act);
    }
    if (X.length < 300) return null;
    // drop constant columns
    const keep = X[0].map((_, j) => j).filter(j => {
      if (j <= 2) return true;
      const col = X.map(r => r[j]); const m = col.reduce((a, b) => a + b, 0) / col.length;
      return Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) > 1e-6;
    });
    const fit = poissonFit(X.map(r => keep.map(j => r[j])), y);
    return fit ? { c: fit.beta[2], se: fit.se[2], n: X.length } : null;
  };

  const home = rows.filter(r => r.isHome), away = rows.filter(r => !r.isHome);
  console.log(`park knob coefficient (1.00 = calibrated), PA-controlled`);
  console.log(`   ${'stat'.padEnd(5)} ${'exposed'.padStart(7)}  ${'BEFORE home'.padStart(12)} ${'away'.padStart(12)} ${'gap'.padStart(6)}   ${'AFTER home'.padStart(12)} ${'away'.padStart(12)} ${'gap'.padStart(6)}`);
  for (const [stat, id] of STATS) {
    const b1 = fitSlice(home, stat, id, false), b2 = fitSlice(away, stat, id, false);
    const a1 = fitSlice(home, stat, id, true), a2 = fitSlice(away, stat, id, true);
    if (!b1 || !b2 || !a1 || !a2) { console.log(`   ${stat.padEnd(5)} —`); continue; }
    console.log(
      `   ${stat.padEnd(5)} ${String(EXPOSED[id]).padStart(7)}  ` +
      `${`${f(b1.c)}±${f(b1.se)}`.padStart(12)} ${`${f(b2.c)}±${f(b2.se)}`.padStart(12)} ${f(Math.abs(b1.c - b2.c)).padStart(6)}   ` +
      `${`${f(a1.c)}±${f(a1.se)}`.padStart(12)} ${`${f(a2.c)}±${f(a2.se)}`.padStart(12)} ${f(Math.abs(a1.c - a2.c)).padStart(6)}`,
    );
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
