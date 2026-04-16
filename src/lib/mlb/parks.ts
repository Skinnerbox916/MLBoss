import type { ParkData, ParkTendency } from './types';

// ---------------------------------------------------------------------------
// Static park data — 2025 season (3-year rolling)
//
// Park factors sourced from Baseball Savant's Statcast Park Factors
// (https://baseballsavant.mlb.com/leaderboard/statcast-park-factors).
// 100 = league average on the wOBA index; values reflect a 3-year rolling
// window through 2025 for metric stability. HR-specific factors use the
// HR index from the same source.
//
// Venue IDs match statsapi.mlb.com venue IDs so we can cross-reference
// with live schedule data. IDs verified against the live /schedule endpoint.
// ---------------------------------------------------------------------------

function tendency(pf: number): ParkTendency {
  if (pf >= 108) return 'extreme-hitter';
  if (pf >= 103) return 'hitter';
  if (pf <= 92) return 'extreme-pitcher';
  if (pf <= 97) return 'pitcher';
  return 'neutral';
}

const PARKS_RAW: Omit<ParkData, 'tendency'>[] = [
  // AL East
  {
    mlbVenueId: 3,
    name: 'Fenway Park',
    teamAbbr: 'BOS',
    city: 'Boston, MA',
    lat: 42.3467, lng: -71.0972,
    surface: 'grass', roof: 'open',
    parkFactor: 108, parkFactorHR: 94, parkFactorL: 106, parkFactorR: 108,
    notes: 'Green Monster boosts RHB (short LF = doubles + HRs off the wall); deep RF triangle suppresses LHB HR',
  },
  {
    mlbVenueId: 3313,
    name: 'Yankee Stadium',
    teamAbbr: 'NYY',
    city: 'Bronx, NY',
    lat: 40.8296, lng: -73.9262,
    surface: 'grass', roof: 'open',
    parkFactor: 102, parkFactorHR: 118, parkFactorL: 110, parkFactorR: 96,
    notes: 'Short RF porch is an extreme LHB HR environment; RHB slightly suppressed despite the HR inflation',
  },
  {
    mlbVenueId: 14,
    name: 'Rogers Centre',
    teamAbbr: 'TOR',
    city: 'Toronto, ON',
    lat: 43.6414, lng: -79.3894,
    surface: 'turf', roof: 'retractable',
    parkFactor: 100, parkFactorHR: 104, parkFactorL: 98, parkFactorR: 101,
    notes: 'Turf boosts infield singles and SB opportunities; climate-controlled when closed',
  },
  {
    mlbVenueId: 2,
    name: 'Oriole Park at Camden Yards',
    teamAbbr: 'BAL',
    city: 'Baltimore, MD',
    lat: 39.2838, lng: -76.6218,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 108, parkFactorL: 104, parkFactorR: 102,
    notes: 'LF wall moved closer for 2025, restoring RHB HR environment after the 2022–24 suppression',
  },
  {
    mlbVenueId: 12,
    name: 'Tropicana Field',
    teamAbbr: 'TB',
    city: 'St. Petersburg, FL',
    lat: 27.7683, lng: -82.6534,
    surface: 'turf', roof: 'dome',
    parkFactor: 98, parkFactorHR: 96, parkFactorL: 97, parkFactorR: 99,
    notes: 'Rays return in 2026 after hurricane repairs. Dome eliminates weather; turf boosts speed',
  },
  // AL Central
  {
    mlbVenueId: 4,
    name: 'Rate Field',
    teamAbbr: 'CWS',
    city: 'Chicago, IL',
    lat: 41.8299, lng: -87.6338,
    surface: 'grass', roof: 'open',
    parkFactor: 99, parkFactorHR: 96, parkFactorL: 100, parkFactorR: 98,
    notes: 'Launches HR to RF; lake wind can suppress or boost significantly (renamed from Guaranteed Rate)',
  },
  {
    mlbVenueId: 5,
    name: 'Progressive Field',
    teamAbbr: 'CLE',
    city: 'Cleveland, OH',
    lat: 41.4962, lng: -81.6852,
    surface: 'grass', roof: 'open',
    parkFactor: 97, parkFactorHR: 85, parkFactorL: 96, parkFactorR: 97,
    notes: 'Pitcher-friendly; deep dimensions strongly suppress HR',
  },
  {
    mlbVenueId: 2394,
    name: 'Comerica Park',
    teamAbbr: 'DET',
    city: 'Detroit, MI',
    lat: 42.3390, lng: -83.0485,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 99, parkFactorL: 100, parkFactorR: 101,
    notes: 'Deep CF/LF historically suppress HR, but recent plays closer to neutral',
  },
  {
    mlbVenueId: 7,
    name: 'Kauffman Stadium',
    teamAbbr: 'KC',
    city: 'Kansas City, MO',
    lat: 39.0517, lng: -94.4803,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 85, parkFactorL: 101, parkFactorR: 102,
    notes: 'Large outfield suppresses HR sharply but boosts doubles/triples',
  },
  {
    mlbVenueId: 3312,
    name: 'Target Field',
    teamAbbr: 'MIN',
    city: 'Minneapolis, MN',
    lat: 44.9817, lng: -93.2781,
    surface: 'grass', roof: 'open',
    parkFactor: 103, parkFactorHR: 102, parkFactorL: 102, parkFactorR: 103,
    notes: 'Slight hitter lean; cold early-season games can suppress offense',
  },
  // AL West
  {
    mlbVenueId: 1,
    name: 'Angel Stadium',
    teamAbbr: 'LAA',
    city: 'Anaheim, CA',
    lat: 33.8003, lng: -117.8827,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 113, parkFactorL: 98, parkFactorR: 103,
    notes: 'Strong HR environment (113 HR index), particularly for RHB',
  },
  {
    mlbVenueId: 2529,
    name: 'Sutter Health Park',
    teamAbbr: 'OAK',
    city: 'West Sacramento, CA',
    lat: 38.5801, lng: -121.5128,
    surface: 'grass', roof: 'open',
    parkFactor: 110, parkFactorHR: 118, parkFactorL: 108, parkFactorR: 112,
    notes: 'A\'s temp home since 2025 — compact AAA dimensions + hot dry Sacramento air make it a genuine HR bandbox, RHB tilt',
  },
  {
    mlbVenueId: 680,
    name: 'T-Mobile Park',
    teamAbbr: 'SEA',
    city: 'Seattle, WA',
    lat: 47.5914, lng: -122.3325,
    surface: 'grass', roof: 'retractable',
    parkFactor: 95, parkFactorHR: 94, parkFactorL: 96, parkFactorR: 93,
    notes: 'Still one of the tougher parks, marine air suppresses RHB more than LHB — but less extreme than its 2015–22 reputation',
  },
  {
    mlbVenueId: 5325,
    name: 'Globe Life Field',
    teamAbbr: 'TEX',
    city: 'Arlington, TX',
    lat: 32.7473, lng: -97.0828,
    surface: 'grass', roof: 'retractable',
    parkFactor: 97, parkFactorHR: 104, parkFactorL: 97, parkFactorR: 97,
    notes: 'Climate-controlled dome; plays more neutral than expected for a hitter-built park',
  },
  {
    mlbVenueId: 2392,
    name: 'Daikin Park',
    teamAbbr: 'HOU',
    city: 'Houston, TX',
    lat: 29.7573, lng: -95.3555,
    surface: 'grass', roof: 'retractable',
    parkFactor: 100, parkFactorHR: 105, parkFactorL: 102, parkFactorR: 99,
    notes: 'Crawford Boxes boost LHB HR; retractable roof removes weather (renamed from Minute Maid)',
  },
  // NL East
  {
    mlbVenueId: 4705,
    name: 'Truist Park',
    teamAbbr: 'ATL',
    city: 'Cumberland, GA',
    lat: 33.8908, lng: -84.4677,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 105, parkFactorL: 101, parkFactorR: 101,
    notes: 'Slight hitter lean; warm Georgia air helps ball carry in summer',
  },
  {
    mlbVenueId: 4169,
    name: 'loanDepot park',
    teamAbbr: 'MIA',
    city: 'Miami, FL',
    lat: 25.7781, lng: -80.2197,
    surface: 'grass', roof: 'retractable',
    parkFactor: 101, parkFactorHR: 90, parkFactorL: 103, parkFactorR: 100,
    notes: 'Deep dimensions crush HR (90 index) but overall offense plays neutral/slight LHB lean',
  },
  {
    mlbVenueId: 3289,
    name: 'Citi Field',
    teamAbbr: 'NYM',
    city: 'Flushing, NY',
    lat: 40.7571, lng: -73.8458,
    surface: 'grass', roof: 'open',
    parkFactor: 98, parkFactorHR: 104, parkFactorL: 98, parkFactorR: 99,
    notes: 'Slight pitcher lean overall but HR plays above average',
  },
  {
    mlbVenueId: 2681,
    name: 'Citizens Bank Park',
    teamAbbr: 'PHI',
    city: 'Philadelphia, PA',
    lat: 39.9061, lng: -75.1665,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 115, parkFactorL: 104, parkFactorR: 99,
    notes: 'Elite HR park (115 HR index) favoring LHB; summer heat amplifies power',
  },
  {
    mlbVenueId: 3309,
    name: 'Nationals Park',
    teamAbbr: 'WSH',
    city: 'Washington, DC',
    lat: 38.8730, lng: -77.0074,
    surface: 'grass', roof: 'open',
    parkFactor: 101, parkFactorHR: 94, parkFactorL: 102, parkFactorR: 100,
    notes: 'Slight LHB-friendly; HR-suppressing despite neutral run environment',
  },
  // NL Central
  {
    mlbVenueId: 17,
    name: 'Wrigley Field',
    teamAbbr: 'CHC',
    city: 'Chicago, IL',
    lat: 41.9484, lng: -87.6553,
    surface: 'grass', roof: 'open',
    parkFactor: 97, parkFactorHR: 99, parkFactorL: 98, parkFactorR: 96,
    notes: 'Wind is the story — out-to-CF can turn it into an extreme HR park; in-from-LF suppresses offense',
  },
  {
    mlbVenueId: 2602,
    name: 'Great American Ball Park',
    teamAbbr: 'CIN',
    city: 'Cincinnati, OH',
    lat: 39.0979, lng: -84.5082,
    surface: 'grass', roof: 'open',
    parkFactor: 103, parkFactorHR: 123, parkFactorL: 106, parkFactorR: 102,
    notes: 'Extreme HR park (123 HR index) — compact dimensions and summer heat',
  },
  {
    mlbVenueId: 32,
    name: 'American Family Field',
    teamAbbr: 'MIL',
    city: 'Milwaukee, WI',
    lat: 43.0280, lng: -87.9712,
    surface: 'grass', roof: 'retractable',
    parkFactor: 97, parkFactorHR: 106, parkFactorL: 96, parkFactorR: 99,
    notes: 'HR plays above average but overall wOBA trends neutral/slight pitcher',
  },
  {
    mlbVenueId: 31,
    name: 'PNC Park',
    teamAbbr: 'PIT',
    city: 'Pittsburgh, PA',
    lat: 40.4469, lng: -80.0057,
    surface: 'grass', roof: 'open',
    parkFactor: 98, parkFactorHR: 85, parkFactorL: 98, parkFactorR: 97,
    notes: 'One of MLB\'s lowest HR environments; deep RF especially suppresses LHB power',
  },
  {
    mlbVenueId: 2889,
    name: 'Busch Stadium',
    teamAbbr: 'STL',
    city: 'St. Louis, MO',
    lat: 38.6226, lng: -90.1928,
    surface: 'grass', roof: 'open',
    parkFactor: 100, parkFactorHR: 87, parkFactorL: 99, parkFactorR: 100,
    notes: 'Neutral overall wOBA but HR-suppressing — Cardinals build for contact/defense',
  },
  // NL West
  {
    mlbVenueId: 15,
    name: 'Chase Field',
    teamAbbr: 'ARI',
    city: 'Phoenix, AZ',
    lat: 33.4453, lng: -112.0667,
    surface: 'grass', roof: 'retractable',
    parkFactor: 103, parkFactorHR: 88, parkFactorL: 101, parkFactorR: 105,
    notes: 'Desert heat boosts offense, especially RHB; HR suppressed by humidor',
  },
  {
    mlbVenueId: 19,
    name: 'Coors Field',
    teamAbbr: 'COL',
    city: 'Denver, CO',
    lat: 39.7559, lng: -104.9942,
    surface: 'grass', roof: 'open',
    parkFactor: 115, parkFactorHR: 118, parkFactorL: 115, parkFactorR: 115,
    notes: '5,200 ft elevation — most extreme offensive environment in MLB; big boost to both HR and BABIP (doubles/triples)',
  },
  {
    mlbVenueId: 22,
    name: 'Dodger Stadium',
    teamAbbr: 'LAD',
    city: 'Los Angeles, CA',
    lat: 34.0739, lng: -118.2400,
    surface: 'grass', roof: 'open',
    parkFactor: 102, parkFactorHR: 120, parkFactorL: 100, parkFactorR: 104,
    notes: 'Among the top HR parks in MLB, especially for RHB; overall wOBA plays only slightly above neutral',
  },
  {
    mlbVenueId: 2680,
    name: 'Petco Park',
    teamAbbr: 'SD',
    city: 'San Diego, CA',
    lat: 32.7076, lng: -117.1570,
    surface: 'grass', roof: 'open',
    parkFactor: 97, parkFactorHR: 102, parkFactorL: 97, parkFactorR: 98,
    notes: 'Pacific marine layer historically kills HR, but plays closer to neutral in recent seasons',
  },
  {
    mlbVenueId: 2395,
    name: 'Oracle Park',
    teamAbbr: 'SF',
    city: 'San Francisco, CA',
    lat: 37.7786, lng: -122.3893,
    surface: 'grass', roof: 'open',
    parkFactor: 97, parkFactorHR: 82, parkFactorL: 96, parkFactorR: 97,
    notes: 'Cold bay air and wind off McCovey Cove give this the lowest HR index in MLB (82)',
  },
];

// Build the full PARKS map with computed tendency
export const PARKS: ParkData[] = PARKS_RAW.map(p => ({
  ...p,
  tendency: tendency(p.parkFactor),
}));

// Index by MLB venue ID for O(1) lookup from schedule data
export const PARKS_BY_VENUE_ID: Map<number, ParkData> = new Map(
  PARKS.map(p => [p.mlbVenueId, p]),
);

// Index by team abbreviation for Yahoo roster → park lookup
export const PARKS_BY_TEAM: Map<string, ParkData> = new Map(
  PARKS.map(p => [p.teamAbbr, p]),
);

export function getParkByVenueId(venueId: number): ParkData | undefined {
  return PARKS_BY_VENUE_ID.get(venueId);
}

export function getParkByTeam(teamAbbr: string): ParkData | undefined {
  return PARKS_BY_TEAM.get(teamAbbr.toUpperCase());
}
