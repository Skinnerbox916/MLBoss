/**
 * Validate the retro corpus aggregation formulas against Savant's own numbers.
 *
 * Aggregates `statcast_events` per player over a date range (the same
 * quantities the talent layer reads off Savant's season leaderboards —
 * xwOBA / xBA / xSLG / K% / BB% / whiff% / EV / hard-hit% / barrel rate)
 * and compares them to Savant's per-player summary export for the identical
 * range. Agreement here is what licenses the as-of (through D−1) rebuild of
 * those inputs. Alternate definitions are computed side by side where
 * Savant's convention isn't documented (whiff / hard-hit denominators).
 *
 *   npx tsx scripts/retro-validate-aggregates.ts batter 2026-08-01 2026-08-31 [minPA=50]
 *   npx tsx scripts/retro-validate-aggregates.ts pitcher 2026-08-01 2026-08-31 [minPA=50]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { externalFetchText } from '@/lib/mlb/client';
import { parseCsv } from '@/lib/retro/statcast';

type Kind = 'batter' | 'pitcher';

function savantSummaryUrl(kind: Kind, from: string, to: string, minPa: number): string {
  const q = new URLSearchParams({
    all: 'true', hfGT: 'R|', hfSea: `${from.slice(0, 4)}|`, player_type: kind,
    game_date_gt: from, game_date_lt: to, min_pitches: '0', min_results: '0',
    group_by: 'name', sort_col: 'pitches', player_event_sort: 'api_p_release_speed',
    sort_order: 'desc', min_pas: String(minPa),
  });
  return `https://baseballsavant.mlb.com/statcast_search/csv?${q.toString()}`;
}

interface Ours {
  id: number; pa: number; ab: number; bip: number; so: number; bb: number; ibb: number;
  xwoba: number | null; xba: number | null; xslg: number | null; woba: number | null;
  ev: number | null; hardhit_of_tracked: number | null; hardhit_of_bip: number | null;
  barrels: number; whiffs_a: number; whiffs_b: number; swings: number;
}

async function ours(kind: Kind, from: string, to: string): Promise<Map<number, Ours>> {
  const who = kind === 'batter' ? sql.raw('batter') : sql.raw('pitcher');
  const rows = await getDb().execute(sql`
    with e as (
      select *, (bb_type is not null) as is_bip,
        (events is not null and events <> 'truncated_pa') as is_pa,
        (events is not null and events not in ('walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','catcher_interf','sac_fly_double_play','sac_bunt_double_play')) as is_ab,
        (events in ('single','double','triple','home_run')) as is_hit,
        case events when 'single' then 1 when 'double' then 2 when 'triple' then 3 when 'home_run' then 4 else 0 end as tb
      from statcast_events where game_date between ${from} and ${to}
    )
    select ${who} as id,
      count(*) filter (where is_pa)::int as pa,
      count(*) filter (where is_ab)::int as ab,
      count(*) filter (where is_bip)::int as bip,
      count(*) filter (where events in ('strikeout','strikeout_double_play'))::int as so,
      count(*) filter (where events in ('walk','intent_walk'))::int as bb,
      count(*) filter (where events = 'intent_walk')::int as ibb,
      -- xwOBA: est_woba on tracked BIP, actual woba_value otherwise; denominator = Savant's woba_denom
      sum(case when is_pa and woba_denom = 1 then coalesce(case when is_bip then est_woba end, woba_value) end)
        / nullif(sum(case when is_pa then woba_denom end), 0) as xwoba,
      sum(case when is_pa then woba_value * woba_denom end) / nullif(sum(case when is_pa then woba_denom end), 0) as woba,
      -- xBA / xSLG over AB: est on tracked BIP, actual outcome on untracked BIP, 0 on K etc.
      sum(case when is_ab then coalesce(case when is_bip then est_ba end, case when is_hit then 1 else 0 end) end)
        / nullif(count(*) filter (where is_ab), 0) as xba,
      sum(case when is_ab then coalesce(case when is_bip then est_slg end, tb) end)
        / nullif(count(*) filter (where is_ab), 0) as xslg,
      avg(launch_speed) filter (where is_bip) as ev,
      (count(*) filter (where is_bip and launch_speed >= 95))::float / nullif(count(*) filter (where is_bip and launch_speed is not null), 0) as hardhit_of_tracked,
      (count(*) filter (where is_bip and launch_speed >= 95))::float / nullif(count(*) filter (where is_bip), 0) as hardhit_of_bip,
      count(*) filter (where launch_speed_angle = 6)::int as barrels,
      count(*) filter (where description in ('swinging_strike','swinging_strike_blocked','missed_bunt'))::int as whiffs_a,
      count(*) filter (where description in ('swinging_strike','swinging_strike_blocked','missed_bunt','foul_tip'))::int as whiffs_b,
      count(*) filter (where description in ('swinging_strike','swinging_strike_blocked','missed_bunt','foul_tip','foul','hit_into_play','foul_bunt','bunt_foul_tip'))::int as swings
    from e group by 1`);
  const m = new Map<number, Ours>();
  for (const r of rows.rows as Record<string, unknown>[]) {
    const n = (k: string) => (r[k] == null ? null : Number(r[k]));
    m.set(Number(r.id), {
      id: Number(r.id), pa: n('pa')!, ab: n('ab')!, bip: n('bip')!, so: n('so')!, bb: n('bb')!, ibb: n('ibb')!,
      xwoba: n('xwoba'), xba: n('xba'), xslg: n('xslg'), woba: n('woba'), ev: n('ev'),
      hardhit_of_tracked: n('hardhit_of_tracked'), hardhit_of_bip: n('hardhit_of_bip'),
      barrels: n('barrels')!, whiffs_a: n('whiffs_a')!, whiffs_b: n('whiffs_b')!, swings: n('swings')!,
    });
  }
  return m;
}

function summarize(label: string, pairs: [number, number, string][], fmt = (v: number) => v.toFixed(3)) {
  if (!pairs.length) { console.log(`${label.padEnd(30)} n=0`); return; }
  const diffs = pairs.map(([a, b, name]) => ({ d: a - b, ad: Math.abs(a - b), a, b, name })).sort((x, y) => y.ad - x.ad);
  const mean = diffs.reduce((s, x) => s + x.d, 0) / diffs.length;
  const mad = diffs.reduce((s, x) => s + x.ad, 0) / diffs.length;
  const p95 = diffs[Math.floor(diffs.length * 0.05)].ad;
  const exact = diffs.filter(x => x.ad < 1e-9).length;
  const w = diffs[0];
  console.log(`${label.padEnd(30)} n=${String(diffs.length).padStart(3)}  mean diff ${mean >= 0 ? '+' : ''}${fmt(mean)}  mean |diff| ${fmt(mad)}  p95 |diff| ${fmt(p95)}  exact ${exact}  worst: ${w.name} ours ${fmt(w.a)} vs savant ${fmt(w.b)}`);
}

async function main() {
  const [kindArg, from, to, minPaArg] = process.argv.slice(2);
  const kind = (kindArg === 'pitcher' ? 'pitcher' : 'batter') as Kind;
  const minPa = Number(minPaArg ?? 50);
  if (!from || !to) { console.error('usage: retro-validate-aggregates.ts <batter|pitcher> <from> <to> [minPA]'); process.exit(2); }

  const csv = await externalFetchText(savantSummaryUrl(kind, from, to, minPa), { accept: 'text/csv' });
  const savant = parseCsv(csv.replace(/^﻿/, ''));
  const mine = await ours(kind, from, to);
  console.log(`${kind}s ${from}..${to}, min PA ${minPa}: Savant rows ${savant.length}, our players ${mine.size}`);

  const num = (v: string) => (v === '' || v == null ? null : Number(v));
  const P = { pa: [] as [number, number, string][], so: [] as [number, number, string][], bb: [] as [number, number, string][],
    bbNoIbb: [] as [number, number, string][], bip: [] as [number, number, string][], barrels: [] as [number, number, string][],
    xwoba: [] as [number, number, string][], woba: [] as [number, number, string][], xba: [] as [number, number, string][], xslg: [] as [number, number, string][],
    ev: [] as [number, number, string][], hhTracked: [] as [number, number, string][], hhBip: [] as [number, number, string][],
    whiffA: [] as [number, number, string][], whiffB: [] as [number, number, string][], swings: [] as [number, number, string][],
    kpct: [] as [number, number, string][], bbpct: [] as [number, number, string][], barrelBbe: [] as [number, number, string][] };
  let missing = 0;
  for (const s of savant) {
    const id = Number(s.player_id); const o = mine.get(id);
    if (!o) { missing++; continue; }
    const name = s.player_name;
    const push = (arr: [number, number, string][], a: number | null, b: number | null) => { if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) arr.push([a, b, name]); };
    push(P.pa, o.pa, num(s.pa)); push(P.so, o.so, num(s.so)); push(P.bb, o.bb, num(s.bb)); push(P.bbNoIbb, o.bb - o.ibb, num(s.bb));
    push(P.bip, o.bip, num(s.bip)); push(P.barrels, o.barrels, num(s.barrels_total));
    push(P.xwoba, o.xwoba, num(s.xwoba)); push(P.woba, o.woba, num(s.woba)); push(P.xba, o.xba, num(s.xba)); push(P.xslg, o.xslg, num(s.xslg));
    push(P.ev, o.ev, num(s.launch_speed));
    const hh = num(s.hardhit_percent); push(P.hhTracked, o.hardhit_of_tracked == null ? null : o.hardhit_of_tracked * 100, hh); push(P.hhBip, o.hardhit_of_bip == null ? null : o.hardhit_of_bip * 100, hh);
    push(P.whiffA, o.whiffs_a, num(s.whiffs)); push(P.whiffB, o.whiffs_b, num(s.whiffs)); push(P.swings, o.swings, num(s.swings));
    push(P.kpct, o.pa ? (o.so / o.pa) * 100 : null, num(s.k_percent)); push(P.bbpct, o.pa ? (o.bb / o.pa) * 100 : null, num(s.bb_percent));
    push(P.barrelBbe, o.bip ? (o.barrels / o.bip) * 100 : null, num(s.barrels_per_bbe_percent));
  }
  console.log(`Savant players absent from our corpus: ${missing}\n`);
  const c = (v: number) => String(Math.round(v));
  summarize('PA (count)', P.pa, c); summarize('SO (count)', P.so, c); summarize('BB incl IBB (count)', P.bb, c); summarize('BB excl IBB (count)', P.bbNoIbb, c);
  summarize('BIP (count)', P.bip, c); summarize('barrels (count)', P.barrels, c);
  summarize('swings (count)', P.swings, c); summarize('whiffs A: no foul_tip', P.whiffA, c); summarize('whiffs B: incl foul_tip', P.whiffB, c);
  console.log();
  summarize('wOBA', P.woba); summarize('xwOBA', P.xwoba); summarize('xBA', P.xba); summarize('xSLG', P.xslg);
  summarize('avg EV (mph)', P.ev, v => v.toFixed(2));
  summarize('hard-hit % (of tracked BBE)', P.hhTracked, v => v.toFixed(1)); summarize('hard-hit % (of all BBE)', P.hhBip, v => v.toFixed(1));
  summarize('K %', P.kpct, v => v.toFixed(1)); summarize('BB %', P.bbpct, v => v.toFixed(1)); summarize('barrels / BBE %', P.barrelBbe, v => v.toFixed(1));
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
