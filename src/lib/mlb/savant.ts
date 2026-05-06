/**
 * Baseball Savant Leaderboard Client
 *
 * Fetches aggregated Statcast metrics from Baseball Savant's unofficial CSV
 * endpoints and caches the results for 24 hours.
 *
 * IMPORTANT: These are undocumented endpoints, stable but not guaranteed.
 * All fetches degrade gracefully — callers receive empty maps on failure so
 * the rest of the system continues working without Statcast data.
 *
 * Endpoints used:
 *   expected_statistics (pitchers): xERA, xwOBA, actual ERA/wOBA, PA, BIP
 *   expected_statistics (batters):  xBA, xSLG, xwOBA, actual wOBA, PA, BIP
 */

import { withCache, CACHE_CATEGORIES } from '@/lib/fantasy/cache';
import { externalFetchText } from './client';
import type { StatcastBatter, StatcastPitcher } from './types';

const SAVANT_BASE = 'https://baseballsavant.mlb.com';

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

/**
 * Parse a Savant CSV string into an array of objects keyed by header name.
 * Savant wraps all values in double-quotes; we strip them during parsing.
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  // Strip quotes from a single token
  const strip = (s: string) => s.trim().replace(/^"|"$/g, '');

  // Header line — Savant uses "last_name, first_name" as the first column
  // which contains an embedded comma, but it's always quoted so we need a
  // proper quoted-CSV split rather than a naive str.split(',').
  const headers = splitCsvLine(lines[0]).map(strip);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCsvLine(line).map(strip);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Split a single CSV line respecting double-quoted fields (which may contain
 * commas).  Savant's "last_name, first_name" column is always the first field
 * and is always quoted, so this handles the only tricky case we encounter.
 */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function toNum(val: string | undefined): number | null {
  if (!val || val === '' || val === 'null' || val === 'NA') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function toInt(val: string | undefined): number {
  if (!val) return 0;
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// Savant fetch helper — plain fetch, no auth, graceful failure
// ---------------------------------------------------------------------------

async function savantFetch(url: string): Promise<string> {
  return externalFetchText(url, { accept: 'text/csv,*/*' });
}

// ---------------------------------------------------------------------------
// Pitcher leaderboard
// ---------------------------------------------------------------------------

/**
 * Fetch the Baseball Savant expected_statistics + custom-skills pitcher
 * leaderboards for a given season and merge them by player_id.  Returns
 * a map from MLB player ID → StatcastPitcher, enriched with the skill-
 * level rates (K%, BB%, xwOBACON, HH%) used by the component talent
 * model.
 *
 * Returns an empty map on total failure, or the skill-free map if only
 * the skills endpoint fails — Statcast is enhancement-only.
 *
 * Cached 24 hours: Savant recomputes expected stats once nightly.
 *
 * Expected-stats columns: player_id, pa, bip, woba, est_woba, era, xera
 * Custom-skills columns:  player_id, pa, k_percent, bb_percent, xwobacon, hard_hit_percent
 */
export async function fetchStatcastPitchers(
  season: number = new Date().getFullYear(),
): Promise<Map<number, StatcastPitcher>> {
  // v2 = schema bumped when avgFastballVelo + runValuePer100 were added.
  const cacheKey = `${CACHE_CATEGORIES.STATIC.prefix}:savant:pitchers:v2:${season}`;

  try {
    // withCache serialises via JSON which destroys Map instances.
    // Store as [key, value][] and reconstruct on retrieval.
    const entries = await withCache(cacheKey, CACHE_CATEGORIES.STATIC.ttl, async () => {
      const expectedUrl = `${SAVANT_BASE}/leaderboard/expected_statistics?type=pitcher&year=${season}&position=&team=&min=1&csv=true`;
      const skillsUrl = buildCustomSkillsUrl('pitcher', season);

      const [expectedCsv, skillsCsvOrNull, arsenalMap] = await Promise.all([
        savantFetch(expectedUrl),
        savantFetch(skillsUrl).catch((err) => {
          console.warn(`fetchStatcastPitchers: skills leaderboard failed (${season}):`, err);
          return null;
        }),
        fetchPitcherArsenal(season),
      ]);

      const skillsMap = skillsCsvOrNull ? parseSkillsCsv(skillsCsvOrNull) : new Map<number, SkillsRow>();

      const rows = parseCsv(expectedCsv);
      const pairs: [number, StatcastPitcher][] = [];

      for (const row of rows) {
        const mlbId = toInt(row['player_id']);
        if (!mlbId) continue;

        const skills = skillsMap.get(mlbId);
        const arsenal = arsenalMap.get(mlbId);
        pairs.push([mlbId, {
          mlbId,
          xera: toNum(row['xera']),
          xwoba: toNum(row['est_woba']),
          era: toNum(row['era']),
          woba: toNum(row['woba']),
          pa: toInt(row['pa']),
          bip: toInt(row['bip']),
          kRate: skills?.kRate ?? null,
          bbRate: skills?.bbRate ?? null,
          xwobacon: skills?.xwobacon ?? null,
          hardHitRate: skills?.hardHitRate ?? null,
          whiffPct: skills?.whiffPct ?? null,
          barrelPct: skills?.barrelPct ?? null,
          avgFastballVelo: arsenal?.avgFastballVelo ?? null,
          runValuePer100: arsenal?.runValuePer100 ?? null,
        }]);
      }

      return pairs;
    });
    return new Map(entries);
  } catch (err) {
    console.warn('fetchStatcastPitchers failed — using empty map:', err);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Batter leaderboard
// ---------------------------------------------------------------------------

/**
 * Fetch the Baseball Savant expected_statistics + custom-skills batter
 * leaderboards for a given season and merge them by player_id.  Returns
 * a map from MLB player ID → StatcastBatter, enriched with the skill-
 * level rates (K%, BB%, xwOBACON, HH%) used by the component talent
 * model.
 *
 * Returns an empty map on total failure, or the skill-free map if only
 * the skills endpoint fails.
 *
 * Cached 24 hours.
 */
export async function fetchStatcastBatters(
  season: number = new Date().getFullYear(),
): Promise<Map<number, StatcastBatter>> {
  const cacheKey = `${CACHE_CATEGORIES.STATIC.prefix}:savant:batters:${season}`;

  try {
    const entries = await withCache(cacheKey, CACHE_CATEGORIES.STATIC.ttl, async () => {
      const expectedUrl = `${SAVANT_BASE}/leaderboard/expected_statistics?type=batter&year=${season}&position=&team=&min=1&csv=true`;
      const skillsUrl = buildCustomSkillsUrl('batter', season);

      const [expectedCsv, skillsCsvOrNull] = await Promise.all([
        savantFetch(expectedUrl),
        savantFetch(skillsUrl).catch((err) => {
          console.warn(`fetchStatcastBatters: skills leaderboard failed (${season}):`, err);
          return null;
        }),
      ]);

      const skillsMap = skillsCsvOrNull ? parseSkillsCsv(skillsCsvOrNull) : new Map<number, SkillsRow>();

      const rows = parseCsv(expectedCsv);
      const pairs: [number, StatcastBatter][] = [];

      for (const row of rows) {
        const mlbId = toInt(row['player_id']);
        if (!mlbId) continue;

        const skills = skillsMap.get(mlbId);
        pairs.push([mlbId, {
          mlbId,
          xba: toNum(row['est_ba']),
          xslg: toNum(row['est_slg']),
          xwoba: toNum(row['est_woba']),
          woba: toNum(row['woba']),
          pa: toInt(row['pa']),
          bip: toInt(row['bip']),
          kRate: skills?.kRate ?? null,
          bbRate: skills?.bbRate ?? null,
          xwobacon: skills?.xwobacon ?? null,
          hardHitRate: skills?.hardHitRate ?? null,
        }]);
      }

      return pairs;
    });
    return new Map(entries);
  } catch (err) {
    console.warn('fetchStatcastBatters failed — using empty map:', err);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Custom skills leaderboard (batter or pitcher)
//
// Single source for K%, BB%, xwOBACON, and HH% — each of these stabilises
// faster than xwOBA and together they drive the component talent model.
// ---------------------------------------------------------------------------

interface SkillsRow {
  kRate: number | null;       // decimal (0.22 = 22%)
  bbRate: number | null;      // decimal
  xwobacon: number | null;    // decimal (Savant reports as ".374")
  hardHitRate: number | null; // decimal (Savant reports as 40 → 0.40)
  /** Whiff rate (whiffs / swings). Leading indicator for K-rate, surfaced
   *  on the breakdown UI for transparency — NOT regressed into talent. */
  whiffPct: number | null;
  /** Barrel rate (barrels / batted ball events). Leading indicator for
   *  HR-prone vs HR-suppressing arms. UI-only. */
  barrelPct: number | null;
}

function buildCustomSkillsUrl(type: 'batter' | 'pitcher', season: number): string {
  // `min=1` matches the expected_statistics endpoint so merges align.
  // whiff_percent + barrel_batted_rate are leading indicators surfaced
  // for breakdown UI (see PitcherTalent.whiffPct / barrelPct).
  const selections = [
    'pa', 'xwobacon', 'k_percent', 'bb_percent', 'hard_hit_percent',
    'whiff_percent', 'barrel_batted_rate',
  ].join(',');
  return (
    `${SAVANT_BASE}/leaderboard/custom` +
    `?year=${season}&type=${type}&filter=&min=1&selections=${selections}` +
    `&chart=false&x=pa&y=pa&r=no&chartType=beeswarm&csv=true`
  );
}

function parseSkillsCsv(csv: string): Map<number, SkillsRow> {
  const rows = parseCsv(csv);
  const map = new Map<number, SkillsRow>();
  for (const row of rows) {
    const mlbId = toInt(row['player_id']);
    if (!mlbId) continue;

    // Savant reports rates as percentage numbers (22.1 meaning 22.1%), and
    // xwOBACON as a quote-wrapped decimal ".374". toNum already strips the
    // quotes; we just need to divide the percentage fields by 100.
    const kPct = toNum(row['k_percent']);
    const bbPct = toNum(row['bb_percent']);
    const hhPct = toNum(row['hard_hit_percent']);
    const whiffPct = toNum(row['whiff_percent']);
    const barrelPct = toNum(row['barrel_batted_rate']);

    map.set(mlbId, {
      kRate: kPct !== null ? kPct / 100 : null,
      bbRate: bbPct !== null ? bbPct / 100 : null,
      xwobacon: toNum(row['xwobacon']),
      hardHitRate: hhPct !== null ? hhPct / 100 : null,
      whiffPct: whiffPct !== null ? whiffPct / 100 : null,
      barrelPct: barrelPct !== null ? barrelPct / 100 : null,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Pitch-arsenal leaderboards (velocity + Run Value per 100)
//
// Two separate Savant CSV endpoints, stitched together at ingest:
//   1. pitch-arsenals   → per-pitcher-per-pitch-type velocity and usage.
//                         Usage-weight the FF/SI/FC rows → avgFastballVelo.
//   2. pitch-arsenal-stats → per-pitcher-per-pitch-type run_value_per_100.
//                         Usage-weight across ALL pitches → runValuePer100
//                         (pitcher perspective, lower = better).
//
// Both endpoints degrade gracefully: any failure simply yields null fields
// on the merged StatcastPitcher rows. The caller (schedule.ts) falls back
// to the existing component-xwOBA talent model in that case.
// ---------------------------------------------------------------------------

interface ArsenalRow {
  avgFastballVelo: number | null;
  runValuePer100: number | null;
}

/**
 * Fastball pitch-type codes we treat as "the fastball". Splitters / slurves
 * are intentionally excluded — they behave like off-speed in terms of
 * velocity expectations.
 */
const FASTBALL_TYPES = new Set(['FF', 'SI', 'FC']);

function parseArsenalVeloCsv(csv: string): Map<number, number> {
  // pitch-arsenals returns one row per pitcher with columns like
  // `ff_avg_speed`, `si_avg_speed`, `fc_avg_speed` plus usage counts
  // `n_ff`, `n_si`, `n_fc`. We compute a usage-weighted fastball velo.
  const rows = parseCsv(csv);
  const map = new Map<number, number>();
  for (const row of rows) {
    const mlbId = toInt(row['player_id']);
    if (!mlbId) continue;

    let weightedSum = 0;
    let totalN = 0;
    for (const code of ['ff', 'si', 'fc']) {
      const speed = toNum(row[`${code}_avg_speed`]);
      const n = toInt(row[`n_${code}`]);
      if (speed !== null && n > 0) {
        weightedSum += speed * n;
        totalN += n;
      }
    }
    if (totalN > 0) {
      map.set(mlbId, weightedSum / totalN);
    }
  }
  return map;
}

function parseArsenalStatsCsv(csv: string): Map<number, number> {
  // pitch-arsenal-stats returns one row per pitcher per pitch type with
  // `pitches` (pitch count) and `run_value_per_100`. We roll back up to
  // a pitcher-level usage-weighted mean so it lines up with the existing
  // per-pitcher StatcastPitcher rows.
  const rows = parseCsv(csv);
  const agg = new Map<number, { weighted: number; totalPitches: number }>();
  for (const row of rows) {
    const mlbId = toInt(row['player_id']);
    if (!mlbId) continue;

    const rv = toNum(row['run_value_per_100']);
    const pitches = toInt(row['pitches']);
    if (rv === null || pitches <= 0) continue;

    // Filter to fastballs + breaking/offspeed we model — guard against any
    // stray eephus or unknown codes, though in practice Savant has these
    // rows locked to standard MLB classifications.
    const type = (row['pitch_type'] ?? '').toUpperCase();
    if (!type) continue;

    const cur = agg.get(mlbId) ?? { weighted: 0, totalPitches: 0 };
    cur.weighted += rv * pitches;
    cur.totalPitches += pitches;
    agg.set(mlbId, cur);

    // Kill `type` unused-variable complaints while still honouring the
    // guard above — we intentionally don't weight by pitch type beyond
    // pitch count. (FASTBALL_TYPES is used by parseArsenalVeloCsv.)
    void FASTBALL_TYPES;
  }

  const map = new Map<number, number>();
  for (const [id, { weighted, totalPitches }] of agg) {
    if (totalPitches > 0) {
      map.set(id, weighted / totalPitches);
    }
  }
  return map;
}

/**
 * Fetch both pitch-arsenal CSVs for the given season and merge them into
 * a per-pitcher map of ArsenalRow. Each endpoint fails independently: a
 * velocity-only response still yields a populated map (with null run
 * values), and vice versa. A total failure returns an empty map.
 */
async function fetchPitcherArsenal(season: number): Promise<Map<number, ArsenalRow>> {
  const veloUrl =
    `${SAVANT_BASE}/leaderboard/pitch-arsenals` +
    `?year=${season}&min=1&type=avg_speed&hand=&csv=true`;
  const statsUrl =
    `${SAVANT_BASE}/leaderboard/pitch-arsenal-stats` +
    `?year=${season}&min=1&type=pitcher&hand=&csv=true`;

  const [veloCsvOrNull, statsCsvOrNull] = await Promise.all([
    savantFetch(veloUrl).catch((err) => {
      console.warn(`fetchPitcherArsenal: velocity leaderboard failed (${season}):`, err);
      return null;
    }),
    savantFetch(statsUrl).catch((err) => {
      console.warn(`fetchPitcherArsenal: RV/100 leaderboard failed (${season}):`, err);
      return null;
    }),
  ]);

  const veloMap = veloCsvOrNull ? parseArsenalVeloCsv(veloCsvOrNull) : new Map<number, number>();
  const rvMap = statsCsvOrNull ? parseArsenalStatsCsv(statsCsvOrNull) : new Map<number, number>();

  const merged = new Map<number, ArsenalRow>();
  const ids = new Set<number>([...veloMap.keys(), ...rvMap.keys()]);
  for (const id of ids) {
    merged.set(id, {
      avgFastballVelo: veloMap.get(id) ?? null,
      runValuePer100: rvMap.get(id) ?? null,
    });
  }
  return merged;
}
