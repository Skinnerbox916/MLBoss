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
  const res = await fetch(url, {
    headers: {
      'Accept': 'text/csv,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; mlboss/1.0)',
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`Baseball Savant ${res.status}: ${url}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Pitcher leaderboard
// ---------------------------------------------------------------------------

/**
 * Fetch the Baseball Savant expected_statistics pitcher leaderboard for a
 * given season.  Returns a map from MLB player ID → StatcastPitcher.
 * Returns an empty map on any failure — Statcast is enhancement-only.
 *
 * Cached 24 hours: Savant recomputes expected stats once nightly.
 *
 * Key columns: player_id, pa, bip, woba, est_woba (= xwOBA), era, xera
 */
export async function fetchStatcastPitchers(
  season: number = new Date().getFullYear(),
): Promise<Map<number, StatcastPitcher>> {
  const cacheKey = `${CACHE_CATEGORIES.STATIC.prefix}:savant:pitchers:${season}`;

  try {
    // withCache serialises via JSON which destroys Map instances.
    // Store as [key, value][] and reconstruct on retrieval.
    const entries = await withCache(cacheKey, CACHE_CATEGORIES.STATIC.ttl, async () => {
      const url = `${SAVANT_BASE}/leaderboard/expected_statistics?type=pitcher&year=${season}&position=&team=&min=1&csv=true`;
      const csv = await savantFetch(url);
      const rows = parseCsv(csv);
      const pairs: [number, StatcastPitcher][] = [];

      for (const row of rows) {
        const mlbId = toInt(row['player_id']);
        if (!mlbId) continue;

        pairs.push([mlbId, {
          mlbId,
          xera: toNum(row['xera']),
          xwoba: toNum(row['est_woba']),
          era: toNum(row['era']),
          woba: toNum(row['woba']),
          pa: toInt(row['pa']),
          bip: toInt(row['bip']),
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
 * Fetch the Baseball Savant expected_statistics batter leaderboard for a
 * given season.  Returns a map from MLB player ID → StatcastBatter.
 * Returns an empty map on any failure.
 *
 * Cached 24 hours.
 *
 * Key columns: player_id, pa, bip, est_ba (xBA), est_slg (xSLG),
 *              est_woba (xwOBA), woba
 */
export async function fetchStatcastBatters(
  season: number = new Date().getFullYear(),
): Promise<Map<number, StatcastBatter>> {
  const cacheKey = `${CACHE_CATEGORIES.STATIC.prefix}:savant:batters:${season}`;

  try {
    const entries = await withCache(cacheKey, CACHE_CATEGORIES.STATIC.ttl, async () => {
      const url = `${SAVANT_BASE}/leaderboard/expected_statistics?type=batter&year=${season}&position=&team=&min=1&csv=true`;
      const csv = await savantFetch(url);
      const rows = parseCsv(csv);
      const pairs: [number, StatcastBatter][] = [];

      for (const row of rows) {
        const mlbId = toInt(row['player_id']);
        if (!mlbId) continue;

        pairs.push([mlbId, {
          mlbId,
          xba: toNum(row['est_ba']),
          xslg: toNum(row['est_slg']),
          xwoba: toNum(row['est_woba']),
          woba: toNum(row['woba']),
          pa: toInt(row['pa']),
          bip: toInt(row['bip']),
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
