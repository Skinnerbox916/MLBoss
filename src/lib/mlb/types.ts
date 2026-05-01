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
  hr9: number | null;             // HR/9 = homeRuns / IP * 9 (HR-prone detection)
  battingAvgAgainst: number | null; // BAA = hits / atBats (log5 vs hitter AVG)
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
  // --- Savant pitch-arsenal signals -----------------------------------------
  /**
   * Usage-weighted mean fastball velocity (FF/SI/FC) for the CURRENT season.
   * Null when the pitcher has no tracked fastball usage yet. Used for the
   * velocity-trend signal (compared against `avgFastballVeloPrior`).
   */
  avgFastballVelo: number | null;
  /**
   * Usage-weighted mean fastball velocity for the PRIOR season — exposed so
   * the UI / scoring module can compute year-over-year deltas. Null when
   * the pitcher is a rookie or wasn't tracked.
   */
  avgFastballVeloPrior: number | null;
  /**
   * Run value per 100 pitches, usage-weighted across the whole arsenal.
   * Savant reports this from the pitcher perspective: LOWER is better.
   * Blended current + prior + league anchor (`blendRateOrNull` with a
   * 150-PA league prior at 0). Used as a pitch-model proxy inside
   * `getPitcherRating`.
   */
  runValuePer100: number | null;
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
  gamesPlayed: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  stolenBases: number;
  strikeouts: number;
  walks: number;
  atBats: number;
  hits: number;
  plateAppearances: number;
  /** Total bases (1B + 2×2B + 3×3B + 4×HR). Derived from the raw stat
   *  line so it's available everywhere SplitLine is, including in
   *  league configs that score TB. */
  totalBases: number;
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
  /** Games played in the current season. Combined with the league-wide
   *  full-time GP pace, drives the playing-time factor and its IL-stint
   *  detection (a big drop from prior-year role → infer missed block). */
  gp: number;
  runs: number;
  hits: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  /** Total bases — needed for leagues that score TB. */
  totalBases: number;
  season: number;
  /** Regressed "true talent" xwOBA from the component model
   *  (K% + BB% + xwOBACON, each independently regressed). Drives the
   *  platoon talent factor. Null only when we have no Statcast data
   *  for this player (rookie pre-debut, data blip, etc.). */
  xwoba: number | null;
  /** Actual wOBA for luck-delta computation */
  woba: number | null;
  /** Effective sample size behind `xwoba` (current + capped prior PA).
   *  Used by the UI to surface a "(regressed)" cue when a rating is
   *  mostly driven by league-mean priors. Zero when xwoba is null. */
  xwobaEffectivePA: number;
  /** Raw current-season xwOBA (Savant expected_statistics, no regression).
   *  Used by the roster Quality bonus to give current hot streaks credit
   *  the strict Bayesian talent model would smooth away. Null when the
   *  player isn't on the current-year leaderboard. */
  xwobaCurrent: number | null;
  /** Current-season Statcast BIP — sample-size gate for the Quality bonus
   *  and the Rising delta. */
  xwobaCurrentBip: number;
  /** Regressed prior-only talent xwOBA (component model run on prior-year
   *  data alone). Used as the "before" reference for the Rising bonus —
   *  current xwOBA above this by ~20 pts of wOBA → genuine improvement. */
  xwobaTalentPrior: number | null;
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
  /** Prior-season counting line (always populated when available, regardless
   *  of whether the primary `line` fell back to prior-year). Used by the
   *  category-pill Bayesian blend to anchor per-PA rates in April. */
  priorSeason: PriorSeasonLine | null;
}

/**
 * Raw prior-season counting stats + derived AVG, used to anchor per-PA
 * category rates (HR/PA, SB/PA, R/PA, RBI/PA, etc.) against a stable
 * prior sample before the current season stabilises.
 */
export interface PriorSeasonLine {
  season: number;
  pa: number;
  /** Games played in the prior season. Anchors "was this a regular?" for
   *  the playing-time factor's IL-stint heuristic. */
  gp: number;
  hr: number;
  sb: number;
  runs: number;
  rbi: number;
  hits: number;
  walks: number;
  strikeouts: number;
  /** Prior-season total bases — anchors the TB/PA Bayesian blend. */
  totalBases: number;
  avg: number | null;
}

// ---------------------------------------------------------------------------
// PlayerStatLine — stratified canonical shape
// ---------------------------------------------------------------------------
//
// Replaces the "flat bag" `BatterSeasonStats` shape with a self-describing
// structure that separates the four stat levels:
//
//   raw counting (current/prior)  →  what the player actually did
//   regressed talent              →  what the player can be expected to do
//   raw Statcast                  →  unregressed quality-of-contact signal
//   platoon splits                →  vs-L / vs-R rates with PA gates applied
//
// Consumers that just want to display "this player's HR" read from
// `line.current?.hr`. Consumers that want talent-level scoring read from
// `line.talent?.xwoba`. The two are different concepts and naming them
// distinctly is the structural fix that lets us add new modeling without
// breaking unrelated UI.
//
// Use `toBatterSeasonStats(line)` to interop with code still on the legacy
// flat shape during migration. The adapter is deleted once Phase 4 ships
// and all consumers read from `PlayerStatLine` directly.

/**
 * Raw counting + rate stats for one season. Mirrors the relevant subset
 * of MLB Stats API season-totals — no regression, no league-mean blending.
 */
export interface PlayerSeasonCounting {
  /** Year these counting stats came from. */
  season: number;
  pa: number;
  gp: number;
  hr: number;
  sb: number;
  runs: number;
  rbi: number;
  hits: number;
  walks: number;
  strikeouts: number;
  totalBases: number;
  avg: number | null;
  ops: number | null;
}

/**
 * Component talent model output: regressed xwOBA + components + the
 * effective sample size driving it. This is the "true talent" signal that
 * roster decisions should key off, not raw current-year xwOBA.
 */
export interface PlayerTalent {
  /** Regressed talent xwOBA (recomposed from K/BB/xwOBACON). */
  xwoba: number;
  /** Effective PA backing the talent estimate (current + capped prior). */
  effectivePA: number;
  /** Prior-only talent xwOBA. Used by the Rising bonus to detect
   *  in-season skill jumps when current xwOBA materially exceeds it. */
  xwobaTalentPrior: number | null;
  /** Actual wOBA blended current + prior (UI-only luck-delta signal). */
  woba: number | null;
}

/**
 * Raw current-season Statcast snapshot — explicitly NOT regressed. Used by
 * the roster Quality bonus so a hot start with quality contact gets credit
 * the strict Bayesian talent model would smooth away.
 */
export interface PlayerStatcastSnapshot {
  /** Current-year raw xwOBA from the Savant leaderboard (no regression). */
  xwobaCurrent: number | null;
  /** Current-year BIP — sample-size gate for the Quality bonus and the
   *  Rising delta. */
  xwobaCurrentBip: number;
}

/**
 * Per-hand platoon line. PA values are 0 when no sample is available; OPS
 * may be a current-year value, a prior-year value rescaled to current-year
 * talent, or null. The compose layer is responsible for the rescale logic.
 */
export interface PlayerPlatoonSplits {
  opsVsL: number | null;
  paVsL: number;
  opsVsR: number | null;
  paVsR: number;
}

/**
 * Stratified canonical stat line for a single player. Each block is
 * independently nullable: a freshly-called-up rookie has `current` only,
 * an IL'd vet has `prior` only, and so on.
 *
 * Consumers should treat each block as the unit of trust:
 *   - displaying counting stats: use `current` (or fall back to `prior`)
 *   - scoring talent: use `talent`
 *   - quality bonus: use `statcast`
 *   - platoon decisions: use `splits`
 */
export interface PlayerStatLine {
  identity: { mlbId: number; bats: 'L' | 'R' | 'S' | null };
  current: PlayerSeasonCounting | null;
  prior: PlayerSeasonCounting | null;
  talent: PlayerTalent | null;
  statcast: PlayerStatcastSnapshot | null;
  splits: PlayerPlatoonSplits | null;
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
  /** Strikeout rate (K / PA) — fastest-stabilising pitcher rate. Null when
   * the skills leaderboard hasn't merged yet. */
  kRate: number | null;
  /** Walk rate (BB / PA) — second-fastest-stabilising pitcher rate. */
  bbRate: number | null;
  /** xwOBA on contact (xwOBACON) — true contact-quality signal. */
  xwobacon: number | null;
  /** Hard-hit rate (EV ≥ 95 mph / BIP) — proxy for bat-speed suppression. */
  hardHitRate: number | null;
  /**
   * Usage-weighted mean fastball velocity across FF/SI/FC. Null when the
   * pitch-arsenal endpoint didn't return tracked fastball data (no pitches
   * yet this season, or the leaderboard failed). Sourced from Savant's
   * pitch-arsenals CSV (avg_speed pivot).
   */
  avgFastballVelo: number | null;
  /**
   * Run value per 100 pitches, usage-weighted across the entire arsenal.
   * Pitcher perspective: lower is better. Sourced from Savant's
   * pitch-arsenal-stats CSV. Used as an outcome-based pitch-model proxy.
   */
  runValuePer100: number | null;
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
  /** Strikeout rate (K / PA) — stabilises ~60 PA, fastest batter skill signal. */
  kRate: number | null;
  /** Walk rate (BB / PA) — stabilises ~120 PA. */
  bbRate: number | null;
  /** xwOBA on contact (xwOBACON) — quality-of-contact; stabilises ~50 BIP. */
  xwobacon: number | null;
  /** Hard-hit rate (EV ≥ 95 mph / BIP) — bat-speed fingerprint; stabilises ~50 BIP. */
  hardHitRate: number | null;
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
