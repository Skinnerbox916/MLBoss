/**
 * Fit the QS / W start-probability model (pitching/forecast.ts, "Start-
 * probability model") from the graded retro pitcher cohort.
 *
 *   QS = P(reach 6 IP) × P(ER ≤ 3 | reached 6)
 *   W  = P(team wins)   × P(SP credited | team wins),  credit ~ logit P(reach 5)
 *
 * The reach models are logistic in `reachFeatures` — the SAME function the
 * engine evaluates — over the captured IP and ERA forecasts plus the leash:
 * each pitcher's own prior start lengths, rebuilt as of the game date from
 * the cohort's actuals (the cohort covers every start of the season, so this
 * is the history the engine's game log would have shown that morning).
 * Team results come from the MLB schedule; P(team wins) is the engine's own
 * `wParts.pTeam` and is graded here, not re-fit.
 *
 * Two blocks:
 *   HOLDOUT  fit on starts before --cut (default 2026-07-01), score the rest
 *            against the QS / W the engine captured for those starts. The
 *            captured numbers are whatever build the cohort was regenerated
 *            on — regenerate on the old build to compare against it.
 *   FULL     fit on every start; these are the coefficients to paste into
 *            REACH_6 / REACH_5 / QS_ER_GIVEN_6 / W_CREDIT.
 *
 * docs/unified-rating-model.md#start-probabilities
 *
 *   npx tsx scripts/retro-start-probabilities-fit.ts [--cut=YYYY-MM-DD]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { binomialFit } from '@/lib/retro/fitEval';
import { reachFeatures } from '@/lib/pitching/forecast';

const CUT = process.argv.find(a => a.startsWith('--cut='))?.split('=')[1] ?? '2026-07-01';

interface Start {
  id: number; date: string; pk: number | null; home: boolean;
  pTeam: number; ipFc: number; eraFc: number; qsFc: number; wFc: number;
  outs: number; er: number; w: number;
  prior: number[]; teamWon: boolean | null;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const logit = (p: number) => { const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4); return Math.log(q / (1 - q)); };
const dot = (b: number[], x: number[]) => b.reduce((s, v, i) => s + v * x[i], 0);
const brier = (p: number[], y: number[]) => p.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / y.length;
const logLoss = (p: number[], y: number[]) =>
  -p.reduce((s, v, i) => s + Math.log(Math.min(Math.max(y[i] ? v : 1 - v, 1e-12), 1)), 0) / y.length;
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const f3 = (x: number) => x.toFixed(3);
const f4 = (x: number) => x.toFixed(4);

function logistic(X: number[][], y: number[]): number[] {
  const fit = binomialFit(X, y, y.map(() => 1));
  if (!fit) throw new Error('logistic fit did not converge');
  return fit.beta;
}

async function teamResults(from: string, to: string): Promise<Map<string, boolean>> {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&startDate=${from}&endDate=${to}`;
  const body = await (await fetch(url)).json() as {
    dates: { games: { gamePk: number; teams: { home: { isWinner?: boolean }; away: { isWinner?: boolean } } }[] }[];
  };
  const out = new Map<string, boolean>();
  for (const d of body.dates) for (const g of d.games) {
    if (g.teams.home.isWinner === undefined) continue;
    out.set(`${g.gamePk}:home`, !!g.teams.home.isWinner);
    out.set(`${g.gamePk}:away`, !!g.teams.away.isWinner);
  }
  return out;
}

/** Fit the four pieces on `rows`. `base6` / `base5` are the rows' own reach
 *  rates — the centre the leash feature is measured against. */
function fitModel(rows: Start[]) {
  const base6 = mean(rows.map(s => (s.outs >= 18 ? 1 : 0)));
  const base5 = mean(rows.map(s => (s.outs >= 15 ? 1 : 0)));
  const x6 = (s: Start) => reachFeatures(18, base6, s.ipFc, s.eraFc, s.prior);
  const x5 = (s: Start) => reachFeatures(15, base5, s.ipFc, s.eraFc, s.prior);
  const b6 = logistic(rows.map(x6), rows.map(s => (s.outs >= 18 ? 1 : 0)));
  const b5 = logistic(rows.map(x5), rows.map(s => (s.outs >= 15 ? 1 : 0)));
  const went6 = rows.filter(s => s.outs >= 18);
  const bq = logistic(went6.map(s => [1, s.eraFc - 4.2]), went6.map(s => (s.er <= 3 ? 1 : 0)));
  const won = rows.filter(s => s.teamWon === true);
  const bc = logistic(won.map(s => [1, logit(sigmoid(dot(b5, x5(s))))]), won.map(s => s.w));
  const qs = (s: Start) => sigmoid(dot(b6, x6(s))) * sigmoid(dot(bq, [1, s.eraFc - 4.2]));
  const w = (s: Start) => s.pTeam * sigmoid(dot(bc, [1, logit(sigmoid(dot(b5, x5(s))))]));
  return { base6, base5, b6, b5, bq, bc, qs, w };
}

function scoreBlock(label: string, rows: Start[], m: ReturnType<typeof fitModel>) {
  if (rows.length === 0) return;
  const yq = rows.map(s => (s.outs >= 18 && s.er <= 3 ? 1 : 0));
  const yw = rows.map(s => s.w);
  const qOld = rows.map(s => s.qsFc), qNew = rows.map(m.qs);
  const wOld = rows.map(s => s.wFc), wNew = rows.map(m.w);
  console.log(`  ${label} (n=${rows.length})`);
  console.log(`    QS  mean engine ${f3(mean(qOld))} fitted ${f3(mean(qNew))} actual ${f3(mean(yq))}` +
    `   Brier ${f4(brier(qOld, yq))} -> ${f4(brier(qNew, yq))}   log-loss ${f4(logLoss(qOld, yq))} -> ${f4(logLoss(qNew, yq))}`);
  console.log(`    W   mean engine ${f3(mean(wOld))} fitted ${f3(mean(wNew))} actual ${f3(mean(yw))}` +
    `   Brier ${f4(brier(wOld, yw))} -> ${f4(brier(wNew, yw))}   log-loss ${f4(logLoss(wOld, yw))} -> ${f4(logLoss(wNew, yw))}`);
}

function bands(label: string, p: number[], y: number[], n = 5) {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const size = Math.floor(idx.length / n);
  const cells: string[] = [];
  for (let k = 0; k < n; k++) {
    const chunk = idx.slice(k * size, k === n - 1 ? idx.length : (k + 1) * size);
    cells.push(`${f3(mean(chunk.map(i => p[i])))}->${f3(mean(chunk.map(i => y[i])))}`);
  }
  console.log(`    ${label.padEnd(12)} ${cells.join('  ')}`);
}

async function main() {
  const res = await getDb().execute(sql`
    select s.mlb_id, s.game_date::text as date, s.context, s.predicted, a.pitching
    from forecast_snapshots s
    join player_game_actuals a on a.game_date = s.game_date and a.mlb_id = s.mlb_id
    where s.engine = 'retro-pitcher-start' and a.status = 'played'
      and coalesce((a.pitching->>'gs')::int, 0) = 1
    order by s.game_date`);
  const raw = res.rows as { mlb_id: number; date: string; context: Record<string, unknown>; predicted: Record<string, number>; pitching: Record<string, number> }[];
  if (raw.length === 0) throw new Error('no graded retro-pitcher-start rows');
  const results = await teamResults(raw[0].date, raw[raw.length - 1].date);

  const history = new Map<number, number[]>();
  const starts: Start[] = raw.map(r => {
    const prior = history.get(r.mlb_id) ?? [];
    const ctx = r.context as { gamePk?: number; isHome?: boolean; wParts?: { pTeam?: number } };
    const s: Start = {
      id: r.mlb_id, date: r.date, pk: ctx.gamePk ?? null, home: !!ctx.isHome,
      pTeam: ctx.wParts?.pTeam ?? 0.5,
      ipFc: r.predicted.ip, eraFc: r.predicted.era, qsFc: r.predicted.qs, wFc: r.predicted.w,
      outs: r.pitching.outs, er: r.pitching.er, w: r.pitching.w ?? 0,
      prior: prior.slice(-6),
      teamWon: ctx.gamePk != null ? results.get(`${ctx.gamePk}:${ctx.isHome ? 'home' : 'away'}`) ?? null : null,
    };
    history.set(r.mlb_id, [...prior, s.outs]);
    return s;
  });

  const train = starts.filter(s => s.date < CUT);
  const test = starts.filter(s => s.date >= CUT);
  console.log(`${starts.length} graded starts (${starts.filter(s => s.teamWon != null).length} with a team result); ` +
    `holdout cut ${CUT}: fit ${train.length}, score ${test.length}\n`);

  // P(team wins) is the engine's; grade it so a drift there is visible.
  const withTeam = (rows: Start[]) => rows.filter(s => s.teamWon != null);
  console.log('P(team wins) calibration, engine wParts.pTeam -> actual, by quintile');
  bands('before cut', withTeam(train).map(s => s.pTeam), withTeam(train).map(s => (s.teamWon ? 1 : 0)));
  bands('after cut', withTeam(test).map(s => s.pTeam), withTeam(test).map(s => (s.teamWon ? 1 : 0)));

  const hold = fitModel(train);
  console.log(`\nHOLDOUT — fitted before ${CUT}, scored on/after (engine = the captured forecast)`);
  scoreBlock('all starts', test, hold);
  scoreBlock('regular starters (last-3 avg >= 4.5 IP)', test.filter(s => s.prior.length >= 3
    && s.prior.slice(-3).reduce((a, b) => a + b, 0) / 3 / 3 >= 4.5), hold);
  scoreBlock('short leash (no 6-IP start in last 6)', test.filter(s => s.prior.length === 6 && s.prior.every(o => o < 18)), hold);
  scoreBlock('workhorses (5+ of last 6 went 6 IP)', test.filter(s => s.prior.length === 6 && s.prior.filter(o => o >= 18).length >= 5), hold);
  console.log('  calibration by quintile (forecast -> actual)');
  const yq = test.map(s => (s.outs >= 18 && s.er <= 3 ? 1 : 0));
  bands('QS engine', test.map(s => s.qsFc), yq);
  bands('QS fitted', test.map(hold.qs), yq);
  bands('W engine', test.map(s => s.wFc), test.map(s => s.w));
  bands('W fitted', test.map(hold.w), test.map(s => s.w));

  const full = fitModel(starts);
  const r = (b: number[]) => b.map(v => Number(v.toFixed(3)));
  const [b6, b5] = [r(full.b6), r(full.b5)];
  console.log('\nFULL fit — paste into pitching/forecast.ts');
  console.log(`  REACH_6 = { b0: ${b6[0]}, ip: ${b6[1]}, leash: ${b6[2]}, last3: ${b6[3]}, era: ${b6[4]}, base: ${f3(full.base6)} }`);
  console.log(`  REACH_5 = { b0: ${b5[0]}, ip: ${b5[1]}, leash: ${b5[2]}, last3: ${b5[3]}, era: ${b5[4]}, base: ${f3(full.base5)} }`);
  console.log(`  QS_ER_GIVEN_6 = { b0: ${r(full.bq)[0]}, era: ${r(full.bq)[1]} }`);
  console.log(`  W_CREDIT = { b0: ${r(full.bc)[0]}, reach5: ${r(full.bc)[1]} }`);
  console.log(`  (holdout-period fit for stability: REACH_6 ${JSON.stringify(r(hold.b6))}, REACH_5 ${JSON.stringify(r(hold.b5))})`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
