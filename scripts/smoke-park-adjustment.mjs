#!/usr/bin/env node
/**
 * Smoke check for getParkAdjustment + the new park data.
 *
 * Validates expected directional behavior without depending on the
 * dev server. Run with: `npx tsx scripts/smoke-park-adjustment.mjs`.
 */
import { getParkAdjustment, formatParkBadge } from '../src/lib/mlb/parkAdjustment.ts';
import { getParkByTeam } from '../src/lib/mlb/parks.ts';

const cases = [
  // [team, statId, batterHand, pitcherThrows, label, expect]
  // Bounds calibrated to the 2024-2026 rolling-window data in parks.ts
  // (NYY HrL=114, HrR=121; BAL HrL=126, HrR=101; BOS HR=84; COL HrL=116;
  // LAD HrR=136; SF HrR=80; KC 3B=185; SEA PF=92).
  ['NYY', 12, 'L', 'R', 'Yankee HR vs LHB',         { gt: 1.10 }],
  ['NYY', 12, 'R', 'L', 'Yankee HR vs RHB',         { gt: 1.15 }],
  ['BAL', 12, 'L', 'R', 'Camden HR vs LHB',         { gt: 1.20 }],
  ['BAL', 12, 'R', 'L', 'Camden HR vs RHB neutral', { gt: 0.98, lt: 1.05 }],
  ['BOS', 4,  'R', 'L', 'Fenway 2B vs RHB',         { gt: 1.15 }],
  ['BOS', 12, 'L', 'R', 'Fenway HR vs LHB',         { lt: 0.85 }],
  ['BOS', 12, undefined, undefined, 'Fenway HR overall', { lt: 0.90 }],
  ['COL', 7,  'L', 'R', 'Coors R vs LHB',           { gt: 1.10 }],
  ['COL', 12, 'L', 'R', 'Coors HR vs LHB',          { gt: 1.10, lt: 1.20 }],
  ['SEA', 7,  'R', 'L', 'T-Mobile R vs RHB',        { lt: 0.95 }],
  ['LAD', 12, 'R', 'L', 'Dodger HR vs RHB',         { gt: 1.30 }],
  ['SF',  12, 'R', 'L', 'Oracle HR vs RHB',         { lt: 0.85 }],
  ['KC',  5,  'R', 'L', 'Kauffman 3B (any hand)',   { gt: 1.35 }],
  // Switch-hitters: 'S' vs RHP should match L slice; vs LHP should match R slice
  ['NYY', 12, 'S', 'R', 'Yankee HR S-vs-RHP=LHB',   { gt: 1.10 }],
  ['BAL', 12, 'S', 'R', 'Camden HR S-vs-RHP=LHB',   { gt: 1.20 }],
  ['BAL', 12, 'S', 'L', 'Camden HR S-vs-LHP=RHB',   { gt: 0.98, lt: 1.05 }],
  // 'S' with unknown pitcher hand → fall back to overall (Camden HR overall = 113)
  ['BAL', 12, 'S', null, 'Camden HR S-no-pitcher → overall', { gt: 1.10, lt: 1.20 }],
  // Composite (pitcher rating)
  ['COL', undefined, undefined, undefined, 'Coors composite (pitcher penalty)', { lt: 0.95 }],
  ['SEA', undefined, undefined, undefined, 'T-Mobile composite (pitcher boost)', { gt: 1.03 }],
  ['BOS', undefined, undefined, undefined, 'Fenway composite (lean penalty)',    { lt: 1.0 }],
];

// Wind cases — Wrigley with strong out-to-CF wind
const wrigleyOut = {
  windSpeed: 20,
  windDirection: 'Out To CF',
  temp: 75, condition: 'Clear',
};
const wrigleyIn = {
  windSpeed: 20,
  windDirection: 'In From LF',
  temp: 75, condition: 'Clear',
};

let pass = 0, fail = 0;
for (const [team, statId, hand, throws, label, expect] of cases) {
  const park = getParkByTeam(team);
  const adj = getParkAdjustment({ park, statId, batterHand: hand, pitcherThrows: throws });
  let ok = true;
  if (expect.gt != null && !(adj.multiplier > expect.gt)) ok = false;
  if (expect.lt != null && !(adj.multiplier < expect.lt)) ok = false;
  const tag = ok ? 'PASS' : 'FAIL';
  if (ok) pass++; else fail++;
  console.log(`${tag} ${label.padEnd(40)} mult=${adj.multiplier.toFixed(3)} hint="${adj.hint}"`);
}

console.log('\n--- Wind amplification (Wrigley) ---');
const wrigley = getParkByTeam('CHC');
const baselineWrigley = getParkAdjustment({ park: wrigley, statId: 12, batterHand: 'R' });
const outWrigley = getParkAdjustment({ park: wrigley, statId: 12, batterHand: 'R', weather: wrigleyOut });
const inWrigley = getParkAdjustment({ park: wrigley, statId: 12, batterHand: 'R', weather: wrigleyIn });
console.log(`baseline:    ${baselineWrigley.multiplier.toFixed(3)} ${baselineWrigley.hint}`);
console.log(`out 20mph:   ${outWrigley.multiplier.toFixed(3)} ${outWrigley.hint}`);
console.log(`in 20mph:    ${inWrigley.multiplier.toFixed(3)} ${inWrigley.hint}`);
const windOk = outWrigley.multiplier > baselineWrigley.multiplier
  && inWrigley.multiplier < baselineWrigley.multiplier;
console.log(windOk ? 'PASS wind direction asymmetry' : 'FAIL wind direction asymmetry');
if (windOk) pass++; else fail++;

console.log('\n--- Park badge selection ---');
const badgeCases = [
  ['NYY', 'should pick HR (119 vs 100 overall)'],
  ['BOS', 'should pick PF (105) or HR (89) — whichever is more extreme'],
  ['COL', 'should pick PF (112) over HR (105)'],
  ['LAD', 'should pick HR (127) over PF (101)'],
];
for (const [team, msg] of badgeCases) {
  const badge = formatParkBadge(getParkByTeam(team));
  console.log(`${team}: display=${badge.display} isHR=${badge.isHR} (${msg})`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail > 0 ? 1 : 0);
