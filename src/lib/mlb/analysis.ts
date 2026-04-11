import type { BatterSplits, SplitLine, MLBGame, ParkData, ProbablePitcher } from './types';

// ---------------------------------------------------------------------------
// Matchup context for a single batter
// ---------------------------------------------------------------------------

export interface MatchupContext {
  game: MLBGame;
  isHome: boolean;
  opposingPitcher: MLBGame['homeProbablePitcher']; // nullable
  park: ParkData | null;
}

/**
 * Given all of the day's games and a batter's team, produce the matchup context.
 * Returns null if the team has no game today.
 */
export function resolveMatchup(
  games: MLBGame[],
  park: ParkData | null,
  teamAbbr: string,
): MatchupContext | null {
  const abbr = teamAbbr.toUpperCase();
  const game = games.find(
    g =>
      g.homeTeam.abbreviation.toUpperCase() === abbr ||
      g.awayTeam.abbreviation.toUpperCase() === abbr,
  );
  if (!game) return null;

  const isHome = game.homeTeam.abbreviation.toUpperCase() === abbr;
  const opposingPitcher = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;

  return { game, isHome, opposingPitcher, park };
}

// ---------------------------------------------------------------------------
// Favorability verdicts
// ---------------------------------------------------------------------------

export type Verdict = 'strong' | 'neutral' | 'weak' | 'unknown';

export interface VerdictLabel {
  verdict: Verdict;
  label: string;
  detail?: string;
}

/**
 * Compare a split line to season totals. Uses OPS delta as the primary signal.
 * Returns 'strong' if split OPS is ≥ .050 above season, 'weak' if ≥ .050 below.
 */
function compareToSeason(split: SplitLine | null, season: SplitLine | null): Verdict {
  if (!split || !season || split.ops === null || season.ops === null) return 'unknown';
  // Need enough PA for the split to be meaningful
  if (split.plateAppearances < 20) return 'unknown';

  const delta = split.ops - season.ops;
  if (delta >= 0.05) return 'strong';
  if (delta <= -0.05) return 'weak';
  return 'neutral';
}

/**
 * Pick the batter's split line relevant to the current matchup's pitcher handedness.
 */
export function getHandednessSplit(
  splits: BatterSplits | null,
  pitcherThrows: 'L' | 'R' | 'S' | undefined,
): { split: SplitLine | null; label: string } {
  if (!splits || !pitcherThrows) return { split: null, label: '' };
  if (pitcherThrows === 'L') return { split: splits.vsLeft, label: 'vs LHP' };
  return { split: splits.vsRight, label: 'vs RHP' };
}

/**
 * Compute a verdict for the handedness matchup.
 */
export function getHandednessVerdict(
  splits: BatterSplits | null,
  pitcherThrows: 'L' | 'R' | 'S' | undefined,
): VerdictLabel {
  const { split, label } = getHandednessSplit(splits, pitcherThrows);
  if (!splits || !split) return { verdict: 'unknown', label: '' };
  const verdict = compareToSeason(split, splits.seasonTotals);

  const ops = split.ops !== null ? split.ops.toFixed(3).replace(/^0\./, '.') : '—';
  const detail = `${label}: ${ops} OPS`;

  if (verdict === 'strong') return { verdict, label: `Crushes ${pitcherThrows === 'L' ? 'L' : 'R'}`, detail };
  if (verdict === 'weak') return { verdict, label: `Weak vs ${pitcherThrows === 'L' ? 'L' : 'R'}`, detail };
  if (verdict === 'neutral') return { verdict, label: `Neutral vs ${pitcherThrows === 'L' ? 'L' : 'R'}`, detail };
  return { verdict: 'unknown', label: '' };
}

/**
 * Compute a verdict for home/away relative to season totals.
 */
export function getVenueVerdict(
  splits: BatterSplits | null,
  isHome: boolean,
): VerdictLabel {
  if (!splits) return { verdict: 'unknown', label: '' };
  const split = isHome ? splits.home : splits.away;
  const verdict = compareToSeason(split, splits.seasonTotals);
  if (verdict === 'unknown' || verdict === 'neutral') return { verdict, label: '' };

  const ops = split?.ops !== null && split?.ops !== undefined ? split.ops.toFixed(3).replace(/^0\./, '.') : '—';
  const label = isHome
    ? (verdict === 'strong' ? 'Home hitter' : 'Weak at home')
    : (verdict === 'strong' ? 'Road warrior' : 'Weak on road');
  return { verdict, label, detail: `${ops} OPS` };
}

/**
 * Determine whether a game is a day or night game from its start time.
 * MLB API gameDate is UTC; we treat games starting before 5 PM local ET
 * (≈ 21:00 UTC) as day games. This is a coarse heuristic — good enough
 * for pill display.
 */
function isDayGame(gameDateIso: string): boolean {
  const d = new Date(gameDateIso);
  return d.getUTCHours() < 21;
}

/**
 * Compute a verdict for day/night relative to season totals.
 */
export function getDayNightVerdict(
  splits: BatterSplits | null,
  gameDateIso: string,
): VerdictLabel {
  if (!splits) return { verdict: 'unknown', label: '' };
  const dayGame = isDayGame(gameDateIso);
  const split = dayGame ? splits.day : splits.night;
  const verdict = compareToSeason(split, splits.seasonTotals);
  if (verdict === 'unknown' || verdict === 'neutral') return { verdict, label: '' };

  const ops = split?.ops !== null && split?.ops !== undefined ? split.ops.toFixed(3).replace(/^0\./, '.') : '—';
  const label = dayGame
    ? (verdict === 'strong' ? 'Day hitter' : 'Weak in day')
    : (verdict === 'strong' ? 'Night owl' : 'Weak at night');
  return { verdict, label, detail: `${ops} OPS` };
}

// ---------------------------------------------------------------------------
// Pitcher quality pill
// ---------------------------------------------------------------------------

/**
 * Translate a probable pitcher's tier into a display pill for the batter's row.
 *
 * - ace:     red   (weak for the batter — facing a shutdown arm)
 * - tough:   muted neutral (informational — above-average SP)
 * - bad:     green (strong for the batter)
 * - weak:    green (strong for the batter, slightly less emphatic than bad)
 * - average: no pill
 * - unknown: no pill
 *
 * Returns null when the pitcher is absent, unclassified, or average.
 */
export function getPitcherQualityPill(
  pitcher: ProbablePitcher | null | undefined,
): { verdict: Verdict; label: string } | null {
  const q = pitcher?.quality;
  if (!q || q.tier === 'unknown' || q.tier === 'average') return null;

  switch (q.tier) {
    case 'ace':
      return { verdict: 'weak', label: 'Facing Ace' };
    case 'tough':
      return { verdict: 'neutral', label: 'Tough SP' };
    case 'weak':
      return { verdict: 'strong', label: 'Weak SP' };
    case 'bad':
      return { verdict: 'strong', label: 'Bad SP' };
  }
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
 * Compute recent form using OPS, with the actual AVG baked into the label
 * so the severity is visible at a glance (e.g. "Slumping .151" rather than
 * just "Cold").
 *
 * Source priority:
 *   1. currentSeason when ≥ 15 PA — in early April this IS the recent form,
 *      and the MLB Stats API's lastXGames endpoint silently ignores the
 *      numberOfGames parameter anyway, so it's effectively the same data.
 *   2. last14 when ≥ 15 PA (mid-season fallback)
 *   3. last7 when ≥ 10 PA
 *
 * Baseline for the relative thresholds is splits.seasonTotals (which may be
 * the prior season via the early-season fallback in getBatterSplits). Absolute
 * OPS thresholds always apply regardless of baseline.
 *
 * Hot:
 *   - OPS ≥ .900 (absolute raking), or
 *   - OPS ≥ baseline + .100 AND ≥ .750 (meaningful jump and still solid)
 *
 * Cold:
 *   - OPS ≤ .550 (absolute slump), or
 *   - OPS ≤ baseline − .100 AND ≤ .650 (meaningful drop and still poor)
 */
export function getFormTrend(splits: BatterSplits | null): FormLabel {
  if (!splits) return { trend: 'unknown', label: '' };

  // Pick the best available recent window
  let recent: SplitLine | null = null;
  let window = '';
  if (splits.currentSeason && splits.currentSeason.plateAppearances >= 15 && splits.currentSeason.ops !== null) {
    recent = splits.currentSeason;
    window = 'YTD';
  } else if (splits.last14 && splits.last14.plateAppearances >= 15 && splits.last14.ops !== null) {
    recent = splits.last14;
    window = 'L14';
  } else if (splits.last7 && splits.last7.plateAppearances >= 10 && splits.last7.ops !== null) {
    recent = splits.last7;
    window = 'L7';
  }

  if (!recent || recent.ops === null) return { trend: 'unknown', label: '' };

  // Format AVG for the label ("Slumping .151"), OPS for the tooltip detail.
  const avgStr = recent.avg !== null ? recent.avg.toFixed(3).replace(/^0\./, '.') : '—';
  const opsStr = recent.ops.toFixed(3).replace(/^0\./, '.');
  const detail = `${opsStr} OPS (${window}, ${recent.plateAppearances} PA)`;

  const baseline = splits.seasonTotals?.ops ?? null;
  const delta = baseline !== null ? recent.ops - baseline : null;

  // Hot signals
  if (recent.ops >= 0.900) {
    return { trend: 'hot', label: `Raking ${avgStr}`, detail };
  }
  if (delta !== null && delta >= 0.100 && recent.ops >= 0.750) {
    return { trend: 'hot', label: `Hot ${avgStr}`, detail };
  }

  // Cold signals
  if (recent.ops <= 0.550) {
    return { trend: 'cold', label: `Slumping ${avgStr}`, detail };
  }
  if (delta !== null && delta <= -0.100 && recent.ops <= 0.650) {
    return { trend: 'cold', label: `Cold ${avgStr}`, detail };
  }

  return { trend: 'neutral', label: '', detail };
}

// ---------------------------------------------------------------------------
// Weather notability
// ---------------------------------------------------------------------------

export interface WeatherFlag {
  kind: 'boost' | 'suppress' | 'neutral' | 'none';
  label: string;
}

export function getWeatherFlag(game: MLBGame, park: ParkData | null): WeatherFlag {
  // Dome/retractable when closed — weather is neutralized
  if (park && (park.roof === 'dome' || park.roof === 'retractable')) {
    if (!game.weather.wind && !game.weather.temperature) {
      return { kind: 'neutral', label: 'Dome' };
    }
  }

  const { temperature, windSpeed, windDirection } = game.weather;

  // Wind is the biggest factor
  if (windSpeed !== null && windSpeed >= 10 && windDirection) {
    const dir = windDirection.toLowerCase();
    if (dir.includes('out')) {
      return { kind: 'boost', label: `${windSpeed}mph out` };
    }
    if (dir.includes('in')) {
      return { kind: 'suppress', label: `${windSpeed}mph in` };
    }
  }

  // Temperature extremes
  if (temperature !== null) {
    if (temperature >= 85) return { kind: 'boost', label: `${temperature}°F hot` };
    if (temperature <= 55) return { kind: 'suppress', label: `${temperature}°F cold` };
  }

  return { kind: 'none', label: '' };
}
