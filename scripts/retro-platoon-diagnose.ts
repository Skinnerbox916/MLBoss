/**
 * Why the batter platoon knob looked inert — and what it actually is.
 *
 * `retro-knob-fit.ts` fits one coefficient per knob against a per-game
 * COUNT. That is the wrong exposure for a rate dial. Every L2 modifier the
 * batter engine applies is a multiplier on a per-PA RATE; the count it is
 * graded on is that rate times a plate-appearance forecast owned by a
 * different model (the lineup-spot PA model). Grading the rate dial on the
 * count charges it for the PA model's error, and the two are not
 * independent: how many PAs a batter gets is itself a function of the
 * lineup a manager builds against that starter's hand.
 *
 * So this script asks the platoon question three ways that the combined
 * count fit cannot:
 *
 *  1. Exposure. Re-grade per PA — model-free cell tilts on a Σactual /
 *     Σ(rate × ACTUAL PA) basis, and a regression carrying log(actual PA /
 *     forecast PA) as a control.
 *  2. Decomposition. The applied multiplier is a product of two different
 *     claims: `popTarget(bats, facingHand)` — a 4-cell population table —
 *     and the deviation of this batter's own regressed vs-hand split from
 *     it. They fail independently, so fit them as separate columns.
 *  3. Identification off the interaction only. Park factors are split by
 *     batter hand too, so a batter-hand MAIN effect is shared between the
 *     park and platoon columns. Free dummies for batter hand and pitcher
 *     hand leave the platoon column identified purely by the hand ×
 *     hand interaction, which is the only thing platoon actually claims.
 *
 * Plus the two structural suspects, each with a distinct fix attached:
 * dilution (the multiplier is applied to the whole game, but the batter
 * only faces that hand for part of it — the corpus knows the true share),
 * and selection (managers bench the platoon-disadvantaged, so same-hand
 * rows are survivors). Everything is cross-validated by TIME.
 *
 * Sections: 1 cohort + exposure · 2 model-free cell tilts · 3 the count fit
 * reproduced · 4 the same fit as a rate · 5 identified off the interaction,
 * with and without the dilution discount · 6 selection · 6b exposure by
 * usage group · 6c the shape of the heterogeneity · 7 time CV · 8 a usage
 * scaler fit on train and carried to holdout (REJECTED — see history.md) ·
 * 9 does the heterogeneity replicate across windows (it does not, in
 * magnitude) · 10 the live table re-graded.
 *
 * Conclusions and what shipped:
 * docs/forecast-verification.md#the-platoon-knob
 *
 *   npx tsx scripts/retro-platoon-diagnose.ts [engine=retro-batter-day]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { poissonFit } from '@/lib/retro/fitEval';
import { platoonFactor } from '@/lib/mlb/platoon';
import { BATTER_STAT_KEYS } from '@/lib/ledger/capture';

const STATS = ['tb', 'h', 'hr', 'r', 'rbi', 'k', 'bb'];
const STAT_ID = new Map(BATTER_STAT_KEYS);
/** Knobs other than platoon that the batter engine stamps per stat. */
const OTHER_KNOBS = ['pitcher', 'park', 'weather', 'order'];

type Hand = 'L' | 'R';
type Bats = 'L' | 'R' | 'S';

interface Row {
  date: string;
  mlbId: number;
  bats: Bats;
  facing: Hand;
  /** Fraction of the batter's ACTUAL PAs that came against `facing`. */
  sameHandShare: number;
  actualPA: number;
  predPA: number;
  actual: Record<string, number>;
  predicted: Record<string, number>;
  mods: Record<string, number>;
  knobs: Record<string, Record<string, number>>;
}

/** Ratio of sums with a sandwich SE — the honest "did this group beat its
 *  forecast" statistic for overdispersed per-game counts. */
function ratioOfSums(actual: number[], pred: number[]): { r: number; se: number } {
  const sa = actual.reduce((a, b) => a + b, 0);
  const sp = pred.reduce((a, b) => a + b, 0);
  const r = sp > 0 ? sa / sp : NaN;
  let ss = 0;
  for (let i = 0; i < actual.length; i++) ss += (actual[i] - r * pred[i]) ** 2;
  return { r, se: sp > 0 ? Math.sqrt(ss) / sp : NaN };
}

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '  —  ');
const CELLS: [Bats, Hand][] = [['L', 'L'], ['L', 'R'], ['R', 'L'], ['R', 'R'], ['S', 'L'], ['S', 'R']];
const cellKey = (r: Row) => `${r.bats}B/${r.facing}HP`;

type ColFactory = (stat: string) => { name: string; of: (r: Row, mult: number) => number }[];

/**
 * Poisson fit of the per-game count on the talent baseline, the other L2
 * knobs, whichever platoon columns the caller supplies, and (by default)
 * the two controls that make the platoon coefficient mean what it says:
 * PA exposure, and free batter-hand / pitcher-hand main effects.
 */
function fitStat(
  rows: Row[],
  stat: string,
  cols: ColFactory,
  opts: { paControl?: boolean; handControls?: boolean } = {},
): { names: string[]; beta: number[]; se: number[]; n: number } | null {
  const { paControl = true, handControls = true } = opts;
  const platoonCols = cols(stat);
  const X: number[][] = [], y: number[] = [];
  const usable = OTHER_KNOBS.filter(k => rows.filter(r => r.knobs[k]?.[stat] != null).length >= rows.length * 0.9);
  for (const r of rows) {
    const act = r.actual[stat], pred = r.predicted[stat], mods = r.mods[stat];
    const mult = r.knobs.platoon?.[stat];
    if (act == null || pred == null || mods == null || mult == null || pred <= 0 || mods <= 0) continue;
    if (paControl && !(r.actualPA > 0 && r.predPA > 0)) continue;
    const row = [
      1,
      Math.log(pred / mods),
      ...usable.map(k => Math.log(r.knobs[k]?.[stat] ?? 1)),
      ...platoonCols.map(c => c.of(r, mult)),
      ...(paControl ? [Math.log(r.actualPA / r.predPA)] : []),
      ...(handControls ? [r.bats === 'L' ? 1 : 0, r.bats === 'S' ? 1 : 0, r.facing === 'L' ? 1 : 0] : []),
    ];
    if (row.some(v => !Number.isFinite(v))) continue;
    X.push(row); y.push(act);
  }
  if (X.length < 500) return null;
  const names = [
    'int', 'talent', ...usable, ...platoonCols.map(c => c.name),
    ...(paControl ? ['paCtl'] : []), ...(handControls ? ['batsL', 'batsS', 'vsLHP'] : []),
  ];
  // Drop constant columns — collinear with the intercept, singular information matrix.
  const keep = names.map((_, j) => j).filter(j => {
    if (j <= 1) return true;
    const col = X.map(r => r[j]);
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    return Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) > 1e-4;
  });
  const fit = poissonFit(X.map(r => keep.map(j => r[j])), y);
  return fit ? { names: keep.map(j => names[j]), beta: fit.beta, se: fit.se, n: X.length } : null;
}

function report(label: string, rows: Row[], cols: ColFactory, opts: { paControl?: boolean; handControls?: boolean } = {}) {
  console.log(`\n${label}`);
  for (const stat of STATS) {
    const f = fitStat(rows, stat, cols, opts);
    if (!f) { console.log(`  ${stat.padEnd(4)} —`); continue; }
    const wanted = new Set(['talent', ...cols(stat).map(c => c.name)]);
    const parts = f.names
      .map((n, i) => ({ n, c: f.beta[i], se: f.se[i] }))
      .filter(x => wanted.has(x.n))
      .map(x => `${x.n} ${fmt(x.c)}±${fmt(x.se)}${Math.abs(x.c - 1) > 1.96 * x.se ? '*' : ' '}`);
    console.log(`  ${stat.padEnd(4)} n=${String(f.n).padStart(6)}  ${parts.join('  ')}`);
  }
}

async function main() {
  const engine = process.argv[2] ?? 'retro-batter-day';
  const db = getDb();

  const snap = await db.execute(sql`
    select s.game_date::text as date, s.mlb_id, s.predicted, s.context, a.batting
    from forecast_snapshots s
    join player_game_actuals a on a.game_date = s.game_date and a.mlb_id = s.mlb_id
    where s.engine = ${engine} and a.status = 'played' and a.batting is not null`);

  // Handedness + the true same-hand PA share, from the pitch corpus.
  // `stand` is the side the batter actually hit from, so a switch hitter
  // shows both across a season; within a game it is the platoon-correct side.
  const hands = await db.execute(sql`
    select batter, game_date::text as date,
      count(*) filter (where events is not null and events <> 'truncated_pa' and p_throws = 'L') as pa_l,
      count(*) filter (where events is not null and events <> 'truncated_pa' and p_throws = 'R') as pa_r,
      count(*) filter (where stand = 'L') as st_l,
      count(*) filter (where stand = 'R') as st_r
    from statcast_events group by batter, game_date`);

  const perGame = new Map<string, { paL: number; paR: number }>();
  const standTot = new Map<number, { l: number; r: number }>();
  for (const h of hands.rows as Record<string, string | number>[]) {
    const id = Number(h.batter);
    perGame.set(`${id}|${h.date}`, { paL: Number(h.pa_l), paR: Number(h.pa_r) });
    const t = standTot.get(id) ?? { l: 0, r: 0 };
    t.l += Number(h.st_l); t.r += Number(h.st_r);
    standTot.set(id, t);
  }
  /** Season stance: both sides used materially → switch, else the majority. */
  const batsOf = (id: number): Bats | null => {
    const t = standTot.get(id);
    if (!t || t.l + t.r === 0) return null;
    if (Math.min(t.l, t.r) / (t.l + t.r) > 0.05) return 'S';
    return t.l > t.r ? 'L' : 'R';
  };

  const rows: Row[] = [];
  let dropped = 0;
  for (const s of snap.rows as Record<string, unknown>[]) {
    const ctx = s.context as Record<string, unknown>;
    const facing = ctx.spThrows === 'L' || ctx.spThrows === 'R' ? (ctx.spThrows as Hand) : null;
    const mlbId = Number(s.mlb_id);
    const bats = batsOf(mlbId);
    const knobs = (ctx.knobs ?? {}) as Record<string, Record<string, number>>;
    const g = perGame.get(`${mlbId}|${s.date as string}`);
    const actual = s.batting as Record<string, number>;
    const predicted = s.predicted as Record<string, number>;
    if (!facing || !bats || !knobs.platoon || !g || !(actual.pa > 0) || !(predicted.pa > 0)) { dropped++; continue; }
    rows.push({
      date: s.date as string, mlbId, bats, facing,
      sameHandShare: (facing === 'L' ? g.paL : g.paR) / Math.max(g.paL + g.paR, 1),
      actualPA: actual.pa, predPA: predicted.pa,
      actual, predicted, mods: (ctx.mods ?? {}) as Record<string, number>, knobs,
    });
  }
  console.log(`${engine}: ${rows.length} usable rows (${dropped} dropped: unknown hand / no corpus game / no PA)`);

  const byCell = new Map<string, Row[]>();
  for (const r of rows) (byCell.get(cellKey(r)) ?? byCell.set(cellKey(r), []).get(cellKey(r))!).push(r);

  // --- 1. cohort shape + the exposure the engine ignores --------------------
  console.log(`\n1. COHORT — posted-lineup starters, and how much of the game they actually spend facing that hand`);
  console.log(`   ${'cell'.padEnd(9)} ${'n'.padStart(6)}   same-hand PA share   actual PA / forecast PA`);
  for (const [b, f] of CELLS) {
    const rs = byCell.get(`${b}B/${f}HP`) ?? [];
    if (!rs.length) continue;
    const share = rs.reduce((a, r) => a + r.sameHandShare, 0) / rs.length;
    const pa = ratioOfSums(rs.map(r => r.actualPA), rs.map(r => r.predPA));
    console.log(`   ${`${b}B/${f}HP`.padEnd(9)} ${String(rs.length).padStart(6)}          ${fmt(share)}                  ${fmt(pa.r, 3)}±${fmt(pa.se, 3)}`);
  }
  const paAll = ratioOfSums(rows.map(r => r.actualPA), rows.map(r => r.predPA));
  console.log(`   ${'ALL'.padEnd(9)} ${String(rows.length).padStart(6)}          ${fmt(rows.reduce((a, r) => a + r.sameHandShare, 0) / rows.length)}                  ${fmt(paAll.r, 3)}±${fmt(paAll.se, 3)}`);

  // --- 2. model-free cell tilts, graded per PA -----------------------------
  // Denominator = the engine's own per-PA rate with the platoon knob divided
  // back out, times the batter's ACTUAL PA. So this asks only "did the rate
  // land", with the PA model taken out of the question entirely. Each cell is
  // normalised by the cohort-wide level, so what is compared is the TILT the
  // table claims, not the engine's overall bias.
  console.log(`\n2. WHAT THE TABLE CLAIMS vs WHAT THE COHORT DELIVERS — per PA, cell tilt (cohort level = 1.00)`);
  const exPlatoonPA = (r: Row, stat: string) =>
    ((r.predicted[stat] ?? 0) / r.predPA / (r.knobs.platoon?.[stat] ?? 1)) * r.actualPA;
  for (const stat of STATS) {
    const statId = STAT_ID.get(stat)!;
    const all = ratioOfSums(rows.map(r => r.actual[stat] ?? 0), rows.map(r => exPlatoonPA(r, stat)));
    const parts: string[] = [];
    for (const [b, f] of CELLS) {
      const rs = byCell.get(`${b}B/${f}HP`) ?? [];
      if (!rs.length) continue;
      const g = ratioOfSums(rs.map(r => r.actual[stat] ?? 0), rs.map(r => exPlatoonPA(r, stat)));
      parts.push(`${b}B/${f}HP ${fmt(platoonFactor(statId, b, f, null), 3)}→${fmt(g.r / all.r, 3)}±${fmt(g.se / all.r, 3)}`);
    }
    // The hand × hand interaction contrast — immune to any batter-hand or
    // pitcher-hand main effect, which is what platoon actually claims.
    const cell = (b: Bats, f: Hand) => {
      const rs = byCell.get(`${b}B/${f}HP`) ?? [];
      return ratioOfSums(rs.map(r => r.actual[stat] ?? 0), rs.map(r => exPlatoonPA(r, stat))).r;
    };
    const obsInt = (cell('L', 'L') / cell('L', 'R')) / (cell('R', 'L') / cell('R', 'R'));
    const tblInt =
      (platoonFactor(statId, 'L', 'L', null) / platoonFactor(statId, 'L', 'R', null)) /
      (platoonFactor(statId, 'R', 'L', null) / platoonFactor(statId, 'R', 'R', null));
    console.log(`  ${stat.padEnd(4)} level ${fmt(all.r, 3)} │ ${parts.join('  ')}`);
    console.log(`       ${'interaction'.padEnd(12)} table ${fmt(tblInt, 3)}  cohort ${fmt(obsInt, 3)}  → delivered ${fmt(Math.log(obsInt) / Math.log(tblInt), 2)}× of the claim`);
  }

  // --- 3-7. regressions ----------------------------------------------------
  const popOf = (r: Row, stat: string) => platoonFactor(STAT_ID.get(stat)!, r.bats, r.facing, null);
  const split: ColFactory = stat => [
    { name: 'pop', of: (r, _m) => Math.log(popOf(r, stat)) },
    { name: 'dev', of: (r, m) => Math.log(m / popOf(r, stat)) },
  ];
  const combined: ColFactory = () => [{ name: 'platoon', of: (_r, m) => Math.log(m) }];
  const shareScaled: ColFactory = stat => [
    // The table discounted to the share of the game actually spent facing
    // that hand. If dilution is the whole story this fits at 1.00 while the
    // undiscounted column fits at the mean share.
    { name: 'pop~share', of: (r, _m) => r.sameHandShare * Math.log(popOf(r, stat)) },
    { name: 'dev', of: (r, m) => r.sameHandShare * Math.log(m / popOf(r, stat)) },
  ];

  console.log(`\n3. THE COUNT FIT, REPRODUCED — no PA control, no hand controls (this is what retro-knob-fit.ts sees)`);
  report(`   combined knob`, rows, combined, { paControl: false, handControls: false });
  report(`   decomposed`, rows, split, { paControl: false, handControls: false });

  console.log(`\n4. THE SAME FIT AS A RATE — log(actual PA / forecast PA) as a control`);
  report(`   decomposed`, rows, split, { handControls: false });

  console.log(`\n5. IDENTIFIED OFF THE INTERACTION — free batter-hand and pitcher-hand main effects`);
  report(`   decomposed`, rows, split);
  report(`   table discounted by the true same-hand PA share`, rows, shareScaled);

  // --- 6. selection --------------------------------------------------------
  const startsBy = new Map<number, { L: number; R: number }>();
  for (const r of rows) {
    const t = startsBy.get(r.mlbId) ?? { L: 0, R: 0 };
    t[r.facing]++;
    startsBy.set(r.mlbId, t);
  }
  const lgL = rows.filter(r => r.facing === 'L').length / rows.length;
  const mix = (r: Row) => { const t = startsBy.get(r.mlbId)!; return { n: t.L + t.R, l: t.L / (t.L + t.R) }; };
  const everyday = rows.filter(r => { const m = mix(r); return m.n >= 60 && Math.abs(m.l - lgL) < 0.05; });
  const platooned = rows.filter(r => { const m = mix(r); return m.n >= 30 && Math.abs(m.l - lgL) >= 0.08; });
  console.log(`\n6. SELECTION — the slate is ${fmt(lgL * 100, 1)}% LHP starts; does the table only work for bats that always play?`);
  report(`   everyday bats (start mix within 5pt of the slate) — ${everyday.length} rows`, everyday, split);
  report(`   platooned bats (start mix skewed ≥8pt) — ${platooned.length} rows`, platooned, split);

  // --- 6b. which mechanism? exposure, or real heterogeneity ---------------
  // A platooned bat in his DISADVANTAGE cell is the guy who gets lifted for a
  // pinch hitter in the 7th — so his PAs are the early ones, all against the
  // starter, and his true exposure is far above the cohort's 0.83. In his
  // ADVANTAGE cell he is the one lifted when a same-hand reliever appears, so
  // his exposure is below it. Both distortions inflate the apparent
  // interaction without any of his platoon SKILL being different. If that is
  // the whole story, discounting the table by each row's true share should
  // collapse the gap between the two groups.
  console.log(`\n6b. EXPOSURE BY USAGE GROUP — same-hand PA share, and PA delivered vs forecast`);
  console.log(`   ${'group'.padEnd(10)} ${'cell'.padEnd(9)} ${'n'.padStart(6)}  share   actual PA/forecast PA`);
  for (const [label, set] of [['everyday', everyday], ['platooned', platooned]] as const) {
    for (const [b, f] of CELLS) {
      const rs = set.filter(r => r.bats === b && r.facing === f);
      if (rs.length < 100) continue;
      const pa = ratioOfSums(rs.map(r => r.actualPA), rs.map(r => r.predPA));
      console.log(`   ${label.padEnd(10)} ${`${b}B/${f}HP`.padEnd(9)} ${String(rs.length).padStart(6)}  ${fmt(rs.reduce((a, r) => a + r.sameHandShare, 0) / rs.length)}    ${fmt(pa.r, 3)}±${fmt(pa.se, 3)}`);
    }
  }
  report(`   everyday, table discounted by true share`, everyday, shareScaled);
  report(`   platooned, table discounted by true share`, platooned, shareScaled);

  // --- 6c. the shape of the heterogeneity ---------------------------------
  // A manager shields a big-split bat from the hand it can't hit, so the
  // batter's OWN share of PA against his disadvantage hand, relative to the
  // league's, is a readable measure of how large his split is believed to be.
  // The engine already holds both halves of it as `paVsL` / `paVsR`.
  const paByHand = new Map<number, { l: number; r: number }>();
  for (const [key, g] of perGame) {
    const id = Number(key.split('|')[0]);
    const t = paByHand.get(id) ?? { l: 0, r: 0 };
    t.l += g.paL; t.r += g.paR;
    paByHand.set(id, t);
  }
  const lgLpa = [...paByHand.values()].reduce((a, t) => a + t.l, 0) /
    [...paByHand.values()].reduce((a, t) => a + t.l + t.r, 0);
  /** Own exposure to the disadvantage hand ÷ the league's. 1.0 = used like an
   *  everyday player; 0.4 = shielded from that hand more than half the time. */
  const shieldRatio = (r: Row): number | null => {
    if (r.bats === 'S') return null;
    const t = paByHand.get(r.mlbId);
    if (!t || t.l + t.r < 150) return null;
    const own = r.bats === 'L' ? t.l / (t.l + t.r) : t.r / (t.l + t.r);
    const lg = r.bats === 'L' ? lgLpa : 1 - lgLpa;
    return own / lg;
  };
  console.log(`\n6c. THE SHAPE — platoon coefficient by how far the batter is shielded from his weak hand`);
  console.log(`   league PA vs LHP = ${fmt(lgLpa * 100, 1)}%`);
  const BUCKETS: [string, number, number][] = [
    ['shielded  <0.70', 0, 0.70], ['0.70–0.90', 0.70, 0.90],
    ['0.90–1.05', 0.90, 1.05], ['everyday  ≥1.05', 1.05, 99],
  ];
  for (const [label, lo, hi] of BUCKETS) {
    const rs = rows.filter(r => { const v = shieldRatio(r); return v != null && v >= lo && v < hi; });
    const line = STATS.map(stat => {
      const f = fitStat(rs, stat, split);
      const i = f?.names.indexOf('pop') ?? -1;
      return f && i >= 0 ? `${stat} ${fmt(f.beta[i])}±${fmt(f.se[i])}` : `${stat} —`;
    });
    console.log(`   ${label.padEnd(16)} n=${String(rs.length).padStart(6)}  ${line.join('  ')}`);
  }

  // --- 7. cross-validation by TIME ----------------------------------------
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const cut = dates[Math.floor(dates.length * 0.7)];
  const early = rows.filter(r => r.date < cut), late = rows.filter(r => r.date >= cut);
  console.log(`\n7. TIME CROSS-VALIDATION — train ${dates[0]}..${cut}, holdout ${cut}..${dates[dates.length - 1]}`);
  report(`   train (${early.length} rows)`, early, split);
  report(`   holdout (${late.length} rows)`, late, split);

  // --- 8. a usage scaler, fit on the train window and validated later -----
  // Shape from 6c: the table's tilt is roughly right for a bat used every
  // day and several times too weak for one the manager shields. Model that
  // as an exponent on the population target,
  //     u(shield) = c1 + c2·(1 − shield)   clamped
  // fit as two columns — log(pop) and log(pop)·(1 − shield) — on the EARLY
  // window only, then carried unchanged onto the held-out later dates as a
  // single column. If the mechanism is real that column fits at 1.00 there.
  // `shield` is as-of: PA by opposing hand strictly BEFORE the game date,
  // shrunk toward league-typical usage so an April sample can't swing it.
  const SHRINK_PA = 100;
  const byBatterDate = new Map<number, { date: string; paL: number; paR: number }[]>();
  for (const [key, g] of perGame) {
    const [id, d] = key.split('|');
    const list = byBatterDate.get(Number(id)) ?? byBatterDate.set(Number(id), []).get(Number(id))!;
    list.push({ date: d, paL: g.paL, paR: g.paR });
  }
  const asOf = new Map<string, { l: number; r: number }>();
  for (const [id, list] of byBatterDate) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let l = 0, r = 0;
    for (const g of list) {
      asOf.set(`${id}|${g.date}`, { l, r });   // strictly before this date
      l += g.paL; r += g.paR;
    }
  }
  const lgL2 = lgLpa;
  const shieldAsOf = (r: Row): number | null => {
    if (r.bats === 'S') return null;
    const t = asOf.get(`${r.mlbId}|${r.date}`);
    if (!t) return null;
    const lgDis = r.bats === 'L' ? lgL2 : 1 - lgL2;
    const ownDis = r.bats === 'L' ? t.l : t.r;
    const tot = t.l + t.r;
    return ((ownDis + SHRINK_PA * lgDis) / (tot + SHRINK_PA)) / lgDis;
  };
  const U_CLAMP = { lo: 0.3, hi: 3.0 };
  const ramped: ColFactory = stat => [
    { name: 'pop', of: (r, _m) => Math.log(popOf(r, stat)) },
    { name: 'pop×shield', of: (r, _m) => Math.log(popOf(r, stat)) * (1 - (shieldAsOf(r) ?? 1)) },
  ];
  console.log(`\n8. USAGE SCALER — fit u(shield) = c1 + c2·(1−shield) on the train window`);
  const trainRows = early.filter(r => shieldAsOf(r) != null);
  const holdRows = late.filter(r => shieldAsOf(r) != null);
  const fitted: Record<string, [number, number]> = {};
  console.log(`   train (${trainRows.length} rows, switch hitters excluded)`);
  for (const stat of STATS) {
    const f = fitStat(trainRows, stat, ramped);
    const i = f?.names.indexOf('pop') ?? -1, j = f?.names.indexOf('pop×shield') ?? -1;
    if (!f || i < 0 || j < 0) { console.log(`   ${stat.padEnd(4)} —`); continue; }
    fitted[stat] = [f.beta[i], f.beta[j]];
    console.log(`   ${stat.padEnd(4)} c1 ${fmt(f.beta[i])}±${fmt(f.se[i])}  c2 ${fmt(f.beta[j])}±${fmt(f.se[j])}  →  u(everyday)=${fmt(f.beta[i])}  u(shield 0.6)=${fmt(f.beta[i] + 0.4 * f.beta[j])}`);
  }
  const scaled: ColFactory = stat => [{
    name: 'u·pop',
    of: (r, _m) => {
      const [c1, c2] = fitted[stat] ?? [1, 0];
      const u = Math.max(U_CLAMP.lo, Math.min(U_CLAMP.hi, c1 + c2 * (1 - (shieldAsOf(r) ?? 1))));
      return u * Math.log(popOf(r, stat));
    },
  }];
  report(`   HOLDOUT with the train-fitted scaler applied (1.00 = the scaler transfers)`, holdRows, scaled);
  report(`   HOLDOUT with the flat table, same rows (for comparison)`, holdRows, stat => [
    { name: 'pop(flat)', of: (r, _m) => Math.log(popOf(r, stat)) },
  ]);

  // --- 9. does the heterogeneity itself replicate out of sample? ----------
  // Section 8 fit a functional form and it did not transfer. Ask the weaker,
  // form-free question instead: split the rows into shielded and everyday by
  // the same as-of measure and fit the flat table inside each, separately in
  // the train and the holdout window. A real difference in platoon skill
  // shows up in BOTH windows; an in-sample artefact shows up in one.
  console.log(`\n9. DOES THE HETEROGENEITY REPLICATE? — flat table fit inside each usage group, per window`);
  for (const [wLabel, wRows] of [['train  ', early], ['holdout', late]] as const) {
    for (const [gLabel, lo, hi] of [['shielded <0.85', 0, 0.85], ['everyday ≥0.85', 0.85, 99]] as const) {
      const rs = wRows.filter(r => { const v = shieldAsOf(r); return v != null && v >= lo && v < hi; });
      const line = STATS.map(stat => {
        const f = fitStat(rs, stat, stat2 => [{ name: 'pop', of: (r, _m) => Math.log(popOf(r, stat2)) }]);
        const i = f?.names.indexOf('pop') ?? -1;
        return f && i >= 0 ? `${stat} ${fmt(f.beta[i])}±${fmt(f.se[i])}` : `${stat} —`;
      });
      console.log(`   ${wLabel} ${gLabel}  n=${String(rs.length).padStart(6)}  ${line.join('  ')}`);
    }
  }

  // --- 10. the shipped table, re-graded --------------------------------
  // `popOf` calls the live `platoonFactor`, so this refits the same cohort
  // against whatever the population target is TODAY. 1.00 = calibrated. The
  // stored per-player deviation is left out: it is a separate column that
  // fits at ~0 either way, and it cannot be recomputed from a snapshot once
  // the regression prior changes.
  console.log(`\n10. THE LIVE TABLE, RE-GRADED — flat population target, PA and hand controlled`);
  const liveCol: ColFactory = stat => [{ name: 'pop(live)', of: (r, _m) => Math.log(popOf(r, stat)) }];
  report(`   full season`, rows, liveCol);
  report(`   train`, early, liveCol);
  report(`   holdout`, late, liveCol);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
