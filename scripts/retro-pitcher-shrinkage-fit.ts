/**
 * How hard should each PITCHER talent component regress toward league?
 *
 * The pitcher talent vector (`computePitcherTalent`) regresses K%, BB%,
 * xwOBA-on-contact and hard-hit% through the SAME component model as batters
 * (`talentModel.computeTalent`), with the batters' league-prior weights. That
 * is a claim that a pitcher owns his contact quality after ~50 balls in play
 * the way a hitter does, and it had never been tested. The per-knob fit says
 * it is wrong: over the full-season retro cohort the talent slope reads HR
 * 0.44 and ER 0.68 (calibrated = 1.00) — the forecast spreads pitchers apart
 * on contact far more than their outcomes do.
 *
 * Same method as `retro-talent-shrinkage-fit.ts` (the batter twin): window A
 * supplies the observed rate, a strictly later window B is the target, and
 * the prior N that best predicts B out of sample is the right `leaguePriorN`.
 * Counts (K, BB, HR) are scored by Poisson log-likelihood; averages (contact
 * wOBA, IP/start) by a Gaussian with a per-unit variance measured from the
 * data, so the likelihood-ratio interval (Δll 1.92) means the same thing in
 * both.
 *
 * Two shapes:
 *
 *   TWO-WINDOW   estimate = (A + N·league) / (nA + N)
 *                No prior season, so N is an upper bound on what the engine
 *                needs (some of the stabilising work is done by last year).
 *
 *   THREE-WAY    estimate = (A + w·prior2025 + N·league) / (nA + w + N)
 *                The engine's real shape, with a REAL prior season: 2025
 *                Savant leaderboards (K%, BB%, xwOBACON, HH%) and the 2025
 *                MLB starter split (HR, BF, K, BB, IP/start). w is the engine's
 *                prior-season cap, and the fit also scales that cap (c×) —
 *                how much last season should count is the other half of the
 *                same question.
 *
 * The contact target is the pitcher's ACTUAL wOBA on contact in window B,
 * not his xwOBACON: the engine uses xwOBACON to forecast hits, homers and
 * runs, so the question is how well it predicts those. Predicting B's own
 * xwOBACON is reported alongside — it is the flattering version, since it
 * strips the part of contact outcomes nobody controls.
 *
 * The regime probe (which scales these priors per pitcher) is held neutral.
 *
 *   npx tsx scripts/retro-pitcher-shrinkage-fit.ts [minPaA=80] [minPaB=60]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { aggregateWindow, WOBA_WEIGHTS, type AggRow } from '@/lib/retro/asOf';
import { fetchStatcastPitchers } from '@/lib/mlb/savant';
import {
  PITCHER_TALENT_PRIORS, priorSeasonPaCap, priorSeasonBipCap,
  LEAGUE_HARD_HIT, HARD_HIT_TO_XWOBACON_SLOPE,
} from '@/lib/mlb/talentModel';
import {
  LEAGUE_HR_PER_CONTACT, LEAGUE_HR_PER_CONTACT_PRIOR_BIP, HR_PER_CONTACT_PRIOR_CAP,
  LEAGUE_IP_PER_START, LEAGUE_IP_PER_START_PRIOR_GS,
} from '@/lib/pitching/talent';

const SEASON = 2026;
const PRIOR_SEASON = 2025;
const minPaA = Number(process.argv[2] ?? 80);
const minPaB = Number(process.argv[3] ?? 60);
/** Engine IP/start prior-season cap (talent.ts `blendIpPerStart`). */
const IP_PRIOR_CAP_GS = 30;
const MIN_GS_A = 4;
const MIN_GS_B = 3;

const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');

// ---------------------------------------------------------------------------
// Likelihoods
// ---------------------------------------------------------------------------

/** One pitcher's evidence for one component. `num/den` are window A (den =
 *  exposure), `pNum/pDen` the prior season (pDen = its raw sample, before
 *  the cap), `capN` the engine's cap for this row, `y`/`n` window B. */
interface Row { num: number; den: number; pRate: number | null; pDen: number; capN: number; target: number; y: number; n: number }

type Kind = { kind: 'poisson' } | { kind: 'gauss'; varPerUnit: number };

function est(r: Row, N: number, capScale: number): number {
  const w = r.pRate != null ? Math.min(r.pDen, r.capN * capScale) : 0;
  return (r.num + w * (r.pRate ?? 0) + N * r.target) / (r.den + w + N);
}

function ll(rows: Row[], kind: Kind, N: number, capScale: number): number {
  let s = 0;
  for (const r of rows) {
    const e = est(r, N, capScale);
    if (kind.kind === 'poisson') {
      // y is a count over n exposure
      const mu = Math.max(r.n * e, 1e-9);
      s += r.y * Math.log(mu) - mu;
    } else {
      // y is window B's mean over n units; its variance is varPerUnit / n
      s -= (r.n * (r.y - e) ** 2) / (2 * kind.varPerUnit);
    }
  }
  return s;
}

const GRID: number[] = (() => {
  const g: number[] = [];
  for (let v = 0; v <= 60; v += 5) g.push(v);
  for (let v = 70; v <= 400; v += 10) g.push(v);
  for (let v = 425; v <= 1500; v += 25) g.push(v);
  for (let v = 1600; v <= 6000; v += 100) g.push(v);
  for (let v = 6500; v <= 20000; v += 500) g.push(v);
  return g;
})();
/** IP/start is in starts, a much smaller unit. */
const GS_GRID: number[] = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 26, 30, 40, 50, 65, 80, 100, 150, 200];
const CAP_SCALES = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 10];

function fitN(rows: Row[], kind: Kind, capScale: number, grid = GRID) {
  let best = grid[0], bestLL = -Infinity;
  const lls = grid.map(N => { const v = ll(rows, kind, N, capScale); if (v > bestLL) { bestLL = v; best = N; } return v; });
  const inside = grid.filter((_, i) => lls[i] >= bestLL - 1.92);
  const atEdge = best === grid[grid.length - 1];
  return { n: best, lo: Math.min(...inside), hi: Math.max(...inside), ll: bestLL, atEdge };
}

function fitJoint(rows: Row[], kind: Kind, grid = GRID) {
  let best = { n: 0, c: 1, ll: -Infinity };
  for (const c of CAP_SCALES) for (const N of grid) {
    const v = ll(rows, kind, N, c);
    if (v > best.ll) best = { n: N, c, ll: v };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const contact = (a: { pa: number; so: number; bb: number }) => a.pa - a.so - a.bb;
function wobacon(a: AggRow): number | null {
  const w = WOBA_WEIGHTS[SEASON];
  return a.bip > 0 ? (w.s1 * a.s1 + w.s2 * a.s2 + w.s3 * a.s3 + w.hr * a.hr) / a.bip : null;
}

interface PriorLine { gs: number; ip: number; bf: number; k: number; bb: number; hr: number }

async function fetchPriorStarterLines(): Promise<Map<number, PriorLine>> {
  const url = `https://statsapi.mlb.com/api/v1/stats?stats=statSplits&group=pitching&season=${PRIOR_SEASON}` +
    `&sitCodes=sp&playerPool=ALL&sportId=1&gameType=R&limit=5000`;
  const res = await fetch(url);
  const body = await res.json() as { stats: { splits: { player: { id: number }; stat: Record<string, unknown> }[] }[] };
  const out = new Map<number, PriorLine>();
  for (const s of body.stats[0]?.splits ?? []) {
    const st = s.stat;
    const ipStr = String(st.inningsPitched ?? '0');
    const [whole, frac] = ipStr.split('.');
    const ip = Number(whole) + Number(frac ?? 0) / 3;
    out.set(s.player.id, {
      gs: Number(st.gamesStarted ?? 0), ip, bf: Number(st.battersFaced ?? 0),
      k: Number(st.strikeOuts ?? 0), bb: Number(st.baseOnBalls ?? 0), hr: Number(st.homeRuns ?? 0),
    });
  }
  return out;
}

interface Start { id: number; date: string; ip: number }

async function main() {
  const db = getDb();
  const dres = await db.execute(sql`
    select min(game_date)::text as f, max(game_date)::text as t from statcast_events
    where game_date >= ${`${SEASON}-01-01`}`);
  const { f: first, t: last } = dres.rows[0] as { f: string; t: string };
  const endExcl = new Date(Date.parse(last) + 86400000).toISOString().slice(0, 10);
  const dateList = (await db.execute(sql`
    select distinct game_date::text as d from statcast_events where game_date >= ${first} order by 1`)).rows
    .map(r => (r as { d: string }).d);

  // Every graded start in the season, from the retro cohort (it covers the
  // full schedule): the IP/start evidence and the "is a starter" flag.
  const sres = await db.execute(sql`
    select s.mlb_id, s.game_date::text as date, (a.pitching->>'outs')::float / 3 as ip
    from forecast_snapshots s
    join player_game_actuals a on a.game_date = s.game_date and a.mlb_id = s.mlb_id
    where s.engine = 'retro-pitcher-start' and a.status = 'played'
      and coalesce((a.pitching->>'gs')::int, 0) = 1`);
  const starts: Start[] = (sres.rows as Record<string, unknown>[])
    .map(r => ({ id: Number(r.mlb_id), date: String(r.date), ip: Number(r.ip) }));

  // Per-unit noise for the Gaussian components, measured on the corpus.
  const w = WOBA_WEIGHTS[SEASON];
  const vres = await db.execute(sql`
    select var_pop(case events when 'single' then ${w.s1}::float8 when 'double' then ${w.s2}::float8
      when 'triple' then ${w.s3}::float8 when 'home_run' then ${w.hr}::float8 else 0 end) as v_woba,
      var_pop(est_woba) as v_xwoba
    from statcast_events
    where game_date >= ${first} and bb_type is not null and events is not null and events <> 'truncated_pa'`);
  const vWoba = Number((vres.rows[0] as Record<string, unknown>).v_woba);
  const vXwoba = Number((vres.rows[0] as Record<string, unknown>).v_xwoba);
  // Per-start IP variance WITHIN pitcher — the noise around a pitcher's own mean.
  const byP = new Map<number, number[]>();
  for (const s of starts) (byP.get(s.id) ?? byP.set(s.id, []).get(s.id)!).push(s.ip);
  let ss = 0, dof = 0;
  for (const ips of byP.values()) {
    if (ips.length < 2) continue;
    const m = ips.reduce((a, b) => a + b, 0) / ips.length;
    ss += ips.reduce((a, b) => a + (b - m) ** 2, 0); dof += ips.length - 1;
  }
  const vIp = ss / dof;

  // Season league anchors from the corpus.
  const season = await aggregateWindow('pitcher', first, endExcl);
  const tot = season.reduce((a, r) => ({
    pa: a.pa + r.pa, so: a.so + r.so, bb: a.bb + r.bb, hr: a.hr + r.hr, bip: a.bip + r.bip,
    wc: a.wc + (wobacon(r) ?? 0) * r.bip,
    xc: a.xc + (r.xwobacon ?? 0) * r.bip, xn: a.xn + (r.xwobacon != null ? r.bip : 0),
    hh: a.hh + (r.hardhit ?? 0) * r.bip,
  }), { pa: 0, so: 0, bb: 0, hr: 0, bip: 0, wc: 0, xc: 0, xn: 0, hh: 0 });
  const lg = {
    k: tot.so / tot.pa, bb: tot.bb / tot.pa, hrc: tot.hr / (tot.pa - tot.so - tot.bb),
    woba: tot.wc / tot.bip, xwobacon: tot.xc / tot.xn, hh: tot.hh / tot.bip,
    ip: starts.reduce((a, s) => a + s.ip, 0) / starts.length,
  };

  const [priorSavant, priorLines] = await Promise.all([
    fetchStatcastPitchers(PRIOR_SEASON), fetchPriorStarterLines(),
  ]);
  const pl = [...priorLines.values()].reduce((a, r) => ({ bf: a.bf + r.bf, k: a.k + r.k, bb: a.bb + r.bb, hr: a.hr + r.hr, ip: a.ip + r.ip, gs: a.gs + r.gs }),
    { bf: 0, k: 0, bb: 0, hr: 0, ip: 0, gs: 0 });

  const P = PITCHER_TALENT_PRIORS;
  console.log(`corpus ${first}..${last}: ${season.length} pitchers, ${tot.pa} PA; ${starts.length} graded starts`);
  console.log(`prior season ${PRIOR_SEASON}: ${priorSavant.size} Savant rows, ${priorLines.size} starter lines\n`);
  console.log(`league anchors            engine     ${SEASON} corpus   ${PRIOR_SEASON} SP line`);
  console.log(`  K/PA                    ${f(0.221, 4).padEnd(10)} ${f(lg.k, 4).padEnd(14)} ${f(pl.k / pl.bf, 4)}`);
  console.log(`  BB/PA                   ${f(0.089, 4).padEnd(10)} ${f(lg.bb, 4).padEnd(14)} ${f(pl.bb / pl.bf, 4)}`);
  console.log(`  HR/contact (PA−K−BB)    ${f(LEAGUE_HR_PER_CONTACT, 4).padEnd(10)} ${f(lg.hrc, 4).padEnd(14)} ${f(pl.hr / (pl.bf - pl.k - pl.bb), 4)}`);
  console.log(`  xwOBACON                ${f(0.368, 3).padEnd(10)} ${f(lg.xwobacon, 3).padEnd(14)}`);
  console.log(`  actual wOBACON          ${''.padEnd(10)} ${f(lg.woba, 3).padEnd(14)}`);
  console.log(`  hard-hit                ${f(LEAGUE_HARD_HIT, 3).padEnd(10)} ${f(lg.hh, 3).padEnd(14)}`);
  console.log(`  IP/start                ${f(LEAGUE_IP_PER_START, 2).padEnd(10)} ${f(lg.ip, 2).padEnd(14)} ${f(pl.ip / pl.gs, 2)}`);
  console.log(`noise: wOBA per BIP var ${f(vWoba, 4)}, xwOBA per BIP var ${f(vXwoba, 4)}, IP per start within-pitcher var ${f(vIp, 3)}\n`);

  const SPLITS = [0.4, 0.55, 0.7].map(q => dateList[Math.floor(dateList.length * q)]);

  for (const split of SPLITS) {
    const [A, B] = await Promise.all([aggregateWindow('pitcher', first, split), aggregateWindow('pitcher', split, endExcl)]);
    const bMap = new Map(B.map(r => [r.id, r]));
    const startersB = new Set(starts.filter(s => s.date >= split).map(s => s.id));
    const pairs = A.map(a => [a, bMap.get(a.id)] as const)
      .filter(([a, b]) => b && a.pa >= minPaA && b.pa >= minPaB && startersB.has(a.id)) as [AggRow, AggRow][];

    // Build rows per component. `target` for contact can be flat or HH-anchored.
    const comp: Record<string, { rows: Row[]; kind: Kind; now: number; grid?: number[] }> = {};
    const mk = (name: string, kind: Kind, now: number, rows: Row[], grid?: number[]) => { comp[name] = { rows, kind, now, grid }; };

    mk('K/PA', { kind: 'poisson' }, P.kPa, pairs.map(([a, b]) => {
      const pr = priorSavant.get(a.id);
      return { num: a.so, den: a.pa, pRate: pr?.kRate ?? null, pDen: pr?.pa ?? 0, capN: priorSeasonPaCap(a.pa), target: lg.k, y: b.so, n: b.pa };
    }));
    mk('BB/PA', { kind: 'poisson' }, P.bbPa, pairs.map(([a, b]) => {
      const pr = priorSavant.get(a.id);
      return { num: a.bb, den: a.pa, pRate: pr?.bbRate ?? null, pDen: pr?.pa ?? 0, capN: priorSeasonPaCap(a.pa), target: lg.bb, y: b.bb, n: b.pa };
    }));
    mk('HR/contact', { kind: 'poisson' }, LEAGUE_HR_PER_CONTACT_PRIOR_BIP, pairs.map(([a, b]) => {
      const pr = priorLines.get(a.id);
      const pc = pr ? pr.bf - pr.k - pr.bb : 0;
      return { num: a.hr, den: contact(a), pRate: pc > 0 ? pr!.hr / pc : null, pDen: pc, capN: HR_PER_CONTACT_PRIOR_CAP, target: lg.hrc, y: b.hr, n: contact(b) };
    }));
    const conRows = (target: (a: AggRow) => number, y: (b: AggRow) => number | null) => pairs
      .filter(([a, b]) => a.xwobacon != null && y(b) != null)
      .map(([a, b]) => {
        const pr = priorSavant.get(a.id);
        return { num: a.xwobacon! * a.bip, den: a.bip, pRate: pr?.xwobacon ?? null, pDen: pr?.bip ?? 0, capN: priorSeasonBipCap(a.bip), target: target(a), y: y(b)!, n: b.bip };
      });
    mk('xwOBACON→wOBACON', { kind: 'gauss', varPerUnit: vWoba }, P.xwobaconBip, conRows(() => lg.xwobacon, wobacon));
    // The engine anchors xwOBACON on the pitcher's own regressed hard-hit%.
    const hhAnchor = (a: AggRow, nHH: number) => {
      const pr = priorSavant.get(a.id);
      const wP = pr?.hardHitRate != null ? Math.min(pr.bip, priorSeasonBipCap(a.bip)) : 0;
      const hh = ((a.hardhit ?? lg.hh) * a.bip + wP * (pr?.hardHitRate ?? 0) + nHH * lg.hh) / (a.bip + wP + nHH);
      return lg.xwobacon + HARD_HIT_TO_XWOBACON_SLOPE * (hh - lg.hh);
    };
    mk('  …HH-anchored (engine)', { kind: 'gauss', varPerUnit: vWoba }, P.xwobaconBip, conRows(a => hhAnchor(a, P.hardHitBip), wobacon));
    // Does a heavier hard-hit prior rescue the anchor? Contact N held at 500.
    {
      const lls = [50, 200, 500, 1000, 2000, 1e9].map(nHH => {
        const rows = conRows(a => hhAnchor(a, nHH), wobacon);
        return `${nHH >= 1e9 ? 'flat' : nHH}:${ll(rows, { kind: 'gauss', varPerUnit: vWoba }, 500, 1).toFixed(1)}`;
      });
      console.log(`   hard-hit anchor prior (contact N=500, cap 1×) — ll by hard-hit N: ${lls.join('  ')}`);
    }
    mk('  …predict B xwOBACON', { kind: 'gauss', varPerUnit: vXwoba }, P.xwobaconBip, conRows(() => lg.xwobacon, b => b.xwobacon));
    // Would the pitcher's own ACTUAL contact wOBA in A predict better than xwOBACON?
    mk('  …actual wOBACON as input', { kind: 'gauss', varPerUnit: vWoba }, P.xwobaconBip, pairs
      .filter(([a, b]) => wobacon(a) != null && wobacon(b) != null)
      .map(([a, b]) => ({ num: wobacon(a)! * a.bip, den: a.bip, pRate: null, pDen: 0, capN: 0, target: lg.woba, y: wobacon(b)!, n: b.bip })));

    // IP/start
    const ipA = new Map<number, number[]>(), ipB = new Map<number, number[]>();
    for (const s of starts) {
      const m = s.date < split ? ipA : ipB;
      (m.get(s.id) ?? m.set(s.id, []).get(s.id)!).push(s.ip);
    }
    const ipRows: Row[] = [];
    for (const [id, a] of ipA) {
      const b = ipB.get(id);
      if (!b || a.length < MIN_GS_A || b.length < MIN_GS_B) continue;
      const pr = priorLines.get(id);
      ipRows.push({
        num: a.reduce((x, y) => x + y, 0), den: a.length,
        pRate: pr && pr.gs > 0 ? pr.ip / pr.gs : null, pDen: pr?.gs ?? 0, capN: IP_PRIOR_CAP_GS,
        target: lg.ip, y: b.reduce((x, y) => x + y, 0) / b.length, n: b.length,
      });
    }
    mk('IP/start', { kind: 'gauss', varPerUnit: vIp }, LEAGUE_IP_PER_START_PRIOR_GS, ipRows, GS_GRID);

    console.log(`SPLIT ${split} — ${pairs.length} starters (≥${minPaA} PA before, ≥${minPaB} PA after); IP rows ${ipRows.length}`);
    console.log(`   ${'component'.padEnd(26)} ${'two-window N [95%]'.padEnd(22)} ${'three-way N @cap [95%]'.padEnd(24)} ${'joint N, cap×'.padEnd(16)} ${'now'.padStart(5)} ${'gain vs now'.padStart(12)}`);
    for (const [name, c] of Object.entries(comp)) {
      const grid = c.grid ?? GRID;
      const two = fitN(c.rows.map(r => ({ ...r, pRate: null })), c.kind, 1, grid);
      const three = fitN(c.rows, c.kind, 1, grid);
      const joint = fitJoint(c.rows, c.kind, grid);
      const gain = joint.ll - ll(c.rows, c.kind, c.now, 1);
      const edge = (x: { atEdge: boolean }) => (x.atEdge ? '+' : '');
      console.log(
        `   ${name.padEnd(26)} ${`${two.n}${edge(two)} [${two.lo}–${two.hi}]`.padEnd(22)} ` +
        `${`${three.n}${edge(three)} [${three.lo}–${three.hi}]`.padEnd(24)} ${`${joint.n}, ${joint.c}×`.padEnd(16)} ` +
        `${String(c.now).padStart(5)} ${(gain > 0.5 ? `+${gain.toFixed(1)} ll` : '—').padStart(12)}  ll@joint ${joint.ll.toFixed(1)}   (n=${c.rows.length})`,
      );
    }
    console.log('');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
