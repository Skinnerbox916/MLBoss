import type { ParkData, ParkTendency } from './types';

// ---------------------------------------------------------------------------
// Static park data — 2026 season
//
// All numeric park factors come from Baseball Savant's Statcast Park Factors
// leaderboard:
//   https://baseballsavant.mlb.com/leaderboard/statcast-park-factors
//
// Pull is reproducible (defaults match the leaderboard's current view —
// 3-year rolling window ending in the current season):
//   node scripts/scrape-park-factors.mjs 2026 3 > /tmp/pf_2026.json
//   node scripts/scrape-park-factors.mjs 2026 2 > /tmp/pf_2026_2y.json
//   node scripts/generate-park-entries.mjs > /tmp/park_entries_fresh.json
//
// Values below were last refreshed against the 2024–2026 window
// (3y rolling through the in-progress 2026 season — what users see on
// the leaderboard today). Refresh periodically through the year as more
// 2026 data accumulates.
//
// Provenance per park:
//   * 28 of 30 parks: 3-year rolling 2024–2026 (~40k PA each).
//   * Sutter Health Park: 2-year rolling 2025–2026 (~22k PA). The A's
//     only began using it in 2025; no 3y history exists.
//   * Tropicana Field: 3y rolling 2024–2026 but with a thin ~21k PA
//     sample because the Rays were displaced to Steinbrenner Field for
//     2024–2025 due to Hurricane Milton damage. Numbers are mostly
//     2023 data + early 2026; treat magnitude with caution.
//
// Field mapping (Savant column → ParkData field):
//   index_woba    → parkFactor (overall, batSide=Both)
//   index_hr      → parkFactorHR
//   index_woba    → parkFactorL / parkFactorR (batSide=L / batSide=R slices)
//   index_hr      → parkFactorHrL / parkFactorHrR
//   index_2b      → parkFactor2B    (batSide=Both)
//   index_3b      → parkFactor3B    (batSide=Both)
//   index_bacon   → parkFactorBACON (batSide=Both, includes HR — NOT BABIP)
//   index_bb      → parkFactorBB / parkFactorBBL / parkFactorBBR
//   index_so      → parkFactorSO / parkFactorSOL / parkFactorSOR
//   index_hardhit → parkFactorHardHit (batSide=Both)
//   index_xbacon  → parkFactorXBACON (batSide=Both)
//
// `windSensitivity` is NOT in Savant data — it's a curated flag for the
// three parks where wind off open water / wind-tunnel geometry meaningfully
// swings game-to-game offense (Wrigley, Oracle, Sutter Health). Static
// 3y factors already average over wind variance, so this flag exists for
// the day-of weather amplifier in `parkAdjustment.ts`.
//
// Consumers MUST go through `src/lib/mlb/parkAdjustment.ts`. Reading these
// fields directly from feature code re-introduces the inline-clamp drift
// that the parkAdjustment primitive exists to eliminate.
//
// Venue IDs match statsapi.mlb.com venue IDs so we can cross-reference
// with live schedule data.
// ---------------------------------------------------------------------------

/**
 * Bucket a park into a tendency label. Uses the max-magnitude across the
 * four primary factors (overall, HR, L, R) so a park that's neutral
 * overall but extreme on one dimension (e.g. Yankee Stadium: 101 overall
 * but 118 HR) lands in the right bucket for the dimension that matters.
 *
 * Sign comes from `parkFactor` overall — a park with a strong HR boost
 * but neutral overall stays bucketed by its overall lean.
 */
function tendency(p: Omit<ParkData, 'tendency'>): ParkTendency {
  const mag = Math.max(
    Math.abs(p.parkFactor - 100),
    Math.abs(p.parkFactorHR - 100),
    Math.abs(p.parkFactorL - 100),
    Math.abs(p.parkFactorR - 100),
  );
  const hitterLeaning = p.parkFactor >= 100 || p.parkFactorHR >= 105;
  if (mag >= 12) return hitterLeaning ? 'extreme-hitter' : 'extreme-pitcher';
  if (mag >= 6) return hitterLeaning ? 'hitter' : 'pitcher';
  return 'neutral';
}

const PARKS_RAW: Omit<ParkData, 'tendency'>[] = [
  {
    mlbVenueId: 3,
    name: 'Fenway Park',
    teamAbbr: 'BOS',
    city: 'Boston, MA',
    lat: 42.3467, lng: -71.0972,
    surface: 'grass', roof: 'open',
    parkFactor: 102, parkFactorHR: 84, parkFactorL: 103, parkFactorR: 101,
    parkFactorHrL: 81, parkFactorHrR: 87,
    parkFactorBACON: 104, parkFactor2B: 118, parkFactor3B: 84,
    parkFactorBB: 97, parkFactorBBL: 98, parkFactorBBR: 97,
    parkFactorSO: 98, parkFactorSOL: 92, parkFactorSOR: 103,
    parkFactorHardHit: 100, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'Hitter park through extra-base hits (2B 118), NOT HR (HR 84 — both hands suppressed). Green Monster turns would-be HR into doubles, especially for RHB. BACON 104 confirms above-average contact-hit value',
  },
  {
    mlbVenueId: 3313,
    name: 'Yankee Stadium',
    teamAbbr: 'NYY',
    city: 'Bronx, NY',
    lat: 40.8296, lng: -73.9262,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 118, parkFactorL: 102, parkFactorR: 101,
    parkFactorHrL: 114, parkFactorHrR: 121,
    parkFactorBACON: 98, parkFactor2B: 91, parkFactor3B: 69,
    parkFactorBB: 119, parkFactorBBL: 126, parkFactorBBR: 112,
    parkFactorSO: 102, parkFactorSOL: 98, parkFactorSOR: 105,
    parkFactorHardHit: 105, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'Top-tier HR park (HR 118) with a slight RHB skew (121 vs 114) — the "short porch is for lefties" lore is misleading; both hands hit ~15-20% more HR here. Suppresses 2B/3B (small OF) and contact (BACON 98); the run environment is purely HR-driven',
  },
  {
    mlbVenueId: 14,
    name: 'Rogers Centre',
    teamAbbr: 'TOR',
    city: 'Toronto, ON',
    lat: 43.6414, lng: -79.3894,
    surface: 'turf', roof: 'retractable',
    parkFactor: 101, parkFactorHR: 110, parkFactorL: 99, parkFactorR: 103,
    parkFactorHrL: 107, parkFactorHrR: 112,
    parkFactorBACON: 99, parkFactor2B: 104, parkFactor3B: 73,
    parkFactorBB: 98, parkFactorBBL: 93, parkFactorBBR: 103,
    parkFactorSO: 97, parkFactorSOL: 104, parkFactorSOR: 91,
    parkFactorHardHit: 100, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'Mild hitter park; HR boost (110) skews slightly RHB. Turf compresses 3B (73) since balls return to OFs faster',
  },
  {
    mlbVenueId: 2,
    name: 'Oriole Park at Camden Yards',
    teamAbbr: 'BAL',
    city: 'Baltimore, MD',
    lat: 39.2838, lng: -76.6218,
    surface: 'grass', roof: 'open',
    parkFactor: 104, parkFactorHR: 113, parkFactorL: 105, parkFactorR: 102,
    parkFactorHrL: 126, parkFactorHrR: 101,
    parkFactorBACON: 104, parkFactor2B: 102, parkFactor3B: 129,
    parkFactorBB: 91, parkFactorBBL: 95, parkFactorBBR: 88,
    parkFactorSO: 99, parkFactorSOL: 96, parkFactorSOR: 101,
    parkFactorHardHit: 105, parkFactorXBACON: 102,
    windSensitivity: 'normal',
    notes: 'Strong asymmetric HR profile: LHB +26%, RHB neutral (101) after the 2025 LF-wall correction restored RHB power back to league average. Now a clear hitter park overall (104) with strong 3B factor (129)',
  },
  {
    mlbVenueId: 12,
    name: 'Tropicana Field',
    teamAbbr: 'TB',
    city: 'St. Petersburg, FL',
    lat: 27.7683, lng: -82.6534,
    surface: 'turf', roof: 'dome',
    parkFactor: 95, parkFactorHR: 97, parkFactorL: 92, parkFactorR: 97,
    parkFactorHrL: 84, parkFactorHrR: 107,
    parkFactorBACON: 96, parkFactor2B: 86, parkFactor3B: 130,
    parkFactorBB: 96, parkFactorBBL: 100, parkFactorBBR: 92,
    parkFactorSO: 105, parkFactorSOL: 106, parkFactorSOR: 104,
    parkFactorHardHit: 92, parkFactorXBACON: 98,
    windSensitivity: 'normal',
    notes: 'Provenance note: thin 3y sample (~21k PA) because the Rays were displaced to Steinbrenner Field 2024-2025. Numbers are 2023 + partial 2026; magnitude less reliable than full-sample parks. Historical pattern: slight pitcher park, LHB suppressed more than RHB',
  },
  {
    mlbVenueId: 4,
    name: 'Rate Field',
    teamAbbr: 'CWS',
    city: 'Chicago, IL',
    lat: 41.8299, lng: -87.6338,
    surface: 'grass', roof: 'open',
    parkFactor: 98, parkFactorHR: 94, parkFactorL: 100, parkFactorR: 97,
    parkFactorHrL: 101, parkFactorHrR: 87,
    parkFactorBACON: 97, parkFactor2B: 93, parkFactor3B: 76,
    parkFactorBB: 105, parkFactorBBL: 113, parkFactorBBR: 99,
    parkFactorSO: 97, parkFactorSOL: 97, parkFactorSOR: 97,
    parkFactorHardHit: 96, parkFactorXBACON: 98,
    windSensitivity: 'normal',
    notes: 'Slight pitcher park; suppresses RHB HR (87) more than LHB. Triples factor (76) low despite open conformation — likely OF positioning',
  },
  {
    mlbVenueId: 5,
    name: 'Progressive Field',
    teamAbbr: 'CLE',
    city: 'Cleveland, OH',
    lat: 41.4962, lng: -81.6852,
    surface: 'grass', roof: 'open',
    parkFactor: 98, parkFactorHR: 95, parkFactorL: 97, parkFactorR: 99,
    parkFactorHrL: 104, parkFactorHrR: 83,
    parkFactorBACON: 99, parkFactor2B: 103, parkFactor3B: 50,
    parkFactorBB: 102, parkFactorBBL: 97, parkFactorBBR: 109,
    parkFactorSO: 105, parkFactorSOL: 100, parkFactorSOR: 110,
    parkFactorHardHit: 96, parkFactorXBACON: 99,
    windSensitivity: 'normal',
    notes: 'Plays roughly neutral overall but strongly suppresses RHB HR (83) and triples (50 — bottom of MLB). LHB get a slight HR lift (104). Cool spring weather amplifies suppression',
  },
  {
    mlbVenueId: 2394,
    name: 'Comerica Park',
    teamAbbr: 'DET',
    city: 'Detroit, MI',
    lat: 42.3390, lng: -83.0485,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 103, parkFactorL: 102, parkFactorR: 100,
    parkFactorHrL: 102, parkFactorHrR: 104,
    parkFactorBACON: 100, parkFactor2B: 94, parkFactor3B: 151,
    parkFactorBB: 98, parkFactorBBL: 94, parkFactorBBR: 103,
    parkFactorSO: 97, parkFactorSOL: 100, parkFactorSOR: 95,
    parkFactorHardHit: 98, parkFactorXBACON: 99,
    windSensitivity: 'normal',
    notes: 'Plays near-neutral overall but is a top-tier triples park (151) — deep CF/LF gaps reward speed. The "Comerica kills HR" lore no longer holds — HR factor is league-average',
  },
  {
    mlbVenueId: 7,
    name: 'Kauffman Stadium',
    teamAbbr: 'KC',
    city: 'Kansas City, MO',
    lat: 39.0517, lng: -94.4803,
    surface: 'grass', roof: 'open',
    parkFactor: 100, parkFactorHR: 82, parkFactorL: 100, parkFactorR: 100,
    parkFactorHrL: 76, parkFactorHrR: 88,
    parkFactorBACON: 99, parkFactor2B: 118, parkFactor3B: 185,
    parkFactorBB: 100, parkFactorBBL: 97, parkFactorBBR: 102,
    parkFactorSO: 91, parkFactorSOL: 91, parkFactorSOR: 91,
    parkFactorHardHit: 104, parkFactorXBACON: 102,
    windSensitivity: 'normal',
    notes: 'MLB\'s top triples park (185) by a wide margin; spacious OF gaps reward speed. Strong 2B (118). HR strongly suppressed for both hands (LHB 76, RHB 88) — net plays neutral overall as 2B/3B compensate for missing HR',
  },
  {
    mlbVenueId: 3312,
    name: 'Target Field',
    teamAbbr: 'MIN',
    city: 'Minneapolis, MN',
    lat: 44.9817, lng: -93.2781,
    surface: 'grass', roof: 'open',
    parkFactor: 104, parkFactorHR: 98, parkFactorL: 101, parkFactorR: 106,
    parkFactorHrL: 96, parkFactorHrR: 99,
    parkFactorBACON: 104, parkFactor2B: 111, parkFactor3B: 81,
    parkFactorBB: 99, parkFactorBBL: 93, parkFactorBBR: 106,
    parkFactorSO: 97, parkFactorSOL: 102, parkFactorSOR: 93,
    parkFactorHardHit: 100, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'Hitter park (104) but HR-neutral (98). Lift comes from contact (BACON 104) and 2B (111); skews slightly RHB. Cold early-season can damp first-month numbers',
  },
  {
    mlbVenueId: 1,
    name: 'Angel Stadium',
    teamAbbr: 'LAA',
    city: 'Anaheim, CA',
    lat: 33.8003, lng: -117.8827,
    surface: 'grass', roof: 'open',
    parkFactor: 100, parkFactorHR: 108, parkFactorL: 97, parkFactorR: 102,
    parkFactorHrL: 103, parkFactorHrR: 112,
    parkFactorBACON: 101, parkFactor2B: 92, parkFactor3B: 93,
    parkFactorBB: 101, parkFactorBBL: 101, parkFactorBBR: 100,
    parkFactorSO: 105, parkFactorSOL: 100, parkFactorSOR: 108,
    parkFactorHardHit: 99, parkFactorXBACON: 98,
    windSensitivity: 'normal',
    notes: 'Plays neutral overall but is a top-tier RHB HR environment (112). LHB get a smaller bump (103). Run environment is HR-driven; suppresses 2B/3B',
  },
  {
    mlbVenueId: 2529,
    name: 'Sutter Health Park',
    teamAbbr: 'OAK',
    city: 'West Sacramento, CA',
    lat: 38.5801, lng: -121.5128,
    surface: 'grass', roof: 'open',
    parkFactor: 109, parkFactorHR: 115, parkFactorL: 108, parkFactorR: 110,
    parkFactorHrL: 111, parkFactorHrR: 118,
    parkFactorBACON: 108, parkFactor2B: 123, parkFactor3B: 77,
    parkFactorBB: 111, parkFactorBBL: 117, parkFactorBBR: 106,
    parkFactorSO: 96, parkFactorSOL: 103, parkFactorSOR: 91,
    parkFactorHardHit: 97, parkFactorXBACON: 99,
    windSensitivity: 'high',
    notes: 'Provenance note: 2y rolling 2025-2026 (A\'s temp home; no 3y history yet). Hot — top-5 HR park (115), top-tier 2B (123), strong BACON (108). RHB get a slightly bigger HR bump (118 vs 111). Delta-breeze can swing day-to-day (windSensitivity: high). Treat magnitude with mild caution until more years accumulate',
  },
  {
    mlbVenueId: 680,
    name: 'T-Mobile Park',
    teamAbbr: 'SEA',
    city: 'Seattle, WA',
    lat: 47.5914, lng: -122.3325,
    surface: 'grass', roof: 'retractable',
    parkFactor: 92, parkFactorHR: 96, parkFactorL: 93, parkFactorR: 91,
    parkFactorHrL: 93, parkFactorHrR: 99,
    parkFactorBACON: 95, parkFactor2B: 92, parkFactor3B: 100,
    parkFactorBB: 96, parkFactorBBL: 95, parkFactorBBR: 97,
    parkFactorSO: 117, parkFactorSOL: 114, parkFactorSOR: 120,
    parkFactorHardHit: 99, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'MLB\'s most pitcher-friendly park (PF 92). Suppression spans contact (BACON 95) and 2B (92). HR slightly down (96 — RHB at 99, LHB at 93) but the bigger story is the overall offensive depression from cool marine air. Strongly suppresses contact (SO 117 — top in MLB)',
  },
  {
    mlbVenueId: 5325,
    name: 'Globe Life Field',
    teamAbbr: 'TEX',
    city: 'Arlington, TX',
    lat: 32.7473, lng: -97.0828,
    surface: 'grass', roof: 'retractable',
    parkFactor: 92, parkFactorHR: 89, parkFactorL: 93, parkFactorR: 91,
    parkFactorHrL: 91, parkFactorHrR: 88,
    parkFactorBACON: 92, parkFactor2B: 89, parkFactor3B: 80,
    parkFactorBB: 95, parkFactorBBL: 93, parkFactorBBR: 97,
    parkFactorSO: 103, parkFactorSOL: 99, parkFactorSOR: 106,
    parkFactorHardHit: 101, parkFactorXBACON: 98,
    windSensitivity: 'normal',
    notes: 'Strong pitcher park across every component (PF 92, HR 89, BACON 92, 2B 89). Climate-controlled when closed; both hands suppressed roughly equally',
  },
  {
    mlbVenueId: 2392,
    name: 'Daikin Park',
    teamAbbr: 'HOU',
    city: 'Houston, TX',
    lat: 29.7573, lng: -95.3555,
    surface: 'grass', roof: 'retractable',
    parkFactor: 101, parkFactorHR: 116, parkFactorL: 103, parkFactorR: 100,
    parkFactorHrL: 128, parkFactorHrR: 109,
    parkFactorBACON: 102, parkFactor2B: 97, parkFactor3B: 70,
    parkFactorBB: 101, parkFactorBBL: 107, parkFactorBBR: 97,
    parkFactorSO: 106, parkFactorSOL: 110, parkFactorSOR: 104,
    parkFactorHardHit: 99, parkFactorXBACON: 99,
    windSensitivity: 'normal',
    notes: 'Strong HR park (116) with sharp LHB skew via Crawford Boxes (128 vs 109). Run environment is almost purely HR-driven; suppresses 3B (70). Renamed from Minute Maid for the 2025 season',
  },
  {
    mlbVenueId: 4705,
    name: 'Truist Park',
    teamAbbr: 'ATL',
    city: 'Cumberland, GA',
    lat: 33.8908, lng: -84.4677,
    surface: 'grass', roof: 'open',
    parkFactor: 100, parkFactorHR: 95, parkFactorL: 99, parkFactorR: 100,
    parkFactorHrL: 99, parkFactorHrR: 92,
    parkFactorBACON: 103, parkFactor2B: 95, parkFactor3B: 94,
    parkFactorBB: 100, parkFactorBBL: 95, parkFactorBBR: 104,
    parkFactorSO: 105, parkFactorSOL: 101, parkFactorSOR: 107,
    parkFactorHardHit: 101, parkFactorXBACON: 102,
    windSensitivity: 'normal',
    notes: 'Plays neutral overall but suppresses HR (95) — RHB more (92). Contact-friendly (BACON 103). Warm summer air helps hits but not specifically HR',
  },
  {
    mlbVenueId: 4169,
    name: 'loanDepot park',
    teamAbbr: 'MIA',
    city: 'Miami, FL',
    lat: 25.7781, lng: -80.2197,
    surface: 'grass', roof: 'retractable',
    parkFactor: 100, parkFactorHR: 88, parkFactorL: 101, parkFactorR: 99,
    parkFactorHrL: 91, parkFactorHrR: 85,
    parkFactorBACON: 100, parkFactor2B: 106, parkFactor3B: 132,
    parkFactorBB: 100, parkFactorBBL: 100, parkFactorBBR: 99,
    parkFactorSO: 97, parkFactorSOL: 99, parkFactorSOR: 95,
    parkFactorHardHit: 101, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'Plays neutral overall despite HR suppression (88, RHB 85). Boosts 2B (106) and 3B (132) via deep alleys — value comes from gaps, not power',
  },
  {
    mlbVenueId: 3289,
    name: 'Citi Field',
    teamAbbr: 'NYM',
    city: 'Flushing, NY',
    lat: 40.7571, lng: -73.8458,
    surface: 'grass', roof: 'open',
    parkFactor: 99, parkFactorHR: 102, parkFactorL: 98, parkFactorR: 99,
    parkFactorHrL: 95, parkFactorHrR: 108,
    parkFactorBACON: 98, parkFactor2B: 93, parkFactor3B: 82,
    parkFactorBB: 108, parkFactorBBL: 107, parkFactorBBR: 108,
    parkFactorSO: 103, parkFactorSOL: 102, parkFactorSOR: 104,
    parkFactorHardHit: 101, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'Plays neutral overall with mild RHB HR boost (108) — the "Citi kills HR" lore is outdated. Suppresses 2B (93) and 3B (82); LHB still the disadvantaged side',
  },
  {
    mlbVenueId: 2681,
    name: 'Citizens Bank Park',
    teamAbbr: 'PHI',
    city: 'Philadelphia, PA',
    lat: 39.9061, lng: -75.1665,
    surface: 'grass', roof: 'open',
    parkFactor: 102, parkFactorHR: 114, parkFactorL: 104, parkFactorR: 100,
    parkFactorHrL: 132, parkFactorHrR: 98,
    parkFactorBACON: 103, parkFactor2B: 94, parkFactor3B: 99,
    parkFactorBB: 95, parkFactorBBL: 104, parkFactorBBR: 87,
    parkFactorSO: 103, parkFactorSOL: 104, parkFactorSOR: 102,
    parkFactorHardHit: 99, parkFactorXBACON: 99,
    windSensitivity: 'normal',
    notes: 'Top-tier HR park with sharp LHB skew (132) — short RF wall is the story. RHB neutral (98). Hitter overall driven entirely by LHB power and contact',
  },
  {
    mlbVenueId: 3309,
    name: 'Nationals Park',
    teamAbbr: 'WSH',
    city: 'Washington, DC',
    lat: 38.8730, lng: -77.0074,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 98, parkFactorL: 102, parkFactorR: 100,
    parkFactorHrL: 101, parkFactorHrR: 94,
    parkFactorBACON: 101, parkFactor2B: 97, parkFactor3B: 99,
    parkFactorBB: 95, parkFactorBBL: 94, parkFactorBBR: 97,
    parkFactorSO: 94, parkFactorSOL: 92, parkFactorSOR: 96,
    parkFactorHardHit: 103, parkFactorXBACON: 102,
    windSensitivity: 'normal',
    notes: 'Plays slightly hitter for LHB (102) and neutral for RHB. HR neutral overall (98) with mild RHB suppression (94)',
  },
  {
    mlbVenueId: 17,
    name: 'Wrigley Field',
    teamAbbr: 'CHC',
    city: 'Chicago, IL',
    lat: 41.9484, lng: -87.6553,
    surface: 'grass', roof: 'open',
    parkFactor: 95, parkFactorHR: 97, parkFactorL: 96, parkFactorR: 94,
    parkFactorHrL: 93, parkFactorHrR: 100,
    parkFactorBACON: 95, parkFactor2B: 81, parkFactor3B: 118,
    parkFactorBB: 101, parkFactorBBL: 98, parkFactorBBR: 104,
    parkFactorSO: 103, parkFactorSOL: 107, parkFactorSOR: 100,
    parkFactorHardHit: 101, parkFactorXBACON: 99,
    windSensitivity: 'high',
    notes: 'On 3y average plays slight pitcher (95) — but the average WASHES OUT the wind story. Day-to-day, out-to-CF wind makes it an extreme HR park; in-from-LF turns it into a graveyard. The static factors capture the long-run mean; `windSensitivity: high` is what the day-of amplifier in `parkAdjustment` keys off of to add the conditional swing',
  },
  {
    mlbVenueId: 2602,
    name: 'Great American Ball Park',
    teamAbbr: 'CIN',
    city: 'Cincinnati, OH',
    lat: 39.0979, lng: -84.5082,
    surface: 'grass', roof: 'open',
    parkFactor: 103, parkFactorHR: 122, parkFactorL: 105, parkFactorR: 102,
    parkFactorHrL: 127, parkFactorHrR: 119,
    parkFactorBACON: 101, parkFactor2B: 103, parkFactor3B: 68,
    parkFactorBB: 107, parkFactorBBL: 105, parkFactorBBR: 108,
    parkFactorSO: 102, parkFactorSOL: 105, parkFactorSOR: 101,
    parkFactorHardHit: 95, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'Top-tier HR park (122) — both hands strongly boosted with mild LHB skew (127 vs 119). Compact dimensions + Ohio summer heat. Hitter overall but mechanism is almost entirely HR — 2B and BACON are near-neutral',
  },
  {
    mlbVenueId: 32,
    name: 'American Family Field',
    teamAbbr: 'MIL',
    city: 'Milwaukee, WI',
    lat: 43.0280, lng: -87.9712,
    surface: 'grass', roof: 'retractable',
    parkFactor: 97, parkFactorHR: 106, parkFactorL: 97, parkFactorR: 98,
    parkFactorHrL: 99, parkFactorHrR: 111,
    parkFactorBACON: 99, parkFactor2B: 86, parkFactor3B: 93,
    parkFactorBB: 104, parkFactorBBL: 103, parkFactorBBR: 104,
    parkFactorSO: 109, parkFactorSOL: 112, parkFactorSOR: 107,
    parkFactorHardHit: 97, parkFactorXBACON: 99,
    windSensitivity: 'normal',
    notes: 'Slight pitcher overall but quiet HR park (106) — RHB pull power especially (111). Suppresses 2B (86) — the run environment is HR-driven',
  },
  {
    mlbVenueId: 31,
    name: 'PNC Park',
    teamAbbr: 'PIT',
    city: 'Pittsburgh, PA',
    lat: 40.4469, lng: -80.0057,
    surface: 'grass', roof: 'open',
    parkFactor: 100, parkFactorHR: 80, parkFactorL: 102, parkFactorR: 99,
    parkFactorHrL: 90, parkFactorHrR: 72,
    parkFactorBACON: 101, parkFactor2B: 118, parkFactor3B: 79,
    parkFactorBB: 100, parkFactorBBL: 100, parkFactorBBR: 100,
    parkFactorSO: 97, parkFactorSOL: 96, parkFactorSOR: 97,
    parkFactorHardHit: 102, parkFactorXBACON: 101,
    windSensitivity: 'normal',
    notes: 'Among MLB\'s lowest HR environments (80 overall, RHB just 72). Deep LF + tall RF wall. Compensates with 2B (118). Net neutral wOBA but pitcher-friendly for HR-driven categories',
  },
  {
    mlbVenueId: 2889,
    name: 'Busch Stadium',
    teamAbbr: 'STL',
    city: 'St. Louis, MO',
    lat: 38.6226, lng: -90.1928,
    surface: 'grass', roof: 'open',
    parkFactor: 98, parkFactorHR: 81, parkFactorL: 96, parkFactorR: 99,
    parkFactorHrL: 80, parkFactorHrR: 81,
    parkFactorBACON: 97, parkFactor2B: 106, parkFactor3B: 77,
    parkFactorBB: 93, parkFactorBBL: 92, parkFactorBBR: 94,
    parkFactorSO: 90, parkFactorSOL: 91, parkFactorSOR: 89,
    parkFactorHardHit: 102, parkFactorXBACON: 100,
    windSensitivity: 'normal',
    notes: 'Slight pitcher park; strongly suppresses HR in both directions (81 / 80 / 81). Boosts 2B (106) — gap power survives even when HR doesn\'t. Suppresses both walks (BB 93) and strikeouts (SO 90)',
  },
  // NL West
  {
    mlbVenueId: 15,
    name: 'Chase Field',
    teamAbbr: 'ARI',
    city: 'Phoenix, AZ',
    lat: 33.4453, lng: -112.0667,
    surface: 'grass', roof: 'retractable',
    parkFactor: 105, parkFactorHR: 93, parkFactorL: 101, parkFactorR: 108,
    parkFactorHrL: 76, parkFactorHrR: 109,
    parkFactorBACON: 103, parkFactor2B: 118, parkFactor3B: 100,
    parkFactorBB: 98, parkFactorBBL: 95, parkFactorBBR: 102,
    parkFactorSO: 91, parkFactorSOL: 93, parkFactorSOR: 89,
    parkFactorHardHit: 103, parkFactorXBACON: 103,
    windSensitivity: 'normal',
    notes: 'Hitter park (105) but HR factor split: LHB heavily suppressed (76) while RHB get a HR boost (109). Boosts 2B (118) via spacious gaps. Run environment favors RHB and contact hitters. Suppresses K (91) — visibility and ball-carry favor contact',
  },
  {
    mlbVenueId: 19,
    name: 'Coors Field',
    teamAbbr: 'COL',
    city: 'Denver, CO',
    lat: 39.7559, lng: -104.9942,
    surface: 'grass', roof: 'open',
    parkFactor: 112, parkFactorHR: 107, parkFactorL: 114, parkFactorR: 111,
    parkFactorHrL: 116, parkFactorHrR: 101,
    parkFactorBACON: 113, parkFactor2B: 120, parkFactor3B: 187,
    parkFactorBB: 99, parkFactorBBL: 109, parkFactorBBR: 91,
    parkFactorSO: 90, parkFactorSOL: 88, parkFactorSOR: 92,
    parkFactorHardHit: 101, parkFactorXBACON: 102,
    windSensitivity: 'normal',
    notes: 'MLB\'s most extreme offensive park (PF 112). Lift spans every component: HR (107, LHB 116 / RHB just 101), 2B (120), and a league-leading 3B factor (187). Contact value also massive (BACON 113). Outlier flag: regress with and without Coors when calibrating',
  },
  {
    mlbVenueId: 22,
    name: 'Dodger Stadium',
    teamAbbr: 'LAD',
    city: 'Los Angeles, CA',
    lat: 34.0739, lng: -118.2400,
    surface: 'grass', roof: 'open',
    parkFactor: 102, parkFactorHR: 129, parkFactorL: 100, parkFactorR: 103,
    parkFactorHrL: 121, parkFactorHrR: 136,
    parkFactorBACON: 98, parkFactor2B: 94, parkFactor3B: 69,
    parkFactorBB: 104, parkFactorBBL: 102, parkFactorBBR: 107,
    parkFactorSO: 100, parkFactorSOL: 104, parkFactorSOR: 96,
    parkFactorHardHit: 102, parkFactorXBACON: 102,
    windSensitivity: 'normal',
    notes: 'MLB\'s top HR park (129) with sharp RHB skew (136 vs 121). Suppresses 3B (69) and contact (BACON 98). The run environment is almost purely HR-driven; otherwise plays neutral',
  },
  {
    mlbVenueId: 2680,
    name: 'Petco Park',
    teamAbbr: 'SD',
    city: 'San Diego, CA',
    lat: 32.7076, lng: -117.1570,
    surface: 'grass', roof: 'open',
    parkFactor: 97, parkFactorHR: 108, parkFactorL: 97, parkFactorR: 98,
    parkFactorHrL: 99, parkFactorHrR: 116,
    parkFactorBACON: 97, parkFactor2B: 89, parkFactor3B: 71,
    parkFactorBB: 100, parkFactorBBL: 100, parkFactorBBR: 100,
    parkFactorSO: 102, parkFactorSOL: 99, parkFactorSOR: 105,
    parkFactorHardHit: 99, parkFactorXBACON: 99,
    windSensitivity: 'normal',
    notes: 'Slight pitcher overall (97) but a quiet RHB HR park (116) — the "Petco kills HR" lore no longer holds. What it does still suppress is contact (BACON 97), 2B (89), and 3B (71)',
  },
  {
    mlbVenueId: 2395,
    name: 'Oracle Park',
    teamAbbr: 'SF',
    city: 'San Francisco, CA',
    lat: 37.7786, lng: -122.3893,
    surface: 'grass', roof: 'open',
    parkFactor: 98, parkFactorHR: 77, parkFactorL: 97, parkFactorR: 98,
    parkFactorHrL: 73, parkFactorHrR: 80,
    parkFactorBACON: 99, parkFactor2B: 108, parkFactor3B: 137,
    parkFactorBB: 93, parkFactorBBL: 96, parkFactorBBR: 91,
    parkFactorSO: 97, parkFactorSOL: 99, parkFactorSOR: 95,
    parkFactorHardHit: 98, parkFactorXBACON: 98,
    windSensitivity: 'high',
    notes: 'MLB\'s most extreme HR-suppression park (HR 77 — 73 LHB / 80 RHB), driven by the deep RF gap (Triples Alley) and persistent in-from-CF marine wind. Compensates with elite 3B (137) and 2B (108) — gap power survives where HR doesn\'t. Bay-front wind swings day-to-day (windSensitivity: high)',
  }
];

export const PARKS: ParkData[] = PARKS_RAW.map(p => ({
  ...p,
  tendency: tendency(p),
}));

export const PARKS_BY_VENUE_ID: Map<number, ParkData> = new Map(
  PARKS.map(p => [p.mlbVenueId, p]),
);

export const PARKS_BY_TEAM: Map<string, ParkData> = new Map(
  PARKS.map(p => [p.teamAbbr, p]),
);

export function getParkByVenueId(venueId: number): ParkData | undefined {
  return PARKS_BY_VENUE_ID.get(venueId);
}

export function getParkByTeam(teamAbbr: string): ParkData | undefined {
  return PARKS_BY_TEAM.get(teamAbbr.toUpperCase());
}
