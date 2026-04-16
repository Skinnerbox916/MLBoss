// ---------------------------------------------------------------------------
// MLB Stats API — type definitions
// All data sourced from statsapi.mlb.com (free, no auth required)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Schedule / Game Day
// ---------------------------------------------------------------------------

export type PitcherTier = 'ace' | 'tough' | 'average' | 'weak' | 'bad' | 'unknown';

/**
 * Tiered pitcher quality snapshot used to surface matchup difficulty.
 * `season` is the year the underlying stats came from — may be prior year
 * when the current season sample is too small (see getPitcherQuality).
 */
export interface PitcherQuality {
  tier: PitcherTier;
  era: number | null;
  whip: number | null;
  inningsPitched: number;
  season: number;
}

export interface ProbablePitcher {
  mlbId: number;
  name: string;
  throws: 'L' | 'R' | 'S'; // handedness
  era: number | null;
  whip: number | null;
  wins: number;
  losses: number;
  // Extended stats (parsed from season pitching line)
  strikeoutsPer9: number | null;  // K/9
  strikeOuts: number | null;
  gamesStarted: number | null;
  pitchesPerInning: number | null;
  inningsPerStart: number | null; // derived: IP / GS
  bb9: number | null;             // BB/9 = baseOnBalls / IP * 9
  gbRate: number | null;          // groundOuts / (groundOuts + airOuts)
  // Recent form
  eraLast30: number | null;
  recentFormEra: number | null;   // ERA over last 3 starts
  inningsPitched: number;
  // Platoon splits (OPS allowed to batters of each handedness)
  platoonOpsVsLeft: number | null;
  platoonOpsVsRight: number | null;
  // Tiered quality (null until enriched by getGameDay)
  quality: PitcherQuality | null;
  /** xERA from Baseball Savant (null when pitcher has too few BIP for Savant to compute) */
  xera: number | null;
  /** xwOBA-against from Baseball Savant (expected wOBA allowed to batters) */
  xwoba: number | null;
}

export interface GameWeather {
  temperature: number | null;   // °F
  condition: string | null;     // 'Sunny', 'Cloudy', 'Overcast', etc.
  wind: string | null;          // e.g. '12 mph, Out To CF' — raw MLB string
  windSpeed: number | null;     // mph parsed out
  windDirection: string | null; // 'Out to CF', 'In from LF', 'L to R', etc.
}

export interface GameVenue {
  mlbId: number;
  name: string;
}

export interface LineupEntry {
  mlbId: number;
  fullName: string;
  battingOrder: number;         // 1-indexed position in the batting order
  position: string;             // e.g. 'SS', 'CF', 'DH'
}

export interface MLBGame {
  gamePk: number;
  gameDate: string;             // ISO datetime
  status: string;               // 'Scheduled', 'In Progress', 'Final', etc.
  homeTeam: {
    mlbId: number;
    name: string;
    abbreviation: string;
    staffEra?: number;
  };
  awayTeam: {
    mlbId: number;
    name: string;
    abbreviation: string;
    staffEra?: number;
  };
  venue: GameVenue;
  weather: GameWeather;
  homeProbablePitcher: ProbablePitcher | null;
  awayProbablePitcher: ProbablePitcher | null;
  homeLineup: LineupEntry[];
  awayLineup: LineupEntry[];
}

// ---------------------------------------------------------------------------
// Player splits
// ---------------------------------------------------------------------------

export interface SplitLine {
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  homeRuns: number;
  runs: number;
  rbi: number;
  stolenBases: number;
  strikeouts: number;
  walks: number;
  atBats: number;
  hits: number;
  plateAppearances: number;
}

export type SplitRating = 'strong' | 'average' | 'weak' | 'unknown';

export interface BatterSplits {
  mlbId: number;
  name: string;
  /** Year the comparison splits come from — may be prior year via fallback */
  season: number;
  // Pitcher handedness
  vsLeft: SplitLine | null;
  vsRight: SplitLine | null;
  // Venue
  home: SplitLine | null;
  away: SplitLine | null;
  // Time of day
  day: SplitLine | null;
  night: SplitLine | null;
  // Recent form (lastXGames endpoint; unreliable in early season — see players.ts)
  last7: SplitLine | null;
  last14: SplitLine | null;
  last30: SplitLine | null;
  // Monthly (keyed by month number 1–12)
  monthly: Partial<Record<number, SplitLine>>;
  /** Baseline totals used for relative verdicts (may be prior year via fallback) */
  seasonTotals: SplitLine | null;
  /** Current calendar year totals — always the real 2026 line, even when splits fall back */
  currentSeason: SplitLine | null;
}

// ---------------------------------------------------------------------------
// Player identity (Yahoo → MLB ID bridge)
// ---------------------------------------------------------------------------

export interface MLBPlayerIdentity {
  mlbId: number;
  fullName: string;
  currentTeamAbbr: string;
  bats: 'L' | 'R' | 'S';
  throws: 'L' | 'R' | 'S';
  primaryPosition: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Lightweight season stats (for roster-level talent baseline)
// ---------------------------------------------------------------------------

export interface BatterSeasonStats {
  mlbId: number;
  ops: number | null;
  avg: number | null;
  hr: number;
  sb: number;
  pa: number;
  runs: number;
  hits: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  season: number;
  /** xwOBA from Baseball Savant (expected wOBA based on batted ball quality) */
  xwoba: number | null;
  /** Actual wOBA for luck-delta computation */
  woba: number | null;
  /** Batter handedness — drives platoon regression priors. */
  bats: 'L' | 'R' | 'S' | null;
  /** Observed OPS vs LHP (null when no sample). */
  opsVsL: number | null;
  /** Plate appearances vs LHP (0 when unknown). */
  paVsL: number;
  /** Observed OPS vs RHP (null when no sample). */
  opsVsR: number | null;
  /** Plate appearances vs RHP (0 when unknown). */
  paVsR: number;
}

// ---------------------------------------------------------------------------
// Statcast data from Baseball Savant leaderboards
// ---------------------------------------------------------------------------

/**
 * Aggregated season Statcast metrics for a pitcher, sourced from the Baseball
 * Savant expected_statistics leaderboard (unofficial endpoint, cached 24 h).
 *
 * xERA is the single most valuable field: it strips out luck and team defense
 * from ERA, stabilising much faster (~50 BIP vs ~200 IP for ERA stabilisation).
 */
export interface StatcastPitcher {
  mlbId: number;
  /** Expected ERA based on batted-ball quality against */
  xera: number | null;
  /** Expected wOBA against */
  xwoba: number | null;
  /** Actual ERA (kept for delta / reference) */
  era: number | null;
  /** Actual wOBA against */
  woba: number | null;
  /** Plate appearances faced — sample size gate */
  pa: number;
  /** Balls in play — Savant's own sample gate */
  bip: number;
}

/**
 * Aggregated season Statcast metrics for a batter, sourced from the Baseball
 * Savant expected_statistics leaderboard (unofficial endpoint, cached 24 h).
 *
 * xwOBA is the best single talent-baseline metric: it measures quality of
 * contact independent of luck on balls in play.
 */
export interface StatcastBatter {
  mlbId: number;
  /** Expected batting average */
  xba: number | null;
  /** Expected slugging */
  xslg: number | null;
  /** Expected wOBA — preferred talent baseline over raw OPS */
  xwoba: number | null;
  /** Actual wOBA (used to compute luck delta) */
  woba: number | null;
  /** Plate appearances */
  pa: number;
  /** Balls in play */
  bip: number;
}

// ---------------------------------------------------------------------------
// Park data (static)
// ---------------------------------------------------------------------------

export type ParkTendency = 'extreme-hitter' | 'hitter' | 'neutral' | 'pitcher' | 'extreme-pitcher';
export type SurfaceType = 'grass' | 'turf';
export type RoofType = 'open' | 'retractable' | 'dome';

export interface ParkData {
  mlbVenueId: number;
  name: string;
  teamAbbr: string;
  city: string;
  lat: number;
  lng: number;
  surface: SurfaceType;
  roof: RoofType;
  // 2024 park factors (100 = league average; FanGraphs wRC+ scale)
  parkFactor: number;        // overall
  parkFactorHR: number;      // HR-specific
  parkFactorL: number;       // vs left-handed batters
  parkFactorR: number;       // vs right-handed batters
  tendency: ParkTendency;
  notes: string;             // e.g. 'Thin air boosts all offense', 'Short RF porch favors LHB'
}
