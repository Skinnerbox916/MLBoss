import type { ForecastEngine } from './capture';

/**
 * Model version + change manifest for the forecast ledger.
 *
 * Every snapshot is stamped with `MODEL_VERSION` at capture time. Snapshots
 * are NEVER deleted on a version change — the old-version data is the control
 * group for the before/after that proves a change helped. Instead, the
 * scorecard reads intelligently:
 *
 *   - For a metric NO intervening change touched, it POOLS across versions —
 *     one unbroken, ever-growing sample (e.g. a batter-PA tune never touched
 *     pitcher K, so pitcher K keeps accumulating across the bump).
 *   - For a metric a change DID touch, it SEGMENTS — the headline reflects
 *     only the live build, and the older data lives on in the by-version view.
 *
 * The manifest below is what lets it tell the two apart. See
 * docs/forecast-verification.md#model-versions.
 *
 * Bump `MODEL_VERSION` (zero-padded YYYY.MM.DD so string order = time order;
 * a second bump on the same day appends '.2', which still string-sorts after)
 * whenever a change alters what an engine predicts, AND add a MODEL_CHANGELOG
 * entry naming what it touched. UI-only / plumbing changes don't bump.
 */
export const MODEL_VERSION = '2026.07.25.2';

/** `'*'` = every engine / every stat. `stats` lists the graded stat keys a
 *  change altered (see PITCHER_STATS / BATTER_STATS / 'points' in scorecard.ts). */
export interface ModelChange {
  version: string;
  date: string;
  summary: string;
  touched: { engine: ForecastEngine | '*'; stats: readonly string[] | '*' }[];
}

/**
 * What each version bump changed, oldest first. The baseline version needs
 * no entry — a metric with no entry between two versions pools across them.
 */
export const MODEL_CHANGELOG: readonly ModelChange[] = [
  {
    version: '2026.07.20',
    date: '2026-07-20',
    summary:
      'Batter PA-by-lineup-spot curve re-anchored to sourced PA/GS (top of order was ~0.2 PA low). ' +
      'PA volume scales every batter counting stat, and all three batter engines consume expectedPAperGame — ' +
      'so this segments the batter engines and leaves the pitcher engines pooling across the bump.',
    touched: [
      { engine: 'batter-day', stats: '*' },
      { engine: 'batter-week', stats: '*' },
      { engine: 'points-batter-day', stats: '*' },
    ],
  },
  {
    version: '2026.07.23',
    date: '2026-07-23',
    summary:
      'Three ledger-driven calibration fixes (docs/history.md "2026-07 — Ledger-driven calibration fixes"): ' +
      '(1) TeamOffense.strikeOutRate was K/AB fed into a per-PA log5 — every opposing lineup looked ~13% more ' +
      'K-prone than reality, inflating all pitcher K forecasts; now K/PA. (2) Starter-share taper on the ' +
      'PA-by-spot curve — the sourced table measures the SLOT (incl. pinch-hitters), starters get 98.7%→93.7% ' +
      'of it down the order. (3) LEAGUE_BB_RATE .094 → .089 (May refresh caught the early-season walk spike). ' +
      'Pitcher IP model untouched — ip keeps pooling.',
    touched: [
      { engine: 'batter-day', stats: '*' },
      { engine: 'batter-week', stats: '*' },
      { engine: 'points-batter-day', stats: '*' },
      { engine: 'pitcher-start', stats: ['k', 'bb', 'h', 'hr', 'er'] },
      { engine: 'points-pitcher-start', stats: '*' },
    ],
  },
  {
    version: '2026.07.25',
    date: '2026-07-25',
    summary:
      'W/QS probability rebuild against the first 188 graded starts (docs/history.md ' +
      '"2026-07 — W/QS probability recalibration"): the additive P(W) formula (0.40 ± ' +
      'talent/bullpen/home) graded as noise (realized 31.9% vs 40.5% mean forecast; slope ~0.1, ' +
      'AUC 0.52) and was replaced by P(team win) × P(credit | win) — Pythagorean run odds from ' +
      'SP talent ERAs + both pens + lineup run factors (incl. own-team run support, previously ' +
      'assumed average) with an IP-linked credit share; decomposition snapshotted as context.wParts. ' +
      'P(QS) shrunk 0.55× toward a 0.40 base (middle bands were honest, tails ~3× over-spread). ' +
      'Rate/volume stats untouched — k/bb/h/hr/er/ip keep pooling. points-pitcher-start carries ' +
      'P(W) inside its matchup ratio, so its points grade segments too.',
    touched: [
      { engine: 'pitcher-start', stats: ['qs', 'w'] },
      { engine: 'points-pitcher-start', stats: '*' },
    ],
  },
  {
    version: '2026.07.25.2',
    date: '2026-07-25',
    summary:
      'Pitcher 0-100 score scale recentered (docs/history.md "2026-07 — Pitcher score scale ' +
      'recentered"): the K/ERA/WHIP normalization windows in PITCHER_NORM were miscentered ' +
      '(K window midpoint 6.25 K/start vs the ~5.1 the model forecasts for league-average ' +
      'talent), so a league-average starter composited to ~43, breaking the "50 = neutral" ' +
      'contract. Windows recentered on the model\'s league-average output, widths preserved — ' +
      'every pitcher score shifts +6-9 uniformly, ordering unchanged. NO forecast quantity ' +
      'changed: k/bb/h/hr/er/ip/qs/w all keep pooling. Only the composite score (and the ' +
      'discrimination buckets built on it) segments at this bump.',
    touched: [
      { engine: 'pitcher-start', stats: ['score'] },
    ],
  },
];

function changeTouches(c: ModelChange, engine: ForecastEngine, stat: string): boolean {
  return c.touched.some(
    (t) =>
      (t.engine === '*' || t.engine === engine) &&
      (t.stats === '*' || t.stats.includes(stat)),
  );
}

/**
 * The set of model versions that are model-equivalent to `current` for this
 * (engine, stat) — i.e. no manifest change since the cohort's start altered
 * this metric. These are the versions the scorecard pools into the live
 * headline; versions in an older cohort are the segmented before-data.
 */
export function liveCohortVersions(
  engine: ForecastEngine,
  stat: string,
  present: readonly string[],
  current: string = MODEL_VERSION,
): Set<string> {
  const versions = [...new Set([...present, current])].sort();
  const cohortOf = new Map<string, number>();
  let cohort = 0;
  cohortOf.set(versions[0], 0);
  for (let i = 1; i < versions.length; i++) {
    const broke = MODEL_CHANGELOG.some(
      (c) => c.version > versions[i - 1] && c.version <= versions[i] && changeTouches(c, engine, stat),
    );
    if (broke) cohort += 1;
    cohortOf.set(versions[i], cohort);
  }
  const live = cohortOf.get(current)!;
  return new Set(versions.filter((v) => cohortOf.get(v) === live));
}
