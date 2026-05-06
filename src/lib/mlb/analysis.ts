import type { BatterSplits, BatterSeasonStats, SplitLine, MLBGame, EnrichedGame, ParkData } from './types';
import type { MatchupContext } from './matchupContext';

// ---------------------------------------------------------------------------
// Matchup context — re-exported from the canonical home in matchupContext.ts
// ---------------------------------------------------------------------------

export type { MatchupContext };

/**
 * MLB Stats API `detailedState` values that mean "no matchup today" — the game
 * is on the schedule but won't generate stats. Postponed/Cancelled games still
 * appear in `/schedule` responses, so consumers must filter them explicitly or
 * the lineup optimizer will start a player whose team isn't actually playing.
 */
export function isWipedGame(status: string): boolean {
  const s = status.toLowerCase();
  return s.startsWith('postpon') || s.startsWith('cancel');
}

/**
 * Given all of the day's games and a batter's team, produce the matchup
 * context. Returns null if the team has no game today (or its only game
 * is postponed/cancelled). For doubleheaders, prefers a live game over
 * a wiped one.
 *
 * The `park` argument is for back-compat with callers that resolve the
 * park separately. When omitted, we read `game.park` from the
 * `EnrichedGame` directly. Either way the returned context's
 * `game.park` is the canonical park field — the legacy `context.park`
 * shorthand has been retired.
 */
export function resolveMatchup(
  games: EnrichedGame[],
  _park: ParkData | null,
  teamAbbr: string,
  asBatter: { hand: 'L' | 'R' | 'S' | null; battingOrder: number | null } | null = null,
): MatchupContext | null {
  const abbr = teamAbbr.toUpperCase();
  const teamGames = games.filter(
    g =>
      g.homeTeam.abbreviation.toUpperCase() === abbr ||
      g.awayTeam.abbreviation.toUpperCase() === abbr,
  );
  if (teamGames.length === 0) return null;

  const game = teamGames.find(g => !isWipedGame(g.status)) ?? null;
  if (!game) return null;

  const isHome = game.homeTeam.abbreviation.toUpperCase() === abbr;
  const opposingPitcher = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;

  return {
    game,
    isHome,
    opposingPitcher,
    asPitcher: null,
    asBatter,
  };
}

// ---------------------------------------------------------------------------
// Favorability verdicts
//
// `Verdict` is kept for the handful of signals that still surface via
// coloured labels (`getOpposingStaffPill`). The old row-pill helpers
// (`getHandednessVerdict`, `getParkVerdict`, `getPitcherQualityPill`,
// `getPitcherKRatePill`, `getStealPill`, `getCareerVsPitcherPill`) were
// removed with the category-pill row overhaul — they duplicated factors
// already counted inside `getBatterMatchupScore`. Handedness lives in the
// waterfall's Talent factor; park in the Park factor; SP quality in the
// Opposing SP + K-rate factors; career vs pitcher moved to the expanded
// card's "CONTEXT (not in rating)" section.
// ---------------------------------------------------------------------------

export type Verdict = 'strong' | 'neutral' | 'weak' | 'unknown';

// ---------------------------------------------------------------------------
// Opposing team staff quality
// ---------------------------------------------------------------------------

/**
 * Surface a pill when the opposing team's overall pitching staff is notably
 * strong or weak. This captures bullpen depth + team defense — factors
 * the SP-specific pill doesn't cover. Only fires on the extremes (~top/bottom
 * 5 teams in a typical year).
 *
 * Typical MLB team ERA range: 3.20 (elite) to 5.00+ (terrible).
 * Thresholds: ≤ 3.50 = elite staff, ≥ 4.60 = weak staff.
 */
export function getOpposingStaffPill(
  context: MatchupContext | null,
): { verdict: Verdict; label: string } | null {
  if (!context) return null;
  const { game, isHome } = context;
  const opposingTeam = isHome ? game.awayTeam : game.homeTeam;
  const era = opposingTeam.staffEra;
  if (era == null) return null;

  if (era >= 4.60) return { verdict: 'strong', label: 'Weak staff' };
  if (era <= 3.50) return { verdict: 'weak', label: 'Elite staff' };
  return null;
}

// ---------------------------------------------------------------------------
// Recent form
// ---------------------------------------------------------------------------

export type FormTrend = 'hot' | 'cold' | 'neutral' | 'unknown';

export interface FormLabel {
  trend: FormTrend;
  label: string;
  detail?: string;
}

/**
 * Assess current production level using OPS over a meaningful sample.
 *
 * Short-term "streaks" (L7/L14) are statistically non-predictive — a batter
 * hitting .400 over 7 games has no better chance of getting a hit tomorrow
 * than their season line suggests. We only surface this signal when the sample
 * is large enough (50+ PA) to reflect a genuine production-level shift, not
 * random variance.
 *
 * Source priority:
 *   1. currentSeason when ≥ 30 PA (primary — most stable available window;
 *      achievable for everyday players by ~10 games into the season)
 *   2. last30 when ≥ 50 PA (mid-season fallback when YTD is unavailable)
 *
 * Strong production:
 *   - OPS ≥ .900 (absolute — elite output regardless of baseline)
 *   - OPS ≥ baseline + .100 AND ≥ .750 (significantly above expectation)
 *
 * Poor production:
 *   - OPS ≤ .550 (absolute — severe underperformance)
 *   - OPS ≤ baseline − .100 AND ≤ .650 (significantly below expectation)
 */
export function getFormTrend(splits: BatterSplits | null): FormLabel {
  if (!splits) return { trend: 'unknown', label: '' };

  let recent: SplitLine | null = null;
  let window = '';
  if (splits.currentSeason && splits.currentSeason.plateAppearances >= 30 && splits.currentSeason.ops !== null) {
    recent = splits.currentSeason;
    window = 'YTD';
  } else if (splits.last30 && splits.last30.plateAppearances >= 50 && splits.last30.ops !== null) {
    recent = splits.last30;
    window = 'L30';
  }

  if (!recent || recent.ops === null) return { trend: 'unknown', label: '' };

  const avgStr = recent.avg !== null ? recent.avg.toFixed(3).replace(/^0\./, '.') : '—';
  const opsStr = recent.ops.toFixed(3).replace(/^0\./, '.');
  const detail = `${opsStr} OPS (${window}, ${recent.plateAppearances} PA)`;

  const baseline = splits.seasonTotals?.ops ?? null;
  const delta = baseline !== null ? recent.ops - baseline : null;

  if (recent.ops >= 0.900) {
    return { trend: 'hot', label: `Raking ${avgStr}`, detail };
  }
  if (delta !== null && delta >= 0.100 && recent.ops >= 0.750) {
    return { trend: 'hot', label: `Producing ${avgStr}`, detail };
  }

  if (recent.ops <= 0.550) {
    return { trend: 'cold', label: `Struggling ${avgStr}`, detail };
  }
  if (delta !== null && delta <= -0.100 && recent.ops <= 0.650) {
    return { trend: 'cold', label: `Scuffling ${avgStr}`, detail };
  }

  return { trend: 'neutral', label: `Steady ${avgStr}`, detail };
}

// ---------------------------------------------------------------------------
// NOTE: getStealPill + getCareerVsPitcherPill were removed with the row
// overhaul. SB lives in the category-pill module as `SB`, which is
// league-aware and matchup-aware. Career vs pitcher moved into the
// expanded card's "CONTEXT (not in rating)" section, rendered directly
// from `careerVsPitcher` — no pill abstraction needed since the number
// speaks for itself when shown inline.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Composite matchup score
//
// Weighted blend of all available signals → 0–1 where higher = better start.
// Follows the same invertNorm pattern as PitchingManager's overallScore.
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Platoon-adjusted talent
// ---------------------------------------------------------------------------

/**
 * Population-level OPS ratio of a batter's split OPS to their overall OPS
 * when facing a given hand. Sourced from The Book / FanGraphs platoon skill
 * research:
 *   - Opposite-hand batter (e.g. LHB vs RHP): ~1.04 — the standard platoon
 *     advantage all batters enjoy against opposite-handed arms.
 *   - Same-hand batter (e.g. RHB vs RHP):     ~0.96 — the corresponding
 *     disadvantage vs same-handed arms.
 *   - Switch hitters:                         ~1.00 — they turn around to
 *     face opposite-hand, so there's no sustained platoon disadvantage.
 */
const POP_OPP_HAND_RATIO = 1.04;
const POP_SAME_HAND_RATIO = 0.96;
const POP_SWITCH_RATIO = 1.00;

/**
 * Bayesian regression priors for individual platoon-skill deviation. From
 * FanGraphs' hitter platoon skill research (Mitchel Lichtman). Since most
 * pitchers are RHP, every batter sees ~3x more PAs on their dominant side
 * than their thin side, so priors are asymmetric by direction:
 *
 *   - RHB vs LHP (thin side):     ~2200 PA stabilisation — slow, heavy
 *       regression; observed splits are mostly noise until very large.
 *   - RHB vs RHP (dominant side): much faster — a full season already
 *       carries real signal, so ~700 PA prior is appropriate.
 *   - LHB vs LHP (thin side):     ~1000 PA — faster than RHB-vs-LHP
 *       because LHB's true-talent platoon spread is wider.
 *   - LHB vs RHP (dominant side): very fast — ~500 PA prior.
 *   - SHB: less studied; use a moderate prior.
 *
 * The prior pulls the observed split ratio toward the population ratio.
 * Large priors mean we trust the population more; small priors mean we
 * trust the observed data sooner.
 */
const PRIOR_RHB_VS_LHP = 2200; // thin side for RHB (documented stabilisation point)
const PRIOR_RHB_VS_RHP = 700;  // dominant side for RHB — faster stabilisation
const PRIOR_LHB_VS_LHP = 1000; // thin side for LHB (documented stabilisation point)
const PRIOR_LHB_VS_RHP = 500;  // dominant side for LHB — faster stabilisation
const PRIOR_SHB = 500;

export interface PlatoonTalent {
  /** Regressed split/overall OPS ratio — acts as a multiplier on ANY
   *  per-PA rate for this matchup. 1.0 = neutral platoon (no tilt). */
  multiplier: number;
  /** Observed OPS in the split, or null when unavailable. */
  observedOPS: number | null;
  /** Observed PA in the split (0 when unknown). */
  observedPA: number;
  /** Hand the batter is facing today (null when pitcher unknown / switch). */
  facingHand: 'L' | 'R' | null;
}

/**
 * Compute a regressed platoon multiplier for a batter. Uses observed
 * split OPS relative to the player's overall OPS, regressed toward
 * population platoon norms with handedness-appropriate priors.
 *
 * Returned as a multiplier (centered on 1.0) rather than a projected
 * xwOBA — callers apply it as a single matchup-wide adjustment on top
 * of category rates so platoon and overall talent stay decoupled.
 */
export function getPlatoonAdjustedTalent(
  stats: BatterSeasonStats | null,
  pitcherThrows: 'L' | 'R' | 'S' | undefined,
): PlatoonTalent {
  if (!stats || !pitcherThrows || pitcherThrows === 'S') {
    return {
      multiplier: 1.0,
      observedOPS: null,
      observedPA: 0,
      facingHand: null,
    };
  }

  const facingHand: 'L' | 'R' = pitcherThrows === 'L' ? 'L' : 'R';
  const observedOPS = facingHand === 'L' ? stats.opsVsL : stats.opsVsR;
  const observedPA = facingHand === 'L' ? stats.paVsL : stats.paVsR;
  const overallOPS = stats.ops;

  // Decide the population ratio for this matchup.
  let popRatio: number;
  if (stats.bats === 'S') {
    popRatio = POP_SWITCH_RATIO;
  } else if (stats.bats === facingHand) {
    popRatio = POP_SAME_HAND_RATIO;
  } else if (stats.bats === 'L' || stats.bats === 'R') {
    popRatio = POP_OPP_HAND_RATIO;
  } else {
    popRatio = 1.0; // unknown handedness
  }

  // Prior weight (PA) for regression — asymmetric by dominant vs thin side.
  const prior =
    stats.bats === 'S' ? PRIOR_SHB :
    stats.bats === 'R' ? (facingHand === 'L' ? PRIOR_RHB_VS_LHP : PRIOR_RHB_VS_RHP) :
    stats.bats === 'L' ? (facingHand === 'L' ? PRIOR_LHB_VS_LHP : PRIOR_LHB_VS_RHP) :
    PRIOR_RHB_VS_RHP; // default: unknown handedness — use RHB-vs-RHP as modal matchup

  // Observed ratio — only computable with a real sample and a baseline OPS.
  let observedRatio: number | null = null;
  if (observedOPS != null && overallOPS != null && overallOPS > 0 && observedPA > 0) {
    observedRatio = observedOPS / overallOPS;
  }

  const regressedRatio = observedRatio != null
    ? (observedPA * observedRatio + prior * popRatio) / (observedPA + prior)
    : popRatio;

  return {
    multiplier: regressedRatio,
    observedOPS,
    observedPA,
    facingHand,
  };
}

// ---------------------------------------------------------------------------
// REMOVED: getBatterMatchupScore / getBatterContextScore
//
// Replaced by `getBatterRating` in `src/lib/mlb/batterRating.ts`, which
// computes a per-category expected-rate composite (weighted by user
// chase/punt focus) instead of a fixed six-factor xwOBA-based score.
// The old six-factor model systematically under-rated contact hitters
// (Clement, Arraez archetypes) because it leaned on xwOBA — a metric
// that weighs extra bases heavily and understates singles-driven
// production. The new rating is structured around whatever categories
// the user's league actually scores.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Weather scoring + notability
// ---------------------------------------------------------------------------

/**
 * Compute a continuous 0–1 weather score for the composite matchup model.
 *
 * Combines wind and temperature effects with magnitude scaling:
 * - Wind out: scaled linearly from 10→25 mph (0.6→1.0)
 * - Wind in:  scaled linearly from 10→25 mph (0.4→0.0)
 * - Temp ≥ 80°F: slight boost, scaling up to 0.7 at 100°F
 * - Temp ≤ 55°F: slight suppression, scaling down to 0.3 at 35°F
 * - Dome with no weather data: 0.5 (neutral)
 *
 * Wind dominates when both wind and temperature are extreme because the
 * wind effect is larger and more researched.
 */
export function getWeatherScore(game: MLBGame, park: ParkData | null): number {
  if (park && (park.roof === 'dome' || park.roof === 'retractable')) {
    if (!game.weather.wind && !game.weather.temperature) {
      return 0.5; // controlled environment
    }
  }

  const { temperature, windSpeed, windDirection } = game.weather;
  let score = 0.5;

  // Wind effect (overrides temperature when present — larger effect size)
  if (windSpeed !== null && windSpeed >= 10 && windDirection) {
    const dir = windDirection.toLowerCase();
    if (dir.includes('out')) {
      // 10 mph out → 0.6, 25 mph out → 1.0
      score = clamp01(0.5 + (windSpeed - 5) / 40);
    } else if (dir.includes('in')) {
      // 10 mph in → 0.4, 25 mph in → 0.0
      score = clamp01(0.5 - (windSpeed - 5) / 40);
    }
    // Crosswinds: stay at 0.5 (ambiguous effect)
  }

  // Temperature effect — additive nudge on top of wind
  if (temperature !== null) {
    if (temperature >= 80) {
      // 80°F → +0.02, 100°F → +0.10
      score += clamp01((temperature - 80) / 200) * 0.5;
    } else if (temperature <= 55) {
      // 55°F → −0.02, 35°F → −0.10
      score -= clamp01((55 - temperature) / 200) * 0.5;
    }
  }

  return clamp01(score);
}

export interface WeatherFlag {
  kind: 'boost' | 'suppress' | 'neutral' | 'none';
  label: string;
}

export function getWeatherFlag(game: MLBGame, park: ParkData | null): WeatherFlag {
  if (park && (park.roof === 'dome' || park.roof === 'retractable')) {
    if (!game.weather.wind && !game.weather.temperature) {
      return { kind: 'neutral', label: 'Dome' };
    }
  }

  const { temperature, windSpeed, windDirection } = game.weather;

  if (windSpeed !== null && windSpeed >= 10 && windDirection) {
    const dir = windDirection.toLowerCase();
    if (dir.includes('out')) {
      return { kind: 'boost', label: `${windSpeed}mph out` };
    }
    if (dir.includes('in')) {
      return { kind: 'suppress', label: `${windSpeed}mph in` };
    }
  }

  if (temperature !== null) {
    if (temperature >= 90) return { kind: 'boost', label: `${temperature}°F hot` };
    if (temperature <= 50) return { kind: 'suppress', label: `${temperature}°F cold` };
  }

  return { kind: 'none', label: '' };
}
