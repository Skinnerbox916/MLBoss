import type { BatterSplits, SplitLine, MLBGame, EnrichedGame, ParkData } from './types';
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
