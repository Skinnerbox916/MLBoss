/**
 * Re-fit the batter PA model from the graded ledger.
 *
 * `paBySpot.ts` is `slot PA × starter share`: a hard-sourced table of what a
 * lineup SLOT accrues, times an estimated share of that going to the man who
 * started there rather than to whoever replaced him. The starter share was
 * fit on 708 starter-games in 2026-07 and docs/projection.md#pa-by-lineup-spot
 * asks for a re-fit once a fuller sample exists. This is that tool, over the
 * full-season retro cohort.
 *
 * It reports two things the current model does not know about:
 *
 *  1. RESIDUAL BY SPOT — actual PA / forecast PA per lineup spot. Flat at 1.0
 *     means the share curve is right; a slope means it is drifting and the
 *     per-spot numbers below are the re-fit.
 *  2. THE PLATOON HOOK — the same residual split by whether the batter has
 *     the platoon edge on the starter. A batter who does is the one lifted
 *     for a pinch hitter when the opposing bullpen brings a same-hand arm; a
 *     batter who does not is a full-timer who stays in; and a switch hitter is
 *     never platoon-hooked at all. If the mechanism is what it looks like,
 *     those three groups separate in that order, and the effect grows down the
 *     order where managers substitute freely.
 *
 * Everything is reported for a train window and a held-out later window, and
 * the live `batter-day` cohort is available as an independent sample
 * (`npx tsx scripts/retro-pa-model-fit.ts batter-day`).
 *
 *   npx tsx scripts/retro-pa-model-fit.ts [engine=retro-batter-day]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

type Bats = 'L' | 'R' | 'S';
/** How the batter stands relative to the starter he was forecast against. */
type Side = 'edge' | 'no-edge' | 'switch';

interface Row {
  date: string;
  spot: number | null;
  bats: Bats;
  side: Side;
  actualPA: number;
  predPA: number;
}

/** Ratio of sums with a sandwich SE. */
function ratio(rows: Row[]): { r: number; se: number; n: number } {
  const sa = rows.reduce((a, r) => a + r.actualPA, 0);
  const sp = rows.reduce((a, r) => a + r.predPA, 0);
  const r = sp > 0 ? sa / sp : NaN;
  const ss = rows.reduce((a, x) => a + (x.actualPA - r * x.predPA) ** 2, 0);
  return { r, se: sp > 0 ? Math.sqrt(ss) / sp : NaN, n: rows.length };
}

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '  —  ');
const cell = (rows: Row[]) => {
  if (rows.length < 50) return `${String(rows.length).padStart(5)}      —      `;
  const g = ratio(rows);
  return `${String(g.n).padStart(5)} ${f3(g.r)}±${f3(g.se)}`;
};

async function main() {
  const engine = process.argv[2] ?? 'retro-batter-day';
  const db = getDb();

  const snap = await db.execute(sql`
    select s.game_date::text as date, s.mlb_id, s.predicted, s.context, a.batting
    from forecast_snapshots s
    join player_game_actuals a on a.game_date = s.game_date and a.mlb_id = s.mlb_id
    where s.engine = ${engine} and a.status = 'played' and a.batting is not null`);

  // Batter stance from the pitch corpus: a switch hitter shows both sides
  // across a season, so the season totals classify him.
  const hands = await db.execute(sql`
    select batter, count(*) filter (where stand = 'L') as l, count(*) filter (where stand = 'R') as r
    from statcast_events group by batter`);
  const batsOf = new Map<number, Bats>();
  for (const h of hands.rows as Record<string, string | number>[]) {
    const l = Number(h.l), r = Number(h.r);
    if (l + r === 0) continue;
    batsOf.set(Number(h.batter), Math.min(l, r) / (l + r) > 0.05 ? 'S' : l > r ? 'L' : 'R');
  }

  const rows: Row[] = [];
  let skipped = 0;
  for (const s of snap.rows as Record<string, unknown>[]) {
    const ctx = s.context as Record<string, unknown>;
    const bats = batsOf.get(Number(s.mlb_id));
    const throws = ctx.spThrows === 'L' || ctx.spThrows === 'R' ? (ctx.spThrows as 'L' | 'R') : null;
    const actual = s.batting as Record<string, number>;
    const predicted = s.predicted as Record<string, number>;
    // A doubleheader snapshot describes game 1 but the actual sums both games,
    // so its PA ratio is meaningless here.
    if (!bats || !throws || ctx.doubleHeader === true || !(actual.pa > 0) || !(predicted.pa > 0)) { skipped++; continue; }
    const spotRaw = ctx.spot;
    rows.push({
      date: s.date as string,
      spot: typeof spotRaw === 'number' && spotRaw >= 1 && spotRaw <= 9 ? Math.round(spotRaw) : null,
      bats,
      side: bats === 'S' ? 'switch' : bats === throws ? 'no-edge' : 'edge',
      actualPA: actual.pa,
      predPA: predicted.pa,
    });
  }
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const cut = dates[Math.floor(dates.length * 0.7)];
  const windows: [string, Row[]][] = [
    ['ALL    ', rows],
    ['train  ', rows.filter(r => r.date < cut)],
    ['holdout', rows.filter(r => r.date >= cut)],
  ];
  console.log(`${engine}: ${rows.length} graded starter-games (${skipped} skipped: doubleheader / unknown hand / no PA)`);
  console.log(`train ${dates[0]}..${cut}, holdout ${cut}..${dates[dates.length - 1]}\n`);

  console.log(`1. RESIDUAL BY LINEUP SPOT — actual PA / forecast PA (1.000 = the starter-share curve is right)`);
  console.log(`   spot        n  ratio          implied share x`);
  for (let spot = 1; spot <= 9; spot++) {
    const rs = rows.filter(r => r.spot === spot);
    const g = ratio(rs);
    console.log(`   ${String(spot).padStart(4)} ${cell(rs)}   ${f3(g.r)}`);
  }
  const noSpot = rows.filter(r => r.spot == null);
  if (noSpot.length) console.log(`   none ${cell(noSpot)}`);
  console.log(`   ALL  ${cell(rows)}`);

  console.log(`\n2. THE PLATOON HOOK — same residual, by the batter's standing vs the starter`);
  console.log(`   ${'window'.padEnd(8)} ${'edge (gets hooked)'.padEnd(24)} ${'no edge (stays in)'.padEnd(24)} ${'switch (never hooked)'.padEnd(24)} spread`);
  for (const [label, ws] of windows) {
    const parts = (['edge', 'no-edge', 'switch'] as const).map(sd => cell(ws.filter(r => r.side === sd)));
    const e = ratio(ws.filter(r => r.side === 'edge')).r;
    const n = ratio(ws.filter(r => r.side === 'no-edge')).r;
    console.log(`   ${label} ${parts.map(p => p.padEnd(24)).join('')} ${f3(n / e)}`);
  }

  console.log(`\n3. DOES THE HOOK GROW DOWN THE ORDER? — managers substitute more freely at the bottom`);
  console.log(`   ${'spots'.padEnd(8)} ${'edge'.padEnd(24)} ${'no edge'.padEnd(24)} ${'switch'.padEnd(24)} spread`);
  for (const [label, lo, hi] of [['1–3', 1, 3], ['4–6', 4, 6], ['7–9', 7, 9]] as const) {
    const band = rows.filter(r => r.spot != null && r.spot >= lo && r.spot <= hi);
    const parts = (['edge', 'no-edge', 'switch'] as const).map(sd => cell(band.filter(r => r.side === sd)));
    const e = ratio(band.filter(r => r.side === 'edge')).r;
    const n = ratio(band.filter(r => r.side === 'no-edge')).r;
    console.log(`   ${label.padEnd(8)} ${parts.map(p => p.padEnd(24)).join('')} ${f3(n / e)}`);
  }

  // --- 4. the tables, fit on TRAIN and scored on HOLDOUT -------------------
  // The current STARTER_SHARE is a spot-only ramp fit WITHOUT a platoon term,
  // so the average hook is baked into its slope. Separate them:
  //   share correction = the residual of the UN-HOOKED population (no edge +
  //     switch), which is what a starter who is never platoon-lifted actually
  //     keeps. It also absorbs 2016 -> 2026 drift in the slot table's shape,
  //     which is why it need not come out monotone.
  //   hook = how far the edge population falls short of that.
  // Both are 9-element tables, matching the shape the model already uses, and
  // lightly smoothed so per-spot sampling noise is not encoded as structure.
  const smooth = (v: number[]): number[] =>
    v.map((_, i) => {
      const a = v[Math.max(i - 1, 0)], b = v[i], c = v[Math.min(i + 1, 8)];
      return (a + 2 * b + c) / 4;
    });
  const tablesFrom = (src: Row[]) => {
    const held: number[] = [], hook: number[] = [];
    for (let spot = 1; spot <= 9; spot++) {
      const at = src.filter(r => r.spot === spot);
      const e = ratio(at.filter(r => r.side === 'edge')).r;
      const h = ratio(at.filter(r => r.side !== 'edge')).r;
      held.push(h); hook.push(e / h);
    }
    return { held: smooth(held), hook: smooth(hook) };
  };
  const OLD_SHARE = [0.987, 0.981, 0.975, 0.968, 0.962, 0.956, 0.949, 0.943, 0.937];
  const show = (v: number[]) => `[${v.map(x => x.toFixed(3)).join(', ')}]`;

  console.log(`\n4. THE TABLES — measured per spot x side, smoothed`);
  console.log(`   ${'spot'.padEnd(5)} ${'edge'.padEnd(16)} ${'held (no edge + switch)'.padEnd(24)} hook = edge/held`);
  for (let spot = 1; spot <= 9; spot++) {
    const at = rows.filter(r => r.spot === spot);
    const e = ratio(at.filter(r => r.side === 'edge'));
    const h = ratio(at.filter(r => r.side !== 'edge'));
    console.log(`   ${String(spot).padStart(4)}  ${`${f3(e.r)}±${f3(e.se)}`.padEnd(16)} ${`${f3(h.r)}±${f3(h.se)}`.padEnd(24)} ${f3(e.r / h.r)}`);
  }
  const all = tablesFrom(rows), tr = tablesFrom(rows.filter(r => r.date < cut));
  const edgeMix = rows.filter(r => r.side === 'edge').length / rows.length;
  console.log(`\n   population is ${(edgeMix * 100).toFixed(1)}% platoon-edge starters`);
  console.log(`   STARTER_SHARE  full season ${show(OLD_SHARE.map((v, i) => v * all.held[i]))}`);
  console.log(`                  train only  ${show(OLD_SHARE.map((v, i) => v * tr.held[i]))}`);
  console.log(`   PLATOON_HOOK   full season ${show(all.hook)}`);
  console.log(`                  train only  ${show(tr.hook)}`);

  // Score the TRAIN-fit tables on the holdout. A residual of 1.000 across
  // every spot and both sides means the two tables carry the whole effect.
  console.log(`\n5. TRAIN-FIT TABLES SCORED ON THE HOLDOUT — 1.000 = nothing left on the table`);
  const rescored = (r: Row): number => {
    const i = (r.spot ?? 5) - 1;
    return r.predPA * tr.held[i] * (r.side === 'edge' ? tr.hook[i] : 1);
  };
  const scoredCell = (rs: Row[]) => {
    if (rs.length < 50) return `${String(rs.length).padStart(5)}      —      `;
    const g = ratio(rs.map(r => ({ ...r, predPA: rescored(r) })));
    return `${String(g.n).padStart(5)} ${f3(g.r)}±${f3(g.se)}`;
  };
  const hold = rows.filter(r => r.date >= cut);
  console.log(`   ${'spots'.padEnd(8)} ${'edge'.padEnd(22)} ${'held'.padEnd(22)} all`);
  for (const [label, lo, hi] of [['1-3', 1, 3], ['4-6', 4, 6], ['7-9', 7, 9]] as const) {
    const band = hold.filter(r => r.spot != null && r.spot >= lo && r.spot <= hi);
    console.log(`   ${label.padEnd(8)} ${scoredCell(band.filter(r => r.side === 'edge')).padEnd(22)} ${scoredCell(band.filter(r => r.side !== 'edge')).padEnd(22)} ${scoredCell(band)}`);
  }
  console.log(`   ${'ALL'.padEnd(8)} ${scoredCell(hold.filter(r => r.side === 'edge')).padEnd(22)} ${scoredCell(hold.filter(r => r.side !== 'edge')).padEnd(22)} ${scoredCell(hold)}`);
  console.log(`   (today's model on the same rows: edge ${f3(ratio(hold.filter(r => r.side === 'edge')).r)}, held ${f3(ratio(hold.filter(r => r.side !== 'edge')).r)}, all ${f3(ratio(hold).r)})`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
