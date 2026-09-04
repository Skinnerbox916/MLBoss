/**
 * How hard should each batter category regress toward league?
 *
 * `CATEGORY_BASELINE_CONFIG` gives every category the same `leaguePriorN`
 * of 100 PA. That cannot be right for all of them: strikeout rate is an
 * individual skill that stabilises in ~60-120 PA, while runs and RBI are
 * mostly a function of who bats around you. Giving them the same prior
 * over-trusts a player's own R/PA, and the per-knob fit sees exactly that —
 * a talent slope of 1.02 for K and 1.03 for BB (calibrated) against 0.67 for
 * R and 0.65 for RBI (badly over-spread), with the lineup-spot run-context
 * knob under-applied at 1.35 for R. Those are the same error from two sides:
 * too much weight on the individual, too little on his context.
 *
 * This fits the prior directly, out of sample. For each batter, window A
 * (before a split date) supplies the observed rate and window B (after it)
 * is the target:
 *
 *   estimate(N) = (countA + N·target) / (paA + N)
 *   score(N)    = Poisson log-likelihood of countB given paB · estimate(N)
 *
 * The N that best predicts the future IS the right `leaguePriorN`. R and RBI
 * are not plate-appearance events so the Statcast corpus cannot supply them
 * (this is the same limit that makes retro platoon ratios fall back to the
 * population prior for R/RBI); the ledger's `player_game_actuals` can, and
 * does, for every graded batter-day.
 *
 * It also asks the second half of the question — WHAT to regress toward. A
 * flat league mean says a leadoff hitter on a great offence and a number-nine
 * hitter on a bad one are the same prior. Shrinking instead toward the league
 * rate for that batter's own lineup slot tests whether the context the `order`
 * knob is under-applying belongs in the baseline.
 *
 *   npx tsx scripts/retro-talent-shrinkage-fit.ts [engine=retro-batter-day]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { CATEGORY_BASELINE_CONFIG } from '@/lib/mlb/categoryBaselines';

/** Graded batter-days carry these. Exposure is PA for all but AVG, whose
 *  rate is per AB — the same basis `CATEGORY_BASELINE_CONFIG` uses. */
const STATS: [string, number, 'pa' | 'ab'][] = [
  ['r', 7, 'pa'], ['h', 8, 'pa'], ['hr', 12, 'pa'], ['rbi', 13, 'pa'],
  ['sb', 16, 'pa'], ['bb', 18, 'pa'], ['k', 21, 'pa'], ['tb', 23, 'pa'],
  ['doubles', 10, 'pa'], ['triples', 11, 'pa'], ['hbp', 20, 'pa'],
  ['avg', 3, 'ab'],
];
/** Window-A PA below which a rate says nothing. */
const MIN_PA_A = 80;
/** Window-B PA below which there is nothing to predict. */
const MIN_PA_B = 40;

interface Day { date: string; mlbId: number; spot: number | null; pa: number; ab: number; c: Record<string, number> }
interface Cell { pa: number; ab: number; c: Record<string, number>; spots: number[] }
const expo = (cell: { pa: number; ab: number }, basis: 'pa' | 'ab') => (basis === 'ab' ? cell.ab : cell.pa);

const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '  —  ');

/** How much of each category's baseline `leaguePriorN` actually controls.
 *  raw   = the whole thing (no expected-stat equivalent exists)
 *  60/40 = only the 40% raw side; a Statcast talent rate carries the rest
 *  fallb = only when the talent gate fails (effectivePA < 100) */
const PATH: Record<number, string> = {
  7: 'raw', 13: 'raw', 12: 'raw', 16: 'raw', 10: 'raw', 11: 'raw', 20: 'raw',
  3: '60/40', 8: '60/40', 23: '60/40',
  18: 'fallback', 21: 'fallback',
};

/** Poisson log-likelihood of the held-out window under shrinkage `n`. */
function score(rows: { paA: number; cA: number; paB: number; cB: number; target: number }[], n: number): number {
  let ll = 0;
  for (const r of rows) {
    const est = (r.cA + n * r.target) / (r.paA + n);
    const mu = Math.max(r.paB * est, 1e-9);
    ll += r.cB * Math.log(mu) - mu;
  }
  return ll;
}

/** Grid-search the prior, then report a likelihood-ratio interval (Δll 1.92). */
function bestN(rows: { paA: number; cA: number; paB: number; cB: number; target: number }[]) {
  const grid: number[] = [];
  for (let v = 0; v <= 60; v += 5) grid.push(v);
  for (let v = 70; v <= 400; v += 10) grid.push(v);
  for (let v = 425; v <= 1500; v += 25) grid.push(v);
  for (let v = 1600; v <= 6000; v += 100) grid.push(v);
  let best = grid[0], bestLL = -Infinity;
  const lls = grid.map(n => { const ll = score(rows, n); if (ll > bestLL) { bestLL = ll; best = n; } return ll; });
  const inside = grid.filter((_, i) => lls[i] >= bestLL - 1.92);
  return { n: best, lo: Math.min(...inside), hi: Math.max(...inside), ll: bestLL };
}

async function main() {
  const engine = process.argv[2] ?? 'retro-batter-day';
  const db = getDb();

  const res = await db.execute(sql`
    select s.game_date::text as date, s.mlb_id, s.context->>'spot' as spot, a.batting
    from forecast_snapshots s
    join player_game_actuals a on a.game_date = s.game_date and a.mlb_id = s.mlb_id
    where s.engine = ${engine} and a.status = 'played' and a.batting is not null`);

  const days: Day[] = [];
  for (const r of res.rows as Record<string, unknown>[]) {
    const b = r.batting as Record<string, number>;
    if (!(b.pa > 0)) continue;
    const spot = r.spot == null ? null : Number(r.spot);
    days.push({
      date: r.date as string, mlbId: Number(r.mlb_id),
      spot: spot != null && spot >= 1 && spot <= 9 ? spot : null,
      pa: b.pa, ab: b.ab ?? b.pa,
      c: Object.fromEntries(STATS.map(([k]) => [k, k === 'avg' ? (b.h ?? 0) : (b[k] ?? 0)])),
    });
  }
  const dates = [...new Set(days.map(d => d.date))].sort();
  console.log(`${engine}: ${days.length} graded batter-games, ${dates[0]}..${dates[dates.length - 1]}`);
  console.log(`current config: every category uses leaguePriorN = 100 (except SB 80, and 2 others)\n`);

  // League rate per stat, and per lineup slot — the two shrink targets.
  const lgAll: Record<string, { c: number; pa: number }> = {};
  const lgSpot: Record<number, Record<string, { c: number; pa: number }>> = {};
  for (const d of days) {
    for (const [k, , basis] of STATS) {
      const e = expo(d, basis);
      (lgAll[k] ??= { c: 0, pa: 0 }).c += d.c[k]; lgAll[k].pa += e;
      if (d.spot != null) {
        const bySpot = (lgSpot[d.spot] ??= {});
        (bySpot[k] ??= { c: 0, pa: 0 }).c += d.c[k]; bySpot[k].pa += e;
      }
    }
  }
  const leagueRate = (k: string) => lgAll[k].c / lgAll[k].pa;
  const spotRate = (k: string, spot: number | null) =>
    spot != null && lgSpot[spot]?.[k] ? lgSpot[spot][k].c / lgSpot[spot][k].pa : leagueRate(k);

  console.log(`league rate by lineup slot (the context a flat prior throws away):`);
  console.log(`   ${'stat'.padEnd(5)} ${'engine mean'.padStart(12)} ${'cohort'.padStart(8)} ${[1,2,3,4,5,6,7,8,9].map(s => `sp${s}`.padStart(7)).join('')}  spread`);
  for (const [k, id] of STATS) {
    const cfg = CATEGORY_BASELINE_CONFIG[id];
    const bySpot = [1,2,3,4,5,6,7,8,9].map(sp => spotRate(k, sp));
    console.log(`   ${k.padEnd(5)} ${f(cfg.leagueMean).padStart(12)} ${f(leagueRate(k)).padStart(8)} ${bySpot.map(v => f(v).padStart(7)).join('')}  ${f(Math.max(...bySpot) / Math.min(...bySpot), 2)}x`);
  }

  const SPLITS = [dates[Math.floor(dates.length * 0.4)], dates[Math.floor(dates.length * 0.55)], dates[Math.floor(dates.length * 0.7)]];
  for (const split of SPLITS) {
    const A = new Map<number, Cell>(), B = new Map<number, Cell>();
    for (const d of days) {
      const into = d.date < split ? A : B;
      const cell = into.get(d.mlbId) ?? { pa: 0, ab: 0, c: Object.fromEntries(STATS.map(([k]) => [k, 0])), spots: [] };
      cell.pa += d.pa; cell.ab += d.ab;
      for (const [k] of STATS) cell.c[k] += d.c[k];
      if (d.spot != null) cell.spots.push(d.spot);
      into.set(d.mlbId, cell);
    }
    const ids = [...A.keys()].filter(id => (A.get(id)!.pa >= MIN_PA_A) && ((B.get(id)?.pa ?? 0) >= MIN_PA_B));
    console.log(`\nSPLIT ${split} — ${ids.length} batters (≥${MIN_PA_A} PA before, ≥${MIN_PA_B} PA after)`);
    console.log(`   ${'stat'.padEnd(5)} ${'path'.padEnd(11)} ${'fitted N (95% CI)'.padEnd(24)} ${'now'.padStart(4)} ${'gain vs now'.padStart(12)} ${'→ lineup slot'.padEnd(20)} slot?`);
    for (const [k, id, basis] of STATS) {
      const mk = (useSpot: boolean) => ids.map(pid => {
        const a = A.get(pid)!, b = B.get(pid)!;
        const modal = a.spots.length
          ? Number([...a.spots].sort((x, y) => a.spots.filter(v => v === x).length - a.spots.filter(v => v === y).length).pop())
          : null;
        return { paA: expo(a, basis), cA: a.c[k], paB: expo(b, basis), cB: b.c[k], target: useSpot ? spotRate(k, modal) : leagueRate(k) };
      });
      const rows = mk(false);
      const flat = bestN(rows), ctx = bestN(mk(true));
      const cur = CATEGORY_BASELINE_CONFIG[id].leaguePriorN;
      const gainVsNow = flat.ll - score(rows, cur);
      const slotGain = ctx.ll - flat.ll;
      console.log(
        `   ${k.padEnd(5)} ${PATH[id].padEnd(11)} ${`${flat.n} [${flat.lo}–${flat.hi}]`.padEnd(24)} ${String(cur).padStart(4)} ` +
        `${(gainVsNow > 0.5 ? `+${gainVsNow.toFixed(1)} ll` : '—').padStart(12)} ${`${ctx.n} [${ctx.lo}–${ctx.hi}]`.padEnd(20)} ` +
        `${slotGain > 2 ? `+${slotGain.toFixed(1)}` : slotGain < -2 ? `${slotGain.toFixed(1)}` : 'tie'}`,
      );
    }
  }
  // --- the engine's actual three-way blend -------------------------------
  // `blendRate` is a weighted average of THREE things, not two: the current
  // rate (weight = PA), the prior season (weight = min(priorPA, 250) shrunk
  // by priorPA/400, so 250 at most), and the league mean (weight =
  // leaguePriorN). The two-window fit above has no prior-season term, so its
  // N is an upper bound — some of the stabilising work is already being done
  // by the player's own past. Redo it with a prior window in place:
  //
  //   estimate = (cA + wPrior·rate0 + N·league) / (paA + wPrior + N)
  //
  // W0 stands in for the prior season. It is same-season data so it is a
  // FRIENDLIER prior than a real previous year would be, which makes the N
  // reported here a conservative (low) estimate of what the engine needs.
  const t1 = dates[Math.floor(dates.length * 0.3)];
  const t2 = dates[Math.floor(dates.length * 0.6)];
  const W: Record<'w0' | 'wa' | 'wb', Map<number, Cell>> = { w0: new Map(), wa: new Map(), wb: new Map() };
  for (const d of days) {
    const key = d.date < t1 ? 'w0' : d.date < t2 ? 'wa' : 'wb';
    const m = W[key];
    const cell = m.get(d.mlbId) ?? { pa: 0, ab: 0, c: Object.fromEntries(STATS.map(([k]) => [k, 0])), spots: [] };
    cell.pa += d.pa; cell.ab += d.ab;
    for (const [k] of STATS) cell.c[k] += d.c[k];
    m.set(d.mlbId, cell);
  }
  const PRIOR_W = 250;   // the engine's capped prior-season weight
  const ids3 = [...W.wa.keys()].filter(id =>
    (W.w0.get(id)?.pa ?? 0) >= 60 && W.wa.get(id)!.pa >= 60 && (W.wb.get(id)?.pa ?? 0) >= MIN_PA_B);
  console.log(`\nTHREE-WAY (the engine's real shape) — prior window ${dates[0]}..${t1}, current ${t1}..${t2}, target ${t2}..`);
  console.log(`   ${ids3.length} batters; prior term held at the engine's cap of ${PRIOR_W}`);
  console.log(`   ${'stat'.padEnd(8)} ${'path'.padEnd(11)} ${'N | prior@250'.padEnd(22)} ${'now'.padStart(4)} ${'gain vs now'.padStart(12)}  two-window N`);
  for (const [k, id, basis] of STATS) {
    const rows = ids3.map(pid => {
      const zero = W.w0.get(pid)!, a = W.wa.get(pid)!, b = W.wb.get(pid)!;
      const e0 = expo(zero, basis), ea = expo(a, basis);
      return { rate0: e0 > 0 ? zero.c[k] / e0 : leagueRate(k), paA: ea, cA: a.c[k], paB: expo(b, basis), cB: b.c[k] };
    });
    // score with the prior term folded in as extra pseudo-counts
    const scoreN = (n: number) => {
      let ll = 0;
      for (const r of rows) {
        const est = (r.cA + PRIOR_W * r.rate0 + n * leagueRate(k)) / (r.paA + PRIOR_W + n);
        const mu = Math.max(r.paB * est, 1e-9);
        ll += r.cB * Math.log(mu) - mu;
      }
      return ll;
    };
    const grid: number[] = [];
    for (let v = 0; v <= 60; v += 5) grid.push(v);
    for (let v = 70; v <= 400; v += 10) grid.push(v);
    for (let v = 425; v <= 1500; v += 25) grid.push(v);
    for (let v = 1600; v <= 6000; v += 100) grid.push(v);
    let best = 0, bestLL = -Infinity;
    const lls = grid.map(n => { const ll = scoreN(n); if (ll > bestLL) { bestLL = ll; best = n; } return ll; });
    const inside = grid.filter((_, i) => lls[i] >= bestLL - 1.92);
    const cur = CATEGORY_BASELINE_CONFIG[id].leaguePriorN;
    const gain = bestLL - scoreN(cur);
    console.log(
      `   ${k.padEnd(8)} ${PATH[id].padEnd(11)} ${`${best} [${Math.min(...inside)}–${Math.max(...inside)}]`.padEnd(22)} ${String(cur).padStart(4)} ` +
      `${(gain > 0.5 ? `+${gain.toFixed(1)} ll` : '—').padStart(12)}`,
    );
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
