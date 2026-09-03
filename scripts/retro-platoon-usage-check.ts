/**
 * Does a manager's USAGE of a batter predict the size of that batter's
 * platoon split? Straight from the pitch corpus — no engine, no forecasts,
 * no as-of machinery.
 *
 * WHY THIS EXISTS. The per-knob study (docs/forecast-verification.md#the-
 * platoon-knob) found the largest single effect in the batter model:
 * the population platoon table is delivered at ~0.2–0.4x for everyday bats
 * and ~1.8–3.2x for bats a manager shields from their weak hand. Managers
 * platoon the players who have splits, so usage is a revealed-preference
 * read on split size that a 120-PA vs-hand rate cannot match. It did not
 * survive a time split there, and the open question was whether that was
 * regression to the mean or noise in the engine's residuals.
 *
 * This asks the same question of reality instead of of the engine, which is
 * both cheaper and cleaner: the engine, its talent layer and its other knobs
 * are all out of the loop.
 *
 *   window A (before the split date) → shield: the batter's own share of PA
 *     against his weak hand, over the league's share for his stance, shrunk
 *     toward league-typical so a thin April sample cannot swing it.
 *   window B (from the split date)   → split: his same-hand rate against his
 *     own opposite-hand rate in the SAME window, so talent, park and league
 *     drift all divide out.
 *
 * Model per stat, one row per batter — a CONDITIONAL comparison:
 *
 *   sameCount ~ Binomial( sameCount + oppCount,  p )
 *   logit(p) = log(PA_same / PA_opp) + a + b·(1 − shield)
 *
 * Conditioning on the batter's own two-cell total makes his overall rate
 * cancel out of the likelihood, so there is no per-player parameter to fit
 * and — crucially — no noisy "reference rate" to divide by. That matters
 * here more than it looks: a right-handed batter's opposite hand is LHP,
 * only ~32% of his plate appearances, so any design needing a well-measured
 * opposite-hand rate quietly throws away most of the league.
 *
 * exp(a) is the tilt for a batter used like an everyday player; b is how
 * that tilt scales with shielding. Reported as the implied tilt at each end
 * of the cohort's own shield range rather than as a raw coefficient, because
 * the sign of a platoon effect differs by stat (same-hand raises K, lowers
 * everything else).
 *
 * Guards, because a mechanical route to a positive answer would be easy:
 *   - PERMUTATION. 200 refits with shield shuffled among batters of the same
 *     stance, giving an exact p-value that needs no distributional
 *     assumption and self-calibrates against any quirk of the design.
 *   - IN- vs OUT-OF-SAMPLE. The same fit with the split measured in window A,
 *     where the usage was measured. The gap IS the regression to the mean.
 *   - VS STARTERS ONLY. The confound that would make this unusable: a
 *     shielded batter meets his weak hand mostly through a relief specialist
 *     brought in to beat him, an everyday batter mostly through a starter. If
 *     the gap is the arm rather than the batter it disappears when both are
 *     restricted to starters — which is also the only case the slate surfaces
 *     ever forecast.
 *   - THRESHOLD. Where the shielded tail is cut, since the cut was chosen
 *     from the bucket table rather than in advance.
 *   - Three split dates, and Benjamini–Hochberg over the whole test family.
 *
 *   npx tsx scripts/retro-platoon-usage-check.ts [season=2026] [permutations=200]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { aggregateWindow, type AggRow } from '@/lib/retro/asOf';
import { binomialFit, benjaminiHochberg } from '@/lib/retro/fitEval';

type Hand = 'L' | 'R';
/** Stats the corpus can carry as PA events (R/RBI/SB are not). */
const STATS: [string, (r: AggRow) => number][] = [
  ['tb', r => r.s1 + 2 * r.s2 + 3 * r.s3 + 4 * r.hr],
  ['h', r => r.s1 + r.s2 + r.s3 + r.hr],
  ['hr', r => r.hr],
  ['k', r => r.so],
  ['bb', r => r.bb],
];
/** PA of league-typical usage mixed into shield — enough to tame a 30-PA
 *  sample, not enough to erase a 300-PA one. Kept low on purpose: a heavy
 *  shrink pulls the shielded tail toward 1.0, which is the tail under test. */
const SHIELD_SHRINK = 60;
/** Window-A PA below which usage isn't readable at all. Deliberately low —
 *  shielded batters have few PA by definition, so a high floor removes the
 *  very population the question is about; the shrink does the work instead. */
const USAGE_MIN_PA = 50;

interface Batter { id: number; stance: Hand; shield: number }
interface Cell { pa: number; counts: Record<string, number> }

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '  —  ');
const cellsOf = (rows: AggRow[]) => {
  const m = new Map<string, Cell>();
  for (const r of rows) {
    if (!r.hand) continue;
    m.set(`${r.id}|${r.hand}`, { pa: r.pa, counts: Object.fromEntries(STATS.map(([k, f]) => [k, f(r)])) });
  }
  return m;
};

/**
 * Fit one stat: the same-hand tilt (`a`) and how it moves with the supplied
 * regressor (`b`). `xOf` is the shape being tested — a continuous ramp in
 * shielding, or a flat indicator for the shielded tail.
 */
function fitStat(
  batters: Batter[],
  cells: Map<string, Cell>,
  stat: string,
  xOf: (b: Batter) => number,
): { a: number; b: number; se: number; n: number; pa: number } | null {
  const X: number[][] = [], y: number[] = [], trials: number[] = [], off: number[] = [];
  let paSeen = 0;
  for (const bat of batters) {
    const opp: Hand = bat.stance === 'L' ? 'R' : 'L';
    const same = cells.get(`${bat.id}|${bat.stance}`);
    const other = cells.get(`${bat.id}|${opp}`);
    if (!same || !other || same.pa < 1 || other.pa < 1) continue;
    const total = same.counts[stat] + other.counts[stat];
    if (total < 1) continue;                   // no information in this cell pair
    X.push([1, xOf(bat)]);
    y.push(same.counts[stat]);
    trials.push(total);
    off.push(Math.log(same.pa / other.pa));
    paSeen += same.pa + other.pa;
  }
  if (X.length < 60) return null;
  const fit = binomialFit(X, y, trials, off);
  if (!fit) return null;
  // Separation: a group with no events at all (a handful of shielded bats and
  // zero same-hand home runs between them) sends the coefficient to infinity.
  // That is an empty cell, not a finding.
  if (Math.abs(fit.beta[1]) > 5 || fit.se[1] > 5) return null;
  return { a: fit.beta[0], b: fit.beta[1], se: fit.se[1], n: X.length, pa: paSeen };
}

/** Deterministic PRNG so a permutation p-value is reproducible run to run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

async function main() {
  const season = Number(process.argv[2] ?? 2026);
  const PERMS = Number(process.argv[3] ?? 200);
  const db = getDb();

  const bounds = (await db.execute(sql`
    select min(game_date)::text as f, max(game_date)::text as t
    from statcast_events where game_date >= ${`${season}-01-01`} and game_date < ${`${season + 1}-01-01`}`)).rows[0] as { f: string; t: string };
  if (!bounds?.f) { console.log(`no corpus for ${season}`); process.exit(1); }
  const end = new Date(`${bounds.t}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  const endEx = end.toISOString().slice(0, 10);
  console.log(`corpus ${season}: ${bounds.f} .. ${bounds.t}   ${PERMS} permutations per test\n`);

  // Stance from the season's own pitches. A switch hitter shows both sides;
  // he has no weak hand to be shielded from, so he is out of scope.
  const stanceRows = (await db.execute(sql`
    select batter, count(*) filter (where stand = 'L') as l, count(*) filter (where stand = 'R') as r
    from statcast_events where game_date >= ${bounds.f} and game_date <= ${bounds.t} group by 1`)).rows as Record<string, string | number>[];
  const stance = new Map<number, Hand>();
  let switches = 0;
  for (const s of stanceRows) {
    const l = Number(s.l), r = Number(s.r);
    if (l + r === 0) continue;
    if (Math.min(l, r) / (l + r) > 0.05) { switches++; continue; }
    stance.set(Number(s.batter), l > r ? 'L' : 'R');
  }

  const SPLITS = [`${season}-05-25`, `${season}-06-25`, `${season}-07-20`];
  const tests: { key: string; p: number }[] = [];

  for (const split of SPLITS) {
    const [aRows, bRows, bStarterRows] = await Promise.all([
      aggregateWindow('batter', `${season}-01-01`, split, { byOpposingHand: true }),
      aggregateWindow('batter', split, endEx, { byOpposingHand: true }),
      aggregateWindow('batter', split, endEx, { byOpposingHand: true, vsStarterOnly: true }),
    ]);
    const aCells = cellsOf(aRows), bCells = cellsOf(bRows), bStarterCells = cellsOf(bStarterRows);

    // League share of PA against each stance's weak hand, in window A.
    const lg: Record<Hand, { weak: number; tot: number }> = { L: { weak: 0, tot: 0 }, R: { weak: 0, tot: 0 } };
    for (const r of aRows) {
      const st = stance.get(r.id);
      if (!st || !r.hand) continue;
      lg[st].tot += r.pa;
      if (r.hand === st) lg[st].weak += r.pa;
    }
    const lambda: Record<Hand, number> = { L: lg.L.weak / lg.L.tot, R: lg.R.weak / lg.R.tot };

    const batters: Batter[] = [];
    for (const [id, st] of stance) {
      const weak = aCells.get(`${id}|${st}`)?.pa ?? 0;
      const strong = aCells.get(`${id}|${st === 'L' ? 'R' : 'L'}`)?.pa ?? 0;
      const tot = weak + strong;
      if (tot < USAGE_MIN_PA) continue;
      const lam = lambda[st];
      batters.push({ id, stance: st, shield: ((weak + SHIELD_SHRINK * lam) / (tot + SHIELD_SHRINK)) / lam });
    }
    const sh = batters.map(b => b.shield).sort((x, y) => x - y);
    const q = (p: number) => sh[Math.floor(p * (sh.length - 1))];
    const [lo, hi] = [q(0.1), q(0.9)];
    console.log(`SPLIT ${split} — window A ${bounds.f}..${split}, window B ${split}..${bounds.t}`);
    console.log(`   ${batters.length} batters with ≥${USAGE_MIN_PA} PA in window A (${switches} switch hitters excluded — no weak hand to shield)`);
    console.log(`   league weak-hand PA share: LHB ${f3(lambda.L)}  RHB ${f3(lambda.R)}`);
    console.log(`   shield: p10 ${f3(lo)}  p25 ${f3(q(0.25))}  median ${f3(q(0.5))}  p75 ${f3(q(0.75))}  p90 ${f3(hi)}`);

    console.log(`\n   model-free — same-hand rate ÷ own opposite-hand rate, measured AFTER the split`);
    console.log(`   ${'shield'.padEnd(16)} ${'n'.padStart(4)}  ${STATS.map(([k]) => k.padStart(7)).join('')}`);
    for (const [label, blo, bhi] of [['shielded <0.80', 0, 0.8], ['0.80–0.95', 0.8, 0.95], ['0.95–1.05', 0.95, 1.05], ['everyday ≥1.05', 1.05, 99]] as const) {
      const grp = batters.filter(b => b.shield >= blo && b.shield < bhi);
      const parts = STATS.map(([stat]) => {
        let sc = 0, sp = 0, oc = 0, op = 0;
        for (const bat of grp) {
          const opp: Hand = bat.stance === 'L' ? 'R' : 'L';
          const same = bCells.get(`${bat.id}|${bat.stance}`), other = bCells.get(`${bat.id}|${opp}`);
          if (!same || !other || same.pa < 1 || other.pa < 1) continue;
          sc += same.counts[stat]; sp += same.pa; oc += other.counts[stat]; op += other.pa;
        }
        return (sp > 0 && op > 0 && oc > 0 ? ((sc / sp) / (oc / op)).toFixed(3) : '  —  ').padStart(7);
      });
      console.log(`   ${label.padEnd(16)} ${String(grp.length).padStart(4)}  ${parts.join('')}`);
    }

    // Shapes. The ramp asks whether the tilt scales with shielding across the
    // whole range; the tail asks only whether the shielded end differs from
    // everyone else, which is what the buckets above look like and is one
    // degree of freedom rather than a line through mostly-flat data.
    const VIEWS: [string, Map<string, Cell>][] = [['all PA', bCells], ['vs starters only', bStarterCells]];
    const SHAPES: [string, (b: Batter) => number, string][] = [
      ['ramp', b => 1 - b.shield, `p10 ${f3(lo)} vs p90 ${f3(hi)}`],
      ['tail', b => (b.shield < 0.8 ? 1 : 0), `shield <0.80 vs the rest`],
    ];
    const permute = (seed: number) => {
      const rand = rng(seed);
      const pool: Record<Hand, number[]> = { L: [], R: [] };
      for (const b of batters) pool[b.stance].push(b.shield);
      for (const st of ['L', 'R'] as Hand[]) {
        const arr = pool[st];
        for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      }
      const idx: Record<Hand, number> = { L: 0, R: 0 };
      const map = new Map<number, number>();
      for (const b of batters) map.set(b.id, pool[b.stance][idx[b.stance]++]);
      return map;
    };

    for (const [view, cells] of VIEWS) {
      for (const [shape, xOf, blurb] of SHAPES) {
        if (view !== 'all PA' && shape === 'ramp') continue;   // the ramp is settled; don't re-litigate it per view
        const at = (f: { a: number; b: number }, shielded: boolean) =>
          Math.exp(f.a + f.b * (shape === 'ramp' ? 1 - (shielded ? lo : hi) : shielded ? 1 : 0));
        console.log(`\n   fitted [${shape}, ${view}] — ${blurb}`);
        console.log(`   ${'stat'.padEnd(5)} ${'n'.padStart(4)} ${'everyday'.padEnd(9)} ${'shielded'.padEnd(9)} ${'ratio'.padEnd(6)} ${'coef b'.padEnd(16)} ${'perm p'.padEnd(7)} ${'null |b| p95'.padEnd(13)} in-sample ratio`);
        for (const [stat] of STATS) {
          const real = fitStat(batters, cells, stat, xOf);
          if (!real) { console.log(`   ${stat.padEnd(5)} — (too few batters)`); continue; }
          const nulls: number[] = [];
          for (let k = 0; k < PERMS; k++) {
            const map = permute(1000 + k * 7 + stat.length + shape.length * 31 + view.length * 97);
            const f = fitStat(batters, cells, stat, b => xOf({ ...b, shield: map.get(b.id)! }));
            if (f) nulls.push(f.b);
          }
          const permP = nulls.length ? nulls.filter(v => Math.abs(v) >= Math.abs(real.b)).length / nulls.length : NaN;
          const p95 = nulls.length ? [...nulls.map(Math.abs)].sort((x, y) => x - y)[Math.floor(0.95 * (nulls.length - 1))] : NaN;
          const inSample = fitStat(batters, aCells, stat, xOf);
          const ratioOf = (f: { a: number; b: number }) => Math.log(at(f, true)) / Math.log(at(f, false));
          tests.push({ key: `${split}:${stat}:${shape}:${view}`, p: permP });
          console.log(
            `   ${stat.padEnd(5)} ${String(real.n).padStart(4)} ` +
            `${f3(at(real, false)).padEnd(9)} ${f3(at(real, true)).padEnd(9)} ${ratioOf(real).toFixed(2).padEnd(6)} ` +
            `${`${real.b >= 0 ? '+' : ''}${real.b.toFixed(3)}±${real.se.toFixed(3)}`.padEnd(16)} ` +
            `${permP.toFixed(3).padEnd(7)} ${f3(p95).padEnd(13)} ${inSample ? ratioOf(inSample).toFixed(2) : '—'}`,
          );
        }
      }
    }

    console.log(`\n   threshold sensitivity — tail coefficient ± SE at three cut points (vs starters only)`);
    console.log(`   ${'stat'.padEnd(5)} ${'<0.75'.padEnd(18)} ${'<0.80'.padEnd(18)} <0.85`);
    for (const [stat] of STATS) {
      const cells = bStarterCells;
      const parts = [0.75, 0.8, 0.85].map(thr => {
        const f = fitStat(batters, cells, stat, b => (b.shield < thr ? 1 : 0));
        const n = batters.filter(b => b.shield < thr).length;
        return f ? `${f.b >= 0 ? '+' : ''}${f.b.toFixed(3)}±${f.se.toFixed(3)} (${n})`.padEnd(18) : '—'.padEnd(18);
      });
      console.log(`   ${stat.padEnd(5)} ${parts.join('')}`);
    }
    console.log('');
  }

  // --- who is actually in the shielded tail? -------------------------------
  // The effect only matters if the batters carrying it are rosterable. Rank
  // the season by playing time, name the shielded ones, and re-run the tail
  // fit inside playing-time bands: if it survives among everyday regulars it
  // is a fantasy signal, and if it lives only in the part-time tail it is not.
  const full = await aggregateWindow('batter', `${season}-01-01`, endEx, { byOpposingHand: true });
  const fullStarter = await aggregateWindow('batter', `${season}-01-01`, endEx, { byOpposingHand: true, vsStarterOnly: true });
  const fullCells = cellsOf(full), fullStarterCells = cellsOf(fullStarter);
  const names = new Map<number, string>();
  for (const r of (await db.execute(sql`
    select distinct on (mlb_id) mlb_id, player_name from forecast_snapshots
    where engine like '%batter%' order by mlb_id, game_date desc`)).rows as Record<string, string | number>[]) {
    names.set(Number(r.mlb_id), String(r.player_name));
  }
  const lgFull: Record<Hand, { weak: number; tot: number }> = { L: { weak: 0, tot: 0 }, R: { weak: 0, tot: 0 } };
  for (const r of full) {
    const st = stance.get(r.id);
    if (!st || !r.hand) continue;
    lgFull[st].tot += r.pa;
    if (r.hand === st) lgFull[st].weak += r.pa;
  }
  const lamFull: Record<Hand, number> = { L: lgFull.L.weak / lgFull.L.tot, R: lgFull.R.weak / lgFull.R.tot };
  const season_: Batter[] = [];
  const paOf = new Map<number, number>();
  for (const [id, st] of stance) {
    const weak = fullCells.get(`${id}|${st}`)?.pa ?? 0;
    const strong = fullCells.get(`${id}|${st === 'L' ? 'R' : 'L'}`)?.pa ?? 0;
    const tot = weak + strong;
    if (tot < USAGE_MIN_PA) continue;
    const lam = lamFull[st];
    season_.push({ id, stance: st, shield: ((weak + SHIELD_SHRINK * lam) / (tot + SHIELD_SHRINK)) / lam });
    paOf.set(id, tot);
  }
  const ranked = [...season_].sort((a, b) => paOf.get(b.id)! - paOf.get(a.id)!);
  const rank = new Map(ranked.map((b, i) => [b.id, i + 1]));

  console.log(`\nWHO IS IN THE SHIELDED TAIL? — full season, ${ranked.length} batters with ≥${USAGE_MIN_PA} PA, ranked by PA`);
  console.log(`   ${'PA rank band'.padEnd(14)} ${'n'.padStart(4)} ${'shielded <0.80'.padStart(15)} ${'median PA'.padStart(10)} ${'shielded median PA'.padStart(19)}`);
  const BANDS: [string, number, number][] = [['1–150', 1, 150], ['151–250', 151, 250], ['251–350', 251, 350], ['351+', 351, 9999]];
  for (const [label, lo2, hi2] of BANDS) {
    const band = ranked.filter(b => rank.get(b.id)! >= lo2 && rank.get(b.id)! <= hi2);
    if (!band.length) continue;
    const sh = band.filter(b => b.shield < 0.8);
    const med = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN;
    console.log(`   ${label.padEnd(14)} ${String(band.length).padStart(4)} ${`${sh.length} (${Math.round(100 * sh.length / band.length)}%)`.padStart(15)} ${String(med(band.map(b => paOf.get(b.id)!))).padStart(10)} ${String(med(sh.map(b => paOf.get(b.id)!)) || '—').padStart(19)}`);
  }

  console.log(`\n   the 20 most-used shielded batters (shield <0.80), by season PA:`);
  const topShield = ranked.filter(b => b.shield < 0.8).slice(0, 20);
  for (const b of topShield) {
    const weak = fullCells.get(`${b.id}|${b.stance}`)?.pa ?? 0;
    console.log(`     #${String(rank.get(b.id)).padStart(3)}  ${(names.get(b.id) ?? String(b.id)).padEnd(24)} ${b.stance}HB  ${String(paOf.get(b.id)).padStart(4)} PA  shield ${f3(b.shield)}  (${weak} vs ${b.stance}HP)`);
  }

  console.log(`\n   does the tail effect survive among the batters people actually roster?`);
  console.log(`   TIME-SPLIT: usage and playing-time rank from before ${SPLITS[1]}, outcome after it, vs starters only`);
  const mid = SPLITS[1];
  const [midA, midB] = await Promise.all([
    aggregateWindow('batter', `${season}-01-01`, mid, { byOpposingHand: true }),
    aggregateWindow('batter', mid, endEx, { byOpposingHand: true, vsStarterOnly: true }),
  ]);
  const midACells = cellsOf(midA), midBCells = cellsOf(midB);
  const lgMid: Record<Hand, { weak: number; tot: number }> = { L: { weak: 0, tot: 0 }, R: { weak: 0, tot: 0 } };
  for (const r of midA) {
    const st = stance.get(r.id);
    if (!st || !r.hand) continue;
    lgMid[st].tot += r.pa;
    if (r.hand === st) lgMid[st].weak += r.pa;
  }
  const lamMid: Record<Hand, number> = { L: lgMid.L.weak / lgMid.L.tot, R: lgMid.R.weak / lgMid.R.tot };
  const midBatters: Batter[] = [];
  const midPA = new Map<number, number>();
  for (const [id, st] of stance) {
    const weak = midACells.get(`${id}|${st}`)?.pa ?? 0;
    const strong = midACells.get(`${id}|${st === 'L' ? 'R' : 'L'}`)?.pa ?? 0;
    const tot = weak + strong;
    if (tot < USAGE_MIN_PA) continue;
    midBatters.push({ id, stance: st, shield: ((weak + SHIELD_SHRINK * lamMid[st]) / (tot + SHIELD_SHRINK)) / lamMid[st] });
    midPA.set(id, tot);
  }
  const midRank = new Map([...midBatters].sort((a, b) => midPA.get(b.id)! - midPA.get(a.id)!).map((b, i) => [b.id, i + 1]));
  console.log(`   ${'band'.padEnd(14)} ${'shielded n'.padStart(11)}  ${STATS.map(([k]) => k.padStart(16)).join('')}`);
  for (const [label, hi2] of [['top 150', 150], ['top 250', 250], ['top 350', 350], ['all', 9999]] as const) {
    const band = midBatters.filter(b => midRank.get(b.id)! <= hi2);
    const nSh = band.filter(b => b.shield < 0.8).length;
    const parts = STATS.map(([stat]) => {
      const f = fitStat(band, midBCells, stat, b => (b.shield < 0.8 ? 1 : 0));
      return (f ? `${f.b >= 0 ? '+' : ''}${f.b.toFixed(3)}±${f.se.toFixed(3)}` : '—').padStart(16);
    });
    console.log(`   ${label.padEnd(14)} ${String(nSh).padStart(11)}  ${parts.join('')}`);
  }
  void fullStarterCells;

  const adj = benjaminiHochberg(tests.map(t => t.p));
  const survivors = tests.filter((_, i) => adj[i] < 0.05);
  console.log(`${survivors.length} of ${tests.length} shield coefficients survive Benjamini–Hochberg at 5%` +
    (survivors.length ? `: ${survivors.map(s => s.key).join(', ')}` : ''));
  console.log(`\nreading: "ratio" is the shielded batter's log-tilt over the everyday batter's — >1 means the`);
  console.log(`platoon effect really is bigger for bats a manager shields. "perm p" is the share of 200`);
  console.log(`shield-shuffled refits whose coefficient was at least as large, so it needs no distributional`);
  console.log(`assumption; "null |b| p95" is how big a coefficient this design produces from nothing.`);
  console.log(`"in-sample ratio" repeats the fit with the split measured in the SAME window as the usage —`);
  console.log(`the gap between it and "ratio" is regression to the mean, not signal.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
