import type { ParkData, ParkTendency } from './types';

// ---------------------------------------------------------------------------
// Static park data — 2024/2025 season
//
// Park factors sourced from FanGraphs (wRC+ scale; 100 = league average).
// Updated pre-season; park factors are stable enough within a season
// that weekly updates aren't necessary.
//
// Venue IDs match statsapi.mlb.com venue IDs so we can cross-reference
// with live schedule data.
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
    mlbVenueId: 3313,
    name: 'Fenway Park',
    teamAbbr: 'BOS',
    city: 'Boston, MA',
    lat: 42.3467, lng: -71.0972,
    surface: 'grass', roof: 'open',
    parkFactor: 104, parkFactorHR: 97, parkFactorL: 106, parkFactorR: 103,
    notes: 'Green Monster inflates doubles/triples for RHB; suppresses HR slightly',
  },
  {
    mlbVenueId: 3289,
    name: 'Yankee Stadium',
    teamAbbr: 'NYY',
    city: 'Bronx, NY',
    lat: 40.8296, lng: -73.9262,
    surface: 'grass', roof: 'open',
    parkFactor: 106, parkFactorHR: 115, parkFactorL: 112, parkFactorR: 102,
    notes: 'Short RF porch strongly favors left-handed power hitters',
  },
  {
    mlbVenueId: 395,
    name: 'Rogers Centre',
    teamAbbr: 'TOR',
    city: 'Toronto, ON',
    lat: 43.6414, lng: -79.3894,
    surface: 'turf', roof: 'retractable',
    parkFactor: 101, parkFactorHR: 103, parkFactorL: 100, parkFactorR: 102,
    notes: 'Turf boosts infield singles and SB opportunities; climate-controlled when closed',
  },
  {
    mlbVenueId: 2392,
    name: 'Oriole Park at Camden Yards',
    teamAbbr: 'BAL',
    city: 'Baltimore, MD',
    lat: 39.2838, lng: -76.6218,
    surface: 'grass', roof: 'open',
    parkFactor: 103, parkFactorHR: 108, parkFactorL: 104, parkFactorR: 103,
    notes: 'Slight hitter\'s park; RF is reachable for both hands',
  },
  {
    mlbVenueId: 3506,
    name: 'Tropicana Field',
    teamAbbr: 'TB',
    city: 'St. Petersburg, FL',
    lat: 27.7683, lng: -82.6534,
    surface: 'turf', roof: 'dome',
    parkFactor: 98, parkFactorHR: 96, parkFactorL: 97, parkFactorR: 99,
    notes: 'Dome eliminates weather factors; turf boosts speed; suppresses HR slightly',
  },
  // AL Central
  {
    mlbVenueId: 4169,
    name: 'Guaranteed Rate Field',
    teamAbbr: 'CWS',
    city: 'Chicago, IL',
    lat: 41.8299, lng: -87.6338,
    surface: 'grass', roof: 'open',
    parkFactor: 103, parkFactorHR: 110, parkFactorL: 101, parkFactorR: 104,
    notes: 'Launches HR to RF; wind off Lake Michigan can suppress or boost significantly',
  },
  {
    mlbVenueId: 5,
    name: 'Progressive Field',
    teamAbbr: 'CLE',
    city: 'Cleveland, OH',
    lat: 41.4962, lng: -81.6852,
    surface: 'grass', roof: 'open',
    parkFactor: 97, parkFactorHR: 93, parkFactorL: 98, parkFactorR: 96,
    notes: 'Pitcher-friendly; deep dimensions suppress power numbers',
  },
  {
    mlbVenueId: 2394,
    name: 'Comerica Park',
    teamAbbr: 'DET',
    city: 'Detroit, MI',
    lat: 42.3390, lng: -83.0485,
    surface: 'grass', roof: 'open',
    parkFactor: 95, parkFactorHR: 88, parkFactorL: 95, parkFactorR: 95,
    notes: 'One of the most pitcher-friendly parks; very deep CF/LF suppress HR',
  },
  {
    mlbVenueId: 7,
    name: 'Kauffman Stadium',
    teamAbbr: 'KC',
    city: 'Kansas City, MO',
    lat: 39.0517, lng: -94.4803,
    surface: 'grass', roof: 'open',
    parkFactor: 99, parkFactorHR: 97, parkFactorL: 99, parkFactorR: 99,
    notes: 'Roughly neutral; large outfield slightly suppresses HR',
  },
  {
    mlbVenueId: 4,
    name: 'Target Field',
    teamAbbr: 'MIN',
    city: 'Minneapolis, MN',
    lat: 44.9817, lng: -93.2781,
    surface: 'grass', roof: 'open',
    parkFactor: 100, parkFactorHR: 101, parkFactorL: 99, parkFactorR: 101,
    notes: 'Neutral to slight hitter; cold early-season games can suppress offense',
  },
  // AL West
  {
    mlbVenueId: 1,
    name: 'Angel Stadium',
    teamAbbr: 'LAA',
    city: 'Anaheim, CA',
    lat: 33.8003, lng: -117.8827,
    surface: 'grass', roof: 'open',
    parkFactor: 98, parkFactorHR: 96, parkFactorL: 98, parkFactorR: 98,
    notes: 'Slight pitcher\'s park; inland heat can vary run environment',
  },
  {
    mlbVenueId: 2,
    name: 'Oakland Coliseum',
    teamAbbr: 'OAK',
    city: 'Oakland, CA',
    lat: 37.7516, lng: -122.2005,
    surface: 'grass', roof: 'open',
    parkFactor: 93, parkFactorHR: 88, parkFactorL: 93, parkFactorR: 93,
    notes: 'Marine layer and foul territory make this one of the toughest HR parks in baseball',
  },
  {
    mlbVenueId: 680,
    name: 'T-Mobile Park',
    teamAbbr: 'SEA',
    city: 'Seattle, WA',
    lat: 47.5914, lng: -122.3325,
    surface: 'grass', roof: 'retractable',
    parkFactor: 97, parkFactorHR: 95, parkFactorL: 98, parkFactorR: 96,
    notes: 'Pitcher-friendly; marine air suppresses HR; retractable roof minimizes weather',
  },
  {
    mlbVenueId: 2889,
    name: 'Globe Life Field',
    teamAbbr: 'TEX',
    city: 'Arlington, TX',
    lat: 32.7473, lng: -97.0828,
    surface: 'grass', roof: 'retractable',
    parkFactor: 104, parkFactorHR: 107, parkFactorL: 103, parkFactorR: 105,
    notes: 'Climate-controlled dome; hitter-friendly dimensions; HR-conducive',
  },
  {
    mlbVenueId: 2395,
    name: 'Minute Maid Park',
    teamAbbr: 'HOU',
    city: 'Houston, TX',
    lat: 29.7573, lng: -95.3555,
    surface: 'grass', roof: 'retractable',
    parkFactor: 103, parkFactorHR: 104, parkFactorL: 103, parkFactorR: 103,
    notes: 'Slight hitter\'s advantage; retractable roof removes weather variability',
  },
  // NL East
  {
    mlbVenueId: 3289,
    name: 'Truist Park',
    teamAbbr: 'ATL',
    city: 'Cumberland, GA',
    lat: 33.8908, lng: -84.4677,
    surface: 'grass', roof: 'open',
    parkFactor: 105, parkFactorHR: 108, parkFactorL: 104, parkFactorR: 105,
    notes: 'Hitter-friendly; warm Georgia air helps carry ball in summer',
  },
  {
    mlbVenueId: 4705,
    name: 'loanDepot Park',
    teamAbbr: 'MIA',
    city: 'Miami, FL',
    lat: 25.7781, lng: -80.2197,
    surface: 'grass', roof: 'retractable',
    parkFactor: 95, parkFactorHR: 91, parkFactorL: 95, parkFactorR: 95,
    notes: 'Pitcher-friendly despite warm climate; deep dimensions suppress HR',
  },
  {
    mlbVenueId: 3289,
    name: 'Citi Field',
    teamAbbr: 'NYM',
    city: 'Flushing, NY',
    lat: 40.7571, lng: -73.8458,
    surface: 'grass', roof: 'open',
    parkFactor: 96, parkFactorHR: 93, parkFactorL: 96, parkFactorR: 97,
    notes: 'Pitcher-friendly; marine air from nearby water suppresses fly balls',
  },
  {
    mlbVenueId: 2681,
    name: 'Citizens Bank Park',
    teamAbbr: 'PHI',
    city: 'Philadelphia, PA',
    lat: 39.9061, lng: -75.1665,
    surface: 'grass', roof: 'open',
    parkFactor: 107, parkFactorHR: 113, parkFactorL: 107, parkFactorR: 107,
    notes: 'One of the better HR parks; summer heat amplifies offense',
  },
  {
    mlbVenueId: 3309,
    name: 'Nationals Park',
    teamAbbr: 'WSH',
    city: 'Washington, DC',
    lat: 38.8730, lng: -77.0074,
    surface: 'grass', roof: 'open',
    parkFactor: 99, parkFactorHR: 98, parkFactorL: 99, parkFactorR: 100,
    notes: 'Roughly neutral; RF power alley makes it slightly favorable for LHB HR',
  },
  // NL Central
  {
    mlbVenueId: 17,
    name: 'Wrigley Field',
    teamAbbr: 'CHC',
    city: 'Chicago, IL',
    lat: 41.9484, lng: -87.6553,
    surface: 'grass', roof: 'open',
    parkFactor: 102, parkFactorHR: 104, parkFactorL: 101, parkFactorR: 103,
    notes: 'Wind is the story — out-to-CF can turn it into an extreme HR park; in-from-LF suppresses offense sharply',
  },
  {
    mlbVenueId: 2602,
    name: 'Great American Ball Park',
    teamAbbr: 'CIN',
    city: 'Cincinnati, OH',
    lat: 39.0979, lng: -84.5082,
    surface: 'grass', roof: 'open',
    parkFactor: 109, parkFactorHR: 118, parkFactorL: 107, parkFactorR: 109,
    notes: 'One of the best HR parks in baseball; summer heat and compact dimensions',
  },
  {
    mlbVenueId: 32,
    name: 'American Family Field',
    teamAbbr: 'MIL',
    city: 'Milwaukee, WI',
    lat: 43.0280, lng: -87.9712,
    surface: 'grass', roof: 'retractable',
    parkFactor: 100, parkFactorHR: 101, parkFactorL: 99, parkFactorR: 100,
    notes: 'Neutral park; retractable roof limits weather impact',
  },
  {
    mlbVenueId: 2756,
    name: 'PNC Park',
    teamAbbr: 'PIT',
    city: 'Pittsburgh, PA',
    lat: 40.4469, lng: -80.0057,
    surface: 'grass', roof: 'open',
    parkFactor: 96, parkFactorHR: 93, parkFactorL: 97, parkFactorR: 95,
    notes: 'Pitcher-friendly; river air and outfield dimensions suppress power',
  },
  {
    mlbVenueId: 2889,
    name: 'Busch Stadium',
    teamAbbr: 'STL',
    city: 'St. Louis, MO',
    lat: 38.6226, lng: -90.1928,
    surface: 'grass', roof: 'open',
    parkFactor: 97, parkFactorHR: 94, parkFactorL: 97, parkFactorR: 97,
    notes: 'Pitcher-friendly; historically suppresses HR; Cardinals build for contact/defense',
  },
  // NL West
  {
    mlbVenueId: 15,
    name: 'Chase Field',
    teamAbbr: 'ARI',
    city: 'Phoenix, AZ',
    lat: 33.4453, lng: -112.0667,
    surface: 'grass', roof: 'retractable',
    parkFactor: 106, parkFactorHR: 107, parkFactorL: 105, parkFactorR: 106,
    notes: 'Desert altitude and heat boost offense; climate-controlled when roof closed',
  },
  {
    mlbVenueId: 22,
    name: 'Coors Field',
    teamAbbr: 'COL',
    city: 'Denver, CO',
    lat: 39.7559, lng: -104.9942,
    surface: 'grass', roof: 'open',
    parkFactor: 118, parkFactorHR: 122, parkFactorL: 117, parkFactorR: 119,
    notes: '5,200 ft elevation causes the ball to carry dramatically; most extreme hitter\'s park in baseball',
  },
  {
    mlbVenueId: 22,
    name: 'Dodger Stadium',
    teamAbbr: 'LAD',
    city: 'Los Angeles, CA',
    lat: 34.0739, lng: -118.2400,
    surface: 'grass', roof: 'open',
    parkFactor: 98, parkFactorHR: 97, parkFactorL: 98, parkFactorR: 98,
    notes: 'Slight pitcher\'s park; marine layer from Pacific suppresses fly balls in evening',
  },
  {
    mlbVenueId: 2395,
    name: 'Petco Park',
    teamAbbr: 'SD',
    city: 'San Diego, CA',
    lat: 32.7076, lng: -117.1570,
    surface: 'grass', roof: 'open',
    parkFactor: 91, parkFactorHR: 87, parkFactorL: 91, parkFactorR: 91,
    notes: 'One of the most pitcher-friendly parks; Pacific Ocean marine layer kills fly balls',
  },
  {
    mlbVenueId: 2395,
    name: 'Oracle Park',
    teamAbbr: 'SF',
    city: 'San Francisco, CA',
    lat: 37.7786, lng: -122.3893,
    surface: 'grass', roof: 'open',
    parkFactor: 93, parkFactorHR: 88, parkFactorL: 94, parkFactorR: 92,
    notes: 'Cold bay air and prevailing wind off McCovey Cove strongly suppresses HR',
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
