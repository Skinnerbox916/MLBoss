/**
 * Per-knob calibration fit over the retro cohort.
 *
 * The scorecard can say "the matchup layer is over-scaled" but not which
 * knob, because a snapshot's combined modifier is one number. Snapshots now
 * carry the decomposition (`context.knobs.<knob>.<stat>`), so this fits
 *
 *   actual ~ Poisson( exp( a + b·log(neutral) + Σ c_k·log(knob_k) ) )
 *
 * where `neutral` is the talent-only expected count (predicted ÷ combined
 * modifier). A perfectly calibrated engine gives b = 1 and every c_k = 1.
 * c_k < 1 means that knob is applied too hard: the engine moves the forecast
 * further than the outcomes justify, and the fitted value is the fraction of
 * the current swing that the data actually supports.
 *
 * EXPOSURE: every batter knob is a multiplier on a per-PA RATE, but the row
 * being graded is a per-game COUNT — rate × a plate-appearance forecast that
 * belongs to a different model (the lineup-spot PA model). Grading the rate
 * dial on the count charges it for the PA model's error, and the two are not
 * independent: platoon-advantaged bats are the ones lifted for a pinch
 * hitter, so they collect ~4% FEWER PA than the spot model says, which
 * cancels the rate gain the platoon knob correctly predicted. So when the
 * snapshot and the actual both carry PA, the fit carries log(actual PA /
 * forecast PA) as a control and the coefficients read as rate calibration.
 * Pass `count` to get the uncontrolled view back. See
 * docs/forecast-verification.md#per-knob-calibration-fit.
 *
 * PITCHERS: since 2026-09-04 pitcher rows carry the same per-stat shape
 * (`knobs.opp.k`, `knobs.park.hr`, ...; `mods.<stat>` = their product) and
 * exposure is batters faced, so the same fit reads them. Before that they
 * carried one breakdown-UI scalar per knob for the whole start
 * (`context.mults`), which the fit fell back to; those columns were
 * unreadable by construction — `platoon` and `opp` are both linear in the
 * same OPS-vs-hand scalar (log correlation 0.999), and platoon / velocity /
 * bullpen never touch a graded stat at all. The `mults` fallback is kept so
 * old live rows still run, but its coefficients must not be read; run the
 * fit on rows that carry `knobs`. The two volume stats (pa, ip) are the
 * exposure itself, so they are always fitted on the count basis.
 *
 *   npx tsx scripts/retro-knob-fit.ts [engine] [minRows] [home|away] [count]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { poissonFit } from '@/lib/retro/fitEval';

const STATS = ['tb', 'h', 'hr', 'r', 'rbi', 'k', 'bb', 'sb', 'ip', 'er', 'pa'];
const KNOBS = ['pitcher', 'park', 'weather', 'order', 'platoon', 'hand', 'teamSb', 'opp', 'velocity', 'bullpen'];

async function main() {
  const engine = process.argv[2] ?? 'retro-batter-day';
  const minRows = Number(process.argv[3] ?? 500);
  // Optional slice: 'home' / 'away'. The park knob is the reason this exists —
  // a talent baseline built from season stats already contains roughly half
  // that player's home park, so applying the full park factor at home
  // double-counts it. If that is what is happening, the fitted park
  // coefficient should sit near 1.0 on the road and well below it at home.
  const flags = new Set(process.argv.slice(4));
  const slice = flags.has('home') ? 'home' : flags.has('away') ? 'away' : undefined;
  const rateBasis = !flags.has('count');
  const res = await getDb().execute(sql`
    select s.predicted, s.context, a.batting, a.pitching
    from forecast_snapshots s join player_game_actuals a on a.game_date = s.game_date and a.mlb_id = s.mlb_id
    where s.engine = ${engine} and a.status = 'played'
      and (case when ${engine} like '%batter%' then a.batting is not null else a.pitching is not null end)`);
  let rows = res.rows as { predicted: Record<string, number>; context: Record<string, unknown>; batting: Record<string, number> | null; pitching: Record<string, number> | null }[];
  if (slice) rows = rows.filter(r => (r.context.isHome === true) === (slice === 'home'));
  // Exposure control — see EXPOSURE above. Only available where both sides
  // carry PA; without it the knobs are graded on the count.
  const paOf = (r: (typeof rows)[number]) => {
    const line = r.batting ?? r.pitching;
    const act = line?.pa ?? line?.battersFaced, pred = r.predicted?.pa;
    return act != null && pred != null && act > 0 && pred > 0 ? Math.log(act / pred) : null;
  };
  const hasPA = rateBasis && rows.filter(r => paOf(r) != null).length >= rows.length * 0.9;
  console.log(`${engine}${slice ? ` [${slice}]` : ''}: ${rows.length} graded rows — ${hasPA ? 'RATE basis (PA exposure controlled)' : 'COUNT basis (no PA control)'}\n`);
  console.log(`  a knob coefficient of 1.00 means correctly scaled; 0.50 means only half the applied swing is justified\n`);

  for (const stat of STATS) {
    // The volume stats ARE the exposure — controlling them on themselves
    // would be tautological, so they read on the count basis regardless.
    const control = hasPA && stat !== 'pa' && stat !== 'ip';
    const knobsFor = KNOBS.filter(k => {
      let seen = 0;
      for (const r of rows) {
        // A row that carries `knobs` is read from `knobs` alone — its `mults`
        // are breakdown-UI scalars, not applied multipliers.
        const knobs = r.context.knobs as Record<string, Record<string, number>> | undefined;
        const kn = knobs ? knobs[k]?.[stat] : (r.context.mults as Record<string, number> | undefined)?.[k];
        if (kn != null) seen++;
      }
      return seen >= rows.length * 0.9;
    });
    const X: number[][] = [], y: number[] = [];
    for (const r of rows) {
      const line = r.batting ?? r.pitching;
      // Pitcher exposure is recorded as battersFaced on the actual line.
      const act = stat === 'pa' ? line?.pa ?? line?.battersFaced : line?.[stat];
      const pred = r.predicted[stat];
      const mults = r.context.mults as Record<string, number> | undefined;
      const mods = (r.context.mods as Record<string, number> | undefined)?.[stat]
        ?? (mults ? Object.values(mults).reduce((a, v) => a * v, 1) : undefined);
      // Rows decompose per stat (context.knobs.<knob>.<stat>). Legacy
      // pitcher rows (pre-2026-09-04) only carry one breakdown scalar per
      // knob (context.mults.<knob>) — see PITCHERS in the header.
      const kn = (r.context.knobs as Record<string, Record<string, number>> | undefined)
        ?? (r.context.mults ? Object.fromEntries(Object.entries(r.context.mults as Record<string, number>).map(([k, v]) => [k, { [stat]: v }])) : undefined);
      if (act == null || pred == null || mods == null || !kn || pred <= 0 || mods <= 0) continue;
      const neutral = pred / mods;
      if (!(neutral > 0)) continue;
      const pa = control ? paOf(r) : null;
      if (control && pa == null) continue;
      const row = [1, Math.log(neutral), ...knobsFor.map(k => Math.log(kn[k]?.[stat] ?? 1)), ...(pa != null ? [pa] : [])];
      if (row.some(v => !Number.isFinite(v))) continue;
      X.push(row); y.push(act);
    }
    // Drop knobs with (near) no variance in this sample: a column of
    // identical log-multipliers is collinear with the intercept and makes
    // the information matrix singular.
    const keep: number[] = [];
    for (let j = 0; j < knobsFor.length; j++) {
      const col = X.map(r => r[j + 2]);
      const m = col.reduce((a, b) => a + b, 0) / col.length;
      const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length);
      if (sd > 1e-6) keep.push(j);
    }
    const dropped = knobsFor.filter((_, j) => !keep.includes(j));
    const usedKnobs = keep.map(j => knobsFor[j]);
    const Xk = X.map(r => [r[0], r[1], ...keep.map(j => r[j + 2]), ...(control ? [r[r.length - 1]] : [])]);
    if (Xk.length < minRows || usedKnobs.length === 0) { console.log(`  ${stat.padEnd(4)} n=${Xk.length} (skipped${dropped.length ? `; constant: ${dropped.join(',')}` : ''})`); continue; }
    const fit = poissonFit(Xk, y);
    if (!fit) { console.log(`  ${stat.padEnd(4)} fit failed`); continue; }
    const parts = usedKnobs.map((k, i) => {
      const c = fit.beta[i + 2], se = fit.se[i + 2];
      const flag = Math.abs(c - 1) > 1.96 * se ? '*' : ' ';
      return `${k} ${c.toFixed(2)}±${se.toFixed(2)}${flag}`;
    });
    console.log(`  ${stat.padEnd(4)} n=${String(Xk.length).padStart(6)}  talent ${fit.beta[1].toFixed(2)}±${fit.se[1].toFixed(2)}  │ ${parts.join('  ')}${dropped.length ? `  (constant, dropped: ${dropped.join(',')})` : ''}${hasPA && !control ? '  [count basis]' : ''}`);
  }
  console.log(`\n  * = differs from 1.00 at p<0.05`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
