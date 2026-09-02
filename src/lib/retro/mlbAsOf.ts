/**
 * Retro — as-of MLB Stats API interception.
 *
 * Implements `AsOfContext.interceptMlbStats` (src/lib/mlb/asOfContext.ts):
 * every MLB Stats API request the live pipeline makes is either rewritten,
 * sliced, synthesized from the pitch-event corpus, or passed through — so the
 * unchanged engines see the world as it stood on the morning of `asOf`.
 *
 *   season totals   (stats=season, players + teams) → stats=byDateRange
 *                   [seasonStart, asOf−1], response type renamed to 'season'
 *   game logs       (stats=gameLog)                → fetched, then games on/after
 *                   asOf dropped
 *   starter line    (pitching statSplits sitCodes=sp) → summed from the sliced
 *                   game log (GS games only) — the API can't date-range splits
 *   platoon splits  (hitting/pitching statSplits vl,vr; team hitting vl,vr) →
 *                   computed from statcast_events (batter vs p_throws, pitcher
 *                   vs stand). R/RBI/SB aren't PA events, so those counts are 0
 *                   and the platoon layer falls back to its population prior
 *                   for them; H/2B/3B/HR/BB/K/HBP/PA/AB are exact
 *   team SP/RP      (team pitching statSplits sp,rp) → role rates from the
 *                   corpus (starter = first pitcher of the game for that team),
 *                   IP from event outs, ERA and SB/IP from the team's
 *                   byDateRange totals (role-level ERA isn't recoverable)
 *   prior season    (season ≠ ctx.season), identity, schedule, vsPlayer → pass
 *
 * Any request with a `stats=` param that none of the rules claim is logged
 * once per shape so leakage is visible, then passed through.
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import type { AsOfContext } from '@/lib/mlb/asOfContext';
import { parseIPToOuts } from '@/lib/utils';
import { battersAsOf, pitchersAsOf } from './asOf';
import { fetchXeraMapping } from './xera';

type Json = Record<string, unknown>;
interface StatsGroup { type?: { displayName: string }; group?: { displayName: string }; splits: Json[] }
interface StatsResponse { stats?: StatsGroup[] }

const dayBefore = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3).replace(/^0/, '') : '.000');
const ipString = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

/** Savant team codes → MLB Stats API abbreviations where they differ. */
const SAVANT_TO_MLB: Record<string, string> = { ARI: 'AZ', CHW: 'CWS', WAS: 'WSH', SDP: 'SD', SFG: 'SF', TBR: 'TB', KCR: 'KC', OAK: 'ATH' };
const normTeam = (code: string) => SAVANT_TO_MLB[code] ?? code;

// ---------------------------------------------------------------------------
// Corpus queries (all bounded to [seasonStart, asOf))
// ---------------------------------------------------------------------------

const HIT_COLS = sql`
  count(*) filter (where is_pa)::int as pa,
  count(*) filter (where is_ab)::int as ab,
  count(*) filter (where events in ('single','double','triple','home_run'))::int as h,
  count(*) filter (where events = 'double')::int as d2,
  count(*) filter (where events = 'triple')::int as d3,
  count(*) filter (where events = 'home_run')::int as hr,
  count(*) filter (where events in ('walk','intent_walk'))::int as bb,
  count(*) filter (where events = 'intent_walk')::int as ibb,
  count(*) filter (where events in ('strikeout','strikeout_double_play'))::int as so,
  count(*) filter (where events = 'hit_by_pitch')::int as hbp,
  count(*) filter (where events in ('sac_fly','sac_fly_double_play'))::int as sf,
  count(distinct game_pk)::int as g`;

function eventsCte(start: string, asOf: string) {
  return sql`select *,
      (events is not null and events <> 'truncated_pa') as is_pa,
      (events is not null and events not in ('truncated_pa','walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','catcher_interf','sac_fly_double_play','sac_bunt_double_play')) as is_ab,
      case events
        when 'strikeout' then 1 when 'field_out' then 1 when 'force_out' then 1 when 'fielders_choice_out' then 1
        when 'sac_fly' then 1 when 'sac_bunt' then 1 when 'other_out' then 1
        when 'strikeout_double_play' then 2 when 'grounded_into_double_play' then 2 when 'double_play' then 2
        when 'sac_fly_double_play' then 2 when 'sac_bunt_double_play' then 2 when 'triple_play' then 3
        when 'caught_stealing_2b' then 1 when 'caught_stealing_3b' then 1 when 'caught_stealing_home' then 1
        when 'pickoff_1b' then 1 when 'pickoff_2b' then 1 when 'pickoff_3b' then 1
        when 'pickoff_caught_stealing_2b' then 1 when 'pickoff_caught_stealing_3b' then 1 when 'pickoff_caught_stealing_home' then 1
        else 0 end as outs
    from statcast_events where game_date >= ${start} and game_date < ${asOf}`;
}

interface HitAgg { key: string; pa: number; ab: number; h: number; d2: number; d3: number; hr: number; bb: number; ibb: number; so: number; hbp: number; sf: number; g: number }

function hittingRawStat(a: HitAgg): Json {
  const singles = a.h - a.d2 - a.d3 - a.hr;
  const tb = singles + 2 * a.d2 + 3 * a.d3 + 4 * a.hr;
  const obpDen = a.ab + a.bb + a.hbp + a.sf;
  const avg = a.ab > 0 ? a.h / a.ab : 0, obp = obpDen > 0 ? (a.h + a.bb + a.hbp) / obpDen : 0, slg = a.ab > 0 ? tb / a.ab : 0;
  return {
    gamesPlayed: a.g, plateAppearances: a.pa, atBats: a.ab, hits: a.h, doubles: a.d2, triples: a.d3, homeRuns: a.hr,
    baseOnBalls: a.bb, intentionalWalks: a.ibb, strikeOuts: a.so, hitByPitch: a.hbp, sacFlies: a.sf, totalBases: tb,
    // Not PA events — unavailable from pitch data; consumers treat 0 as "no observation".
    runs: 0, rbi: 0, stolenBases: 0,
    avg: f3(avg), obp: f3(obp), slg: f3(slg), ops: f3(obp + slg),
  };
}

const toAgg = (r: Json): HitAgg => ({
  key: String(r.key), pa: Number(r.pa), ab: Number(r.ab), h: Number(r.h), d2: Number(r.d2), d3: Number(r.d3), hr: Number(r.hr),
  bb: Number(r.bb), ibb: Number(r.ibb), so: Number(r.so), hbp: Number(r.hbp), sf: Number(r.sf), g: Number(r.g),
});

async function playerVsHand(kind: 'batter' | 'pitcher', mlbId: number, start: string, asOf: string): Promise<Map<string, HitAgg>> {
  const who = kind === 'batter' ? sql.raw('batter') : sql.raw('pitcher');
  const handCol = kind === 'batter' ? sql.raw('p_throws') : sql.raw('stand');
  const res = await getDb().execute(sql`with e as (${eventsCte(start, asOf)}) select ${handCol} as key, ${HIT_COLS} from e where ${who} = ${mlbId} group by 1`);
  return new Map((res.rows as Json[]).map(r => [String(r.key), toAgg(r)]));
}

async function teamBattingVsHand(teamAbbr: string, start: string, asOf: string): Promise<Map<string, HitAgg>> {
  const res = await getDb().execute(sql`with e as (${eventsCte(start, asOf)})
    select p_throws as key, ${HIT_COLS} from e
    where (case when inning_topbot = 'Top' then away_team else home_team end) = ${teamAbbr} group by 1`);
  return new Map((res.rows as Json[]).map(r => [String(r.key), toAgg(r)]));
}

interface RoleAgg { team: string; role: 'sp' | 'rp'; bf: number; ab: number; h: number; hr: number; bb: number; so: number; outs: number }

async function teamRoleLines(start: string, asOf: string): Promise<RoleAgg[]> {
  const res = await getDb().execute(sql`with e as (${eventsCte(start, asOf)}),
    first_pa as (select game_pk, inning_topbot, min(at_bat_number) as ab0 from e group by 1, 2),
    starters as (select distinct e.game_pk, e.inning_topbot, e.pitcher from e join first_pa f
      on f.game_pk = e.game_pk and f.inning_topbot = e.inning_topbot and f.ab0 = e.at_bat_number),
    x as (select e.*, (case when e.inning_topbot = 'Top' then e.home_team else e.away_team end) as pteam,
      (case when s.pitcher is not null then 'sp' else 'rp' end) as role
      from e left join starters s on s.game_pk = e.game_pk and s.inning_topbot = e.inning_topbot and s.pitcher = e.pitcher)
    select pteam as team, role,
      count(*) filter (where is_pa)::int as bf, count(*) filter (where is_ab)::int as ab,
      count(*) filter (where events in ('single','double','triple','home_run'))::int as h,
      count(*) filter (where events = 'home_run')::int as hr,
      count(*) filter (where events in ('walk','intent_walk'))::int as bb,
      count(*) filter (where events in ('strikeout','strikeout_double_play'))::int as so,
      sum(outs)::int as outs
    from x group by 1, 2`);
  return (res.rows as Json[]).map(r => ({
    team: String(r.team), role: r.role as 'sp' | 'rp', bf: Number(r.bf), ab: Number(r.ab), h: Number(r.h),
    hr: Number(r.hr), bb: Number(r.bb), so: Number(r.so), outs: Number(r.outs),
  }));
}

// ---------------------------------------------------------------------------
// Game-log helpers
// ---------------------------------------------------------------------------

function sliceGameLog(resp: StatsResponse, asOf: string): StatsResponse {
  return { ...resp, stats: (resp.stats ?? []).map(g => ({ ...g, splits: (g.splits ?? []).filter(s => typeof s.date === 'string' && (s.date as string) < asOf) })) };
}

/** Sum a pitcher's sliced game log over starts into one 'sp' split. */
function starterLineFromGameLog(resp: StatsResponse): Json | null {
  const games = (resp.stats ?? []).flatMap(g => g.splits ?? []).filter(s => Number((s.stat as Json)?.gamesStarted ?? 0) >= 1);
  if (games.length === 0) return null;
  const sum = (k: string) => games.reduce((a, s) => a + Number((s.stat as Json)[k] ?? 0), 0);
  const outs = games.reduce((a, s) => a + parseIPToOuts(String((s.stat as Json).inningsPitched ?? '0')), 0);
  const ip = outs / 3;
  const er = sum('earnedRuns'), h = sum('hits'), bb = sum('baseOnBalls'), so = sum('strikeOuts'), ab = sum('atBats'), pitches = sum('numberOfPitches');
  return {
    gamesPlayed: games.length, gamesStarted: games.length, inningsPitched: ipString(outs), earnedRuns: er,
    era: ip > 0 ? (9 * er / ip).toFixed(2) : '0.00', whip: ip > 0 ? ((bb + h) / ip).toFixed(2) : '0.00',
    strikeOuts: so, baseOnBalls: bb, hits: h, homeRuns: sum('homeRuns'), atBats: ab, battersFaced: sum('battersFaced'),
    groundOuts: sum('groundOuts'), airOuts: sum('airOuts'), wins: sum('wins'), losses: sum('losses'),
    numberOfPitches: pitches, pitchesPerInning: ip > 0 ? (pitches / ip).toFixed(2) : '0.00',
    strikeoutsPer9Inn: ip > 0 ? (9 * so / ip).toFixed(2) : '0.00', avg: f3(ab > 0 ? h / ab : 0),
  };
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

export interface RetroContextInfo { asOf: string; season: number; seasonStart: string }

export async function createAsOfContext(asOf: string): Promise<AsOfContext & { info: RetroContextInfo }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`bad asOf date: ${asOf}`);
  const season = Number(asOf.slice(0, 4));
  const seasonStart = `${season}-03-01`; // regular season opens late March; pre-season dates simply have no events
  const endDate = dayBefore(asOf);
  const xera = await fetchXeraMapping(season);
  let pitchersP: ReturnType<typeof pitchersAsOf> | null = null;
  let battersP: ReturnType<typeof battersAsOf> | null = null;
  let roleLinesP: Promise<RoleAgg[]> | null = null;
  let teamsP: Promise<Map<number, string>> | null = null; // id → abbreviation
  const passthroughLogged = new Set<string>();

  const teamAbbrs = (fetchJson: (u: URL) => Promise<unknown>) => (teamsP ??= (async () => {
    const r = (await fetchJson(new URL(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${season}`))) as { teams?: { id: number; abbreviation: string }[] };
    return new Map((r.teams ?? []).map(t => [t.id, t.abbreviation]));
  })());

  const byDateRange = async (url: URL, fetchJson: (u: URL) => Promise<unknown>, renameTo = 'season'): Promise<StatsResponse> => {
    const u = new URL(url.toString());
    u.searchParams.set('stats', 'byDateRange');
    u.searchParams.set('startDate', seasonStart);
    u.searchParams.set('endDate', endDate);
    u.searchParams.delete('sitCodes');
    const resp = (await fetchJson(u)) as StatsResponse;
    const groups = (resp.stats ?? []).map(g => ({ ...g, type: { displayName: renameTo } }));
    return { ...resp, stats: groups.length ? groups : [{ type: { displayName: renameTo }, splits: [] }] };
  };

  const interceptMlbStats: AsOfContext['interceptMlbStats'] = async (url, fetchJson) => {
    const path = url.pathname.replace(/^\/api\/v1(\.1)?/, '');
    const stats = (url.searchParams.get('stats') ?? '').split(',').filter(Boolean);
    if (stats.length === 0) return undefined; // identity, schedule, teams, people — pass through
    const reqSeason = Number(url.searchParams.get('season') ?? season);
    if (reqSeason !== season) return undefined; // prior-season totals are complete history
    const group = url.searchParams.get('group') ?? '';
    const sitCodes = (url.searchParams.get('sitCodes') ?? '').split(',').filter(Boolean);

    // ---- players -----------------------------------------------------------
    const person = path.match(/^\/people\/(\d+)\/stats$/);
    if (person) {
      const mlbId = Number(person[1]);
      if (stats.includes('gameLog')) return sliceGameLog((await fetchJson(url)) as StatsResponse, asOf);
      if (stats.includes('vsPlayer')) return undefined;
      const out: StatsGroup[] = [];
      if (stats.includes('season')) out.push(...((await byDateRange(url, fetchJson)).stats ?? []));
      if (stats.includes('statSplits')) {
        if (group === 'pitching' && sitCodes.includes('sp')) {
          const gl = new URL(url.toString()); gl.searchParams.set('stats', 'gameLog'); gl.searchParams.delete('sitCodes');
          const line = starterLineFromGameLog(sliceGameLog((await fetchJson(gl)) as StatsResponse, asOf));
          out.push({ type: { displayName: 'statSplits' }, group: { displayName: 'pitching' }, splits: line ? [{ split: { code: 'sp', description: 'Starter' }, season: String(season), stat: line }] : [] });
        } else {
          const kind = group === 'pitching' ? 'pitcher' : 'batter';
          const byHand = await playerVsHand(kind, mlbId, seasonStart, asOf);
          const splits: Json[] = [];
          for (const [code, hand, desc] of [['vl', 'L', 'vs Left'], ['vr', 'R', 'vs Right']] as const) {
            if (!sitCodes.includes(code)) continue;
            const a = byHand.get(hand);
            if (a && a.pa > 0) splits.push({ split: { code, description: desc }, season: String(season), stat: hittingRawStat(a) });
          }
          out.push({ type: { displayName: 'statSplits' }, group: { displayName: group }, splits });
        }
      }
      if (out.length) return { stats: out };
    }

    // ---- teams -------------------------------------------------------------
    const team = path.match(/^\/teams\/(\d+)\/stats$/);
    const allTeams = path === '/teams/stats';
    if (team || allTeams) {
      if (stats.includes('season')) return byDateRange(url, fetchJson);
      if (stats.includes('statSplits') && group === 'hitting' && team) {
        const abbr = (await teamAbbrs(fetchJson)).get(Number(team[1]));
        if (!abbr) return undefined;
        const byHand = await teamBattingVsHand(abbr, seasonStart, asOf);
        const splits: Json[] = [];
        for (const [code, hand, desc] of [['vl', 'L', 'vs Left'], ['vr', 'R', 'vs Right']] as const) {
          const a = byHand.get(hand);
          if (a && a.pa > 0) splits.push({ split: { code, description: desc }, season: String(season), team: { id: Number(team[1]) }, stat: hittingRawStat(a) });
        }
        return { stats: [{ type: { displayName: 'statSplits' }, group: { displayName: 'hitting' }, splits }] };
      }
      if (stats.includes('statSplits') && group === 'pitching' && allTeams && sitCodes.includes('sp')) {
        const [roles, abbrs, totals] = await Promise.all([
          (roleLinesP ??= teamRoleLines(seasonStart, asOf)),
          teamAbbrs(fetchJson),
          byDateRange(url, fetchJson),
        ]);
        const byAbbr = new Map<string, { id: number; era: string; sb: number; outs: number }>();
        for (const s of totals.stats?.[0]?.splits ?? []) {
          const t = s.team as { id: number } | undefined; const st = s.stat as Json;
          if (!t) continue;
          const abbr = abbrs.get(t.id); if (!abbr) continue;
          byAbbr.set(abbr, { id: t.id, era: String(st.era ?? '0.00'), sb: Number(st.stolenBases ?? 0), outs: parseIPToOuts(String(st.inningsPitched ?? '0')) });
        }
        const splits: Json[] = [];
        for (const r of roles) {
          const t = byAbbr.get(normTeam(r.team));
          if (!t) { if (!passthroughLogged.has(`team:${r.team}`)) { passthroughLogged.add(`team:${r.team}`); console.warn(`[retro] no MLB team for corpus code ${r.team}`); } continue; }
          const ipShare = t.outs > 0 ? r.outs / t.outs : 0;
          splits.push({
            split: { code: r.role, description: r.role === 'sp' ? 'Starter' : 'Reliever' }, team: { id: t.id, name: normTeam(r.team) },
            stat: { inningsPitched: ipString(r.outs), battersFaced: r.bf, strikeOuts: r.so, baseOnBalls: r.bb, hits: r.h, homeRuns: r.hr,
              // Role-level ERA / SB aren't recoverable from pitch events: team as-of values, SB pro-rated by IP.
              era: t.era, stolenBases: Math.round(t.sb * ipShare), avg: f3(r.ab > 0 ? r.h / r.ab : 0) },
          });
        }
        return { stats: [{ type: { displayName: 'statSplits' }, group: { displayName: 'pitching' }, splits }] };
      }
    }

    const shape = `${path.replace(/\d+/g, '{id}')}?stats=${stats.join(',')}&group=${group}&sitCodes=${sitCodes.join(',')}`;
    if (!passthroughLogged.has(shape)) { passthroughLogged.add(shape); console.warn(`[retro] pass-through (NOT as-of): ${shape}`); }
    return undefined;
  };

  return {
    asOf, season, seasonStart,
    info: { asOf, season, seasonStart },
    savantPitchers: () => (pitchersP ??= pitchersAsOf(asOf, season, xera)).then(r => r.rows),
    savantBatters: () => (battersP ??= battersAsOf(asOf, season)).then(r => r.rows),
    interceptMlbStats,
  };
}
