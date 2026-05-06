#!/usr/bin/env node
/**
 * Generate the per-park field block for `src/lib/mlb/parks.ts` from the
 * scraped Savant data. Reads /tmp/pf_2026.json (3y rolling through
 * 2026 — the leaderboard's current default, which incorporates 2026
 * data as the season progresses), and falls back to /tmp/pf_2026_2y.json
 * for parks without sufficient 3y history (Sutter Health, which the A's
 * have only used since 2025).
 *
 * Refresh prerequisites:
 *   node scripts/scrape-park-factors.mjs 2026 3 > /tmp/pf_2026.json
 *   node scripts/scrape-park-factors.mjs 2026 2 > /tmp/pf_2026_2y.json
 *
 * Output: a JSON map keyed by venueId with every numeric park-factor
 * field consumed by `ParkData` in `src/lib/mlb/types.ts`. Adding a new
 * field to `ParkData` means extending this script too — that's the
 * mechanism that prevents the data table and the type from drifting
 * (the gap that produced the May-2026 NaN bug for STL/MIN/SEA/TEX/
 * ARI/LAD/SD where the type was extended but the table wasn't).
 *
 * Pipe into a follow-up script that splices into parks.ts (or apply by
 * hand).
 */

import { readFileSync } from 'node:fs';

const main3y = JSON.parse(readFileSync('/tmp/pf_2026.json', 'utf8'));
const fallback2y = JSON.parse(readFileSync('/tmp/pf_2026_2y.json', 'utf8'));

const indexBy = (arr) => new Map(arr.map(p => [p.venue_id, p]));
const m3 = indexBy(main3y.parks);
const m2 = indexBy(fallback2y.parks);

const SPECIAL_SOURCES = {
  '2529': { src: m2, why: '2y rolling 2025-2026 (Sutter Health: A\'s only since 2025)' },
};

// All 30 venues we expose in parks.ts, keyed by mlbVenueId.
const VENUES = [
  3, 3313, 14, 2, 12,                // AL East
  4, 5, 2394, 7, 3312,               // AL Central
  1, 2529, 680, 5325, 2392,          // AL West
  4705, 4169, 3289, 2681, 3309,      // NL East
  17, 2602, 32, 31, 2889,            // NL Central
  15, 19, 22, 2680, 2395,            // NL West
];

function pickSource(venueId) {
  const idStr = String(venueId);
  const special = SPECIAL_SOURCES[idStr];
  if (special) return { row: special.src.get(idStr), provenance: special.why };
  const row = m3.get(idStr);
  if (row) {
    // Tropicana is in the 3y pull but with a thin sample because Rays
    // were displaced 2024-2025 by Hurricane Milton. Flag the provenance
    // honestly so callers know magnitude is less reliable than full-sample parks.
    if (idStr === '12') return { row, provenance: 'thin 3y rolling (Tropicana: Rays displaced 2024-25)' };
    return { row, provenance: '3y rolling 2024-2026' };
  }
  return { row: null, provenance: 'NOT FOUND' };
}

function clamp200(v) {
  // Trust Savant numbers 50-200; outside that range almost always means small sample
  if (v == null) return null;
  if (v < 50 || v > 200) return null;
  return Math.round(v);
}

const result = {};
for (const venueId of VENUES) {
  const { row, provenance } = pickSource(venueId);
  if (!row) {
    result[venueId] = { provenance, error: 'no data' };
    continue;
  }
  const both = row;
  const lhb = row.bat_l ?? {};
  const rhb = row.bat_r ?? {};
  result[venueId] = {
    venue_name: row.venue_name,
    club: row.club,
    provenance,
    n_pa: both.n_pa,
    parkFactor: clamp200(both.index_woba) ?? 100,
    parkFactorHR: clamp200(both.index_hr) ?? 100,
    parkFactorL: clamp200(lhb.index_woba) ?? clamp200(both.index_woba) ?? 100,
    parkFactorR: clamp200(rhb.index_woba) ?? clamp200(both.index_woba) ?? 100,
    parkFactorHrL: clamp200(lhb.index_hr) ?? clamp200(both.index_hr) ?? 100,
    parkFactorHrR: clamp200(rhb.index_hr) ?? clamp200(both.index_hr) ?? 100,
    parkFactor2B: clamp200(both.index_2b) ?? 100,
    parkFactor3B: clamp200(both.index_3b) ?? 100,
    parkFactorBACON: clamp200(both.index_bacon) ?? 100,
    parkFactorBB: clamp200(both.index_bb) ?? 100,
    parkFactorBBL: clamp200(lhb.index_bb) ?? clamp200(both.index_bb) ?? 100,
    parkFactorBBR: clamp200(rhb.index_bb) ?? clamp200(both.index_bb) ?? 100,
    parkFactorSO: clamp200(both.index_so) ?? 100,
    parkFactorSOL: clamp200(lhb.index_so) ?? clamp200(both.index_so) ?? 100,
    parkFactorSOR: clamp200(rhb.index_so) ?? clamp200(both.index_so) ?? 100,
    parkFactorHardHit: clamp200(both.index_hardhit) ?? 100,
    parkFactorXBACON: clamp200(both.index_xbacon) ?? 100,
  };
}

console.log(JSON.stringify(result, null, 2));
