/**
 * Retro corpus — as-of-date Savant aggregates.
 *
 * Rebuilds the Savant season-leaderboard rows the talent layer consumes
 * (`StatcastPitcher` / `StatcastBatter`, normally produced by
 * src/lib/mlb/savant.ts from Savant's season-to-date leaderboards) from raw
 * `statcast_events`, using only games played BEFORE `asOf`. That is the one
 * thing a leaderboard can never give back: what a player's Statcast profile
 * looked like on the morning of a past game, with nothing from later days
 * leaking in.
 *
 * Formulas were validated against Savant's own per-player summaries for
 * the same windows (July + August 2026, scripts/retro-validate-aggregates.ts):
 * counts exact; xwOBA |diff| ≈ 0.001; K% / BB% / hard-hit% / barrel rate to
 * displayed precision. Conventions that matter: PA excludes `truncated_pa`;
 * BB includes IBB; whiffs include foul tips; hard-hit% is over ALL batted
 * balls (the skills leaderboard's convention; the summary export uses tracked); xwOBA uses est_woba on tracked BIP and the actual woba_value
 * otherwise, over Savant's woba_denom. xERA comes from the season's fitted
 * xwOBA→xERA mapping (./xera.ts). `era` is left null — earned runs aren't
 * derivable from pitch events; the engine takes actual ERA from MLB stat
 * lines anyway.
 *
 * Not imported by engine code. See docs/forecast-verification.md (retro).
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import type { StatcastBatter, StatcastPitcher } from '@/lib/mlb/types';
import { xeraFromXwoba, type XeraMapping } from './xera';

/** Savant's "fastball" for arsenal velocity (mirrors savant.ts FASTBALL_TYPES). */
const FASTBALL_TYPES = ['FF', 'SI', 'FC'];

export interface AsOfCoverage {
  /** First and last game date the aggregate actually saw (inclusive). */
  from: string | null;
  to: string | null;
  gameDays: number;
  /** True when the corpus has no events before the season's first game in
   *  this window — i.e. the window is the season-to-date, not a partial. */
  seasonComplete: boolean;
}

export interface AsOfResult<T> {
  asOf: string;
  season: number;
  rows: Map<number, T>;
  coverage: AsOfCoverage;
}

export interface AggRow {
  id: number; pa: number; ab: number; bip: number; so: number; bb: number;
  ubb: number; hbp: number; s1: number; s2: number; s3: number; hr: number; sf: number;
  xwoba: number | null; wobaGeneric: number | null; xba: number | null; xslg: number | null;
  xwobacon: number | null; hardhit: number | null; barrels: number; whiffs: number; swings: number;
  fb_velo: number | null; pitches: number; run_exp: number | null;
}

/**
 * Per-player aggregates over an arbitrary window `[from, toExclusive)`.
 * Exported so studies (predictiveness, reliability) reuse the exact
 * conventions the as-of rows are built on rather than re-deriving them —
 * `truncated_pa` exclusion, IBB in BB, foul tips as whiffs, hard-hit over
 * all batted balls, xwOBA over Savant's `woba_denom`.
 */
export async function aggregateWindow(
  kind: 'batter' | 'pitcher',
  from: string,
  toExclusive: string,
): Promise<AggRow[]> {
  const db = getDb();
  const who = sql.raw(kind);
  const res = await db.execute(sql`
    with e as (
      select *,
        (bb_type is not null) as is_bip,
        (events is not null and events <> 'truncated_pa') as is_pa,
        (events is not null and events not in ('truncated_pa','walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','catcher_interf','sac_fly_double_play','sac_bunt_double_play')) as is_ab,
        (events in ('single','double','triple','home_run')) as is_hit,
        case events when 'single' then 1 when 'double' then 2 when 'triple' then 3 when 'home_run' then 4 else 0 end as tb
      from statcast_events
      where game_date >= ${from} and game_date < ${toExclusive}
    )
    select ${who} as id,
      count(*)::int as pitches,
      count(*) filter (where is_pa)::int as pa,
      count(*) filter (where is_ab)::int as ab,
      count(*) filter (where is_bip)::int as bip,
      count(*) filter (where events in ('strikeout','strikeout_double_play'))::int as so,
      count(*) filter (where events in ('walk','intent_walk'))::int as bb,
      count(*) filter (where events = 'walk')::int as ubb,
      count(*) filter (where events = 'hit_by_pitch')::int as hbp,
      count(*) filter (where events = 'single')::int as s1,
      count(*) filter (where events = 'double')::int as s2,
      count(*) filter (where events = 'triple')::int as s3,
      count(*) filter (where events = 'home_run')::int as hr,
      count(*) filter (where events in ('sac_fly','sac_fly_double_play'))::int as sf,
      sum(case when is_pa and woba_denom = 1 then coalesce(case when is_bip then est_woba end, woba_value) end)
        / nullif(sum(case when is_pa then woba_denom end), 0) as xwoba,
      -- fallback actual wOBA from the export's per-pitch values (generic rounded weights;
      -- runs ~+0.007 vs the leaderboard). Preferred: season linear weights over counts, below.
      sum(case when is_pa then woba_value * woba_denom end) / nullif(sum(case when is_pa then woba_denom end), 0) as woba_generic,
      sum(case when is_ab then coalesce(case when is_bip then est_ba end, case when is_hit then 1 else 0 end) end)
        / nullif(count(*) filter (where is_ab), 0) as xba,
      sum(case when is_ab then coalesce(case when is_bip then est_slg end, tb) end)
        / nullif(count(*) filter (where is_ab), 0) as xslg,
      avg(est_woba) filter (where is_bip) as xwobacon,
      -- Denominator = ALL batted balls (untracked included): that is the convention of
      -- the custom skills leaderboard the engine reads (verified 2026-09-02, mean |diff|
      -- 0.05 pts vs 0.21 for tracked-only). Savant's date-range summary export uses
      -- tracked-only, which is why retro-validate-aggregates.ts reports both.
      (count(*) filter (where is_bip and launch_speed >= 95))::float / nullif(count(*) filter (where is_bip), 0) as hardhit,
      count(*) filter (where launch_speed_angle = 6)::int as barrels,
      count(*) filter (where description in ('swinging_strike','swinging_strike_blocked','missed_bunt','foul_tip'))::int as whiffs,
      count(*) filter (where description in ('swinging_strike','swinging_strike_blocked','missed_bunt','foul_tip','foul','hit_into_play','foul_bunt','bunt_foul_tip'))::int as swings,
      avg(release_speed) filter (where pitch_type in (${sql.join(FASTBALL_TYPES.map(t => sql`${t}`), sql`, `)})) as fb_velo,
      sum(delta_run_exp) as run_exp
    from e group by 1`);
  return (res.rows as Record<string, unknown>[]).map(r => {
    const n = (k: string) => (r[k] == null ? null : Number(r[k]));
    return {
      id: Number(r.id), pitches: n('pitches')!, pa: n('pa')!, ab: n('ab')!, bip: n('bip')!, so: n('so')!, bb: n('bb')!,
      ubb: n('ubb')!, hbp: n('hbp')!, s1: n('s1')!, s2: n('s2')!, s3: n('s3')!, hr: n('hr')!, sf: n('sf')!,
      xwoba: n('xwoba'), wobaGeneric: n('woba_generic'), xba: n('xba'), xslg: n('xslg'), xwobacon: n('xwobacon'), hardhit: n('hardhit'),
      barrels: n('barrels')!, whiffs: n('whiffs')!, swings: n('swings')!, fb_velo: n('fb_velo'), run_exp: n('run_exp'),
    } satisfies AggRow;
  });
}

/** As-of wrapper: the season through the day before `asOf`, plus coverage. */
async function aggregate(kind: 'batter' | 'pitcher', season: number, asOf: string): Promise<{ rows: AggRow[]; coverage: AsOfCoverage }> {
  const from = `${season}-01-01`;
  const [rows, cov] = await Promise.all([
    aggregateWindow(kind, from, asOf),
    getDb().execute(sql`
      select min(game_date)::text as f, max(game_date)::text as t, count(distinct game_date)::int as d
      from statcast_events where game_date >= ${from} and game_date < ${asOf}`),
  ]);
  const c = cov.rows[0] as { f: string | null; t: string | null; d: number };
  return {
    rows,
    coverage: {
      from: c.f, to: c.t, gameDays: Number(c.d),
      // Regular season opens late March; a corpus that starts later is a partial window.
      seasonComplete: c.f != null && c.f <= `${season}-04-05`,
    },
  };
}

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/**
 * Savant's leaderboard wOBA uses season linear weights over the standard
 * denominator (AB + uBB + SF + HBP; IBB and sac bunts excluded), NOT the
 * rounded generic values carried on each pitch in the export (0.7 / 0.9 /
 * 1.25 / 1.6 / 2.0 — those run ~+0.007 high). Weights are recovered per
 * season by least squares against the batter leaderboard
 * (scripts/retro-woba-weights.ts; 2026 fit residual 0.0003, max 0.0006).
 * Unknown season → fall back to the generic per-pitch values.
 */
export interface WobaWeights { ubb: number; hbp: number; s1: number; s2: number; s3: number; hr: number }
export const WOBA_WEIGHTS: Record<number, WobaWeights> = {
  2026: { ubb: 0.698, hbp: 0.730, s1: 0.889, s2: 1.263, s3: 1.597, hr: 2.053 },
};

function actualWoba(r: AggRow, season: number): number | null {
  const w = WOBA_WEIGHTS[season];
  if (!w) return r.wobaGeneric;
  const den = r.ab + r.ubb + r.sf + r.hbp;
  if (den <= 0) return null;
  return (w.ubb * r.ubb + w.hbp * r.hbp + w.s1 * r.s1 + w.s2 * r.s2 + w.s3 * r.s3 + w.hr * r.hr) / den;
}

/** Pitcher rows as of `asOf` (games strictly before that date). */
export async function pitchersAsOf(asOf: string, season: number, xera: XeraMapping | null): Promise<AsOfResult<StatcastPitcher>> {
  const { rows, coverage } = await aggregate('pitcher', season, asOf);
  const out = new Map<number, StatcastPitcher>();
  for (const r of rows) {
    if (r.pa === 0) continue;
    out.set(r.id, {
      mlbId: r.id,
      xera: xera && r.xwoba != null ? xeraFromXwoba(xera, r.xwoba) : null,
      xwoba: r.xwoba, era: null, woba: actualWoba(r, season), pa: r.pa, bip: r.bip,
      kRate: rate(r.so, r.pa), bbRate: rate(r.bb, r.pa),
      xwobacon: r.xwobacon, hardHitRate: r.hardhit,
      whiffPct: rate(r.whiffs, r.swings), barrelPct: rate(r.barrels, r.bip),
      avgFastballVelo: r.fb_velo,
      runValuePer100: r.run_exp != null && r.pitches > 0 ? (100 * r.run_exp) / r.pitches : null,
    });
  }
  return { asOf, season, rows: out, coverage };
}

/** Batter rows as of `asOf` (games strictly before that date). */
export async function battersAsOf(asOf: string, season: number): Promise<AsOfResult<StatcastBatter>> {
  const { rows, coverage } = await aggregate('batter', season, asOf);
  const out = new Map<number, StatcastBatter>();
  for (const r of rows) {
    if (r.pa === 0) continue;
    out.set(r.id, {
      mlbId: r.id, xba: r.xba, xslg: r.xslg, xwoba: r.xwoba, woba: actualWoba(r, season), pa: r.pa, bip: r.bip,
      kRate: rate(r.so, r.pa), bbRate: rate(r.bb, r.pa), xwobacon: r.xwobacon, hardHitRate: r.hardhit,
    });
  }
  return { asOf, season, rows: out, coverage };
}
