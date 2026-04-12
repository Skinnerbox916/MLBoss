import type { BatterSplits, SplitLine, MLBGame, ParkData, ProbablePitcher } from './types';

// ---------------------------------------------------------------------------
// Park verdict thresholds
//
// Use the handedness-split park factor when the batter's side is known
// (parkFactorL / parkFactorR), falling back to overall for switch hitters.
// Only surface truly extreme parks — 108+ / 92- catches Coors and handedness
// outliers like Fenway for LHB, T-Mobile for RHB. Anything less is noise.
// ---------------------------------------------------------------------------

const PARK_EXTREME_HITTER = 108;
const PARK_EXTREME_PITCHER = 92;

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
function compareToSeason(split: SplitLine | null, season: SplitLine | null, minPA: number): Verdict {
  if (!split || !season || split.ops === null || season.ops === null) return 'unknown';
  if (split.plateAppearances < minPA) return 'unknown';

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
 *
 * Requires 30+ PA in the split — a pragmatic floor that's achievable by
 * mid-April for everyday players while still filtering the worst noise.
 * The population-level platoon advantage is real; 30 PA gives enough signal
 * to surface strong individual tendencies.
 */
export function getHandednessVerdict(
  splits: BatterSplits | null,
  pitcherThrows: 'L' | 'R' | 'S' | undefined,
): VerdictLabel {
  const { split, label } = getHandednessSplit(splits, pitcherThrows);
  if (!splits || !split) return { verdict: 'unknown', label: '' };
  const verdict = compareToSeason(split, splits.seasonTotals, 30);

  const ops = split.ops !== null ? split.ops.toFixed(3).replace(/^0\./, '.') : '—';
  const detail = `${label}: ${ops} OPS`;

  if (verdict === 'strong') return { verdict, label: `Crushes ${pitcherThrows === 'L' ? 'L' : 'R'}`, detail };
  if (verdict === 'weak') return { verdict, label: `Weak vs ${pitcherThrows === 'L' ? 'L' : 'R'}`, detail };
  return { verdict: 'unknown', label: '' };
}

/**
 * Determine whether a game is a day or night game from its start time.
 *
 * MLB API gameDate is UTC. During the baseball season (EDT, UTC-4), day
 * games typically start between ~1 PM ET (17:00 UTC) and ~4 PM ET (20:00
 * UTC). Night games start at ~6:30–7:10 PM ET (22:30–23:10 UTC) or later.
 * West coast night games can start at 9–10 PM ET, which rolls past midnight
 * into the small hours of the next UTC day.
 *
 * We classify as "day" anything whose ET hour (UTC − 4) is before 5 PM (17h).
 * This correctly handles west coast night games that wrap past midnight UTC.
 */
function isDayGame(gameDateIso: string): boolean {
  const d = new Date(gameDateIso);
  const etHour = (d.getUTCHours() - 4 + 24) % 24;
  return etHour < 17;
}

/**
 * Compute a verdict for day/night relative to season totals.
 *
 * Requires 40+ PA — day/night is a weaker signal than handedness but still
 * meaningful for players with documented tendencies. 40 PA is achievable
 * for everyday players by late April.
 */
export function getDayNightVerdict(
  splits: BatterSplits | null,
  gameDateIso: string,
): VerdictLabel {
  if (!splits) return { verdict: 'unknown', label: '' };
  const dayGame = isDayGame(gameDateIso);
  const split = dayGame ? splits.day : splits.night;
  const verdict = compareToSeason(split, splits.seasonTotals, 40);
  if (verdict === 'unknown' || verdict === 'neutral') return { verdict, label: '' };

  const ops = split?.ops !== null && split?.ops !== undefined ? split.ops.toFixed(3).replace(/^0\./, '.') : '—';
  const label = dayGame
    ? (verdict === 'strong' ? 'Day hitter' : 'Weak in day')
    : (verdict === 'strong' ? 'Night owl' : 'Weak at night');
  return { verdict, label, detail: `${ops} OPS` };
}

/**
 * Decide whether to surface a park pill for this batter.
 *
 * Picks the park factor matching the batter's side (parkFactorL for LHB,
 * parkFactorR for RHB, overall for switch hitters). Only fires on true
 * outliers — handedness-aware thresholds catch Yankee Stadium for LHB (short
 * RF porch), T-Mobile for RHB (marine air), etc., without polluting the row
 * with every park that's mildly off-average.
 */
export function getParkVerdict(
  park: ParkData | null | undefined,
  bats: 'L' | 'R' | 'S' | undefined,
): { verdict: 'strong' | 'weak'; label: string } | null {
  if (!park) return null;

  const pf =
    bats === 'L' ? park.parkFactorL :
    bats === 'R' ? park.parkFactorR :
    park.parkFactor;

  if (pf >= PARK_EXTREME_HITTER) return { verdict: 'strong', label: 'Hitter park' };
  if (pf <= PARK_EXTREME_PITCHER) return { verdict: 'weak', label: 'Pitcher park' };
  return null;
}

// ---------------------------------------------------------------------------
// Pitcher quality pill
// ---------------------------------------------------------------------------

/**
 * Translate a probable pitcher's quality into a display pill for the batter's row.
 *
 * Tier-based (from classifyPitcherTier):
 * - ace:     red   (weak for the batter — facing a shutdown arm)
 * - tough:   muted neutral (informational — above-average SP)
 * - bad:     green (strong for the batter)
 * - weak:    green (strong for the batter, slightly less emphatic than bad)
 *
 * ERA fallback (when tier is average/unknown but ERA is available):
 * - ERA ≥ 4.50:  green (hittable pitcher, even if tier classification is muddled)
 * - ERA ≤ 3.00:  red   (strong pitcher by results)
 *
 * This ensures most rows have at least one context pill when the opposing
 * pitcher is known — the tier may be "average" but the ERA can still be
 * informative at the extremes.
 */
export function getPitcherQualityPill(
  pitcher: ProbablePitcher | null | undefined,
): { verdict: Verdict; label: string } | null {
  if (!pitcher) return null;

  const q = pitcher.quality;
  if (q && q.tier !== 'unknown' && q.tier !== 'average') {
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

  // xERA fallback — prefer Statcast over actual ERA. xERA strips out luck
  // and team defense, so a 0.51 ERA with 4.20 xERA shows as average, not elite.
  // Only use xERA when Savant has a real sample (enforced upstream via bip ≥ 10).
  const xera = pitcher.xera;
  if (xera !== null) {
    if (xera >= 6.00) return { verdict: 'strong', label: `Hittable (x${xera.toFixed(1)})` };
    if (xera >= 4.50) return { verdict: 'strong', label: 'Hittable SP' };
    if (xera <= 3.00) return { verdict: 'weak', label: `${xera.toFixed(2)} xERA` };
    // xERA between 3.00–4.50 = average, no pill needed
    return null;
  }

  // Raw ERA fallback — only trust when enough innings for stabilisation.
  // A 0.51 ERA in 15 IP is noise; a 5.80 ERA in 40 IP means something.
  const ip = pitcher.inningsPitched;
  const era = pitcher.era;

  if (ip < 25) {
    // Unproven pitcher (callup, spot starter, early season) — surface this
    // so the manager knows there is no reliable scouting report.
    return { verdict: 'neutral', label: 'Unproven SP' };
  }

  if (era !== null) {
    if (era >= 6.00) return { verdict: 'strong', label: `Hittable (${era.toFixed(1)})` };
    if (era >= 4.50) return { verdict: 'strong', label: 'Hittable SP' };
    if (era <= 3.00) return { verdict: 'weak', label: `${era.toFixed(2)} ERA` };
  }

  return null;
}

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

  return { trend: 'neutral', label: '', detail };
}

// ---------------------------------------------------------------------------
// Stolen base indicator
// ---------------------------------------------------------------------------

/**
 * Surface a steal-threat pill when the batter has meaningful SB production.
 * Uses current season totals first, falls back to season baseline (may be
 * prior year in early April). Threshold: ≥ 5 SB with a reasonable rate
 * (≥ 1 SB per 30 PA) to avoid rewarding pure volume.
 */
export function getStealPill(
  splits: BatterSplits | null,
): { verdict: 'strong'; label: string } | null {
  if (!splits) return null;

  const line = splits.currentSeason ?? splits.seasonTotals;
  if (!line || line.plateAppearances < 30) return null;

  const sbPer600 = (line.stolenBases / line.plateAppearances) * 600;
  if (line.stolenBases >= 5 && sbPer600 >= 20) {
    return { verdict: 'strong', label: `${line.stolenBases} SB` };
  }
  if (line.stolenBases >= 10) {
    return { verdict: 'strong', label: `${line.stolenBases} SB` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Career vs pitcher pill
// ---------------------------------------------------------------------------

/**
 * Surface a pill when the batter has a meaningful career line vs the day's
 * opposing pitcher. Requires ≥ 8 PA to filter noise. Uses OPS thresholds
 * rather than relative-to-season since the sample is small and contextual.
 *
 * Career batter-vs-pitcher is one of the few genuinely predictive small-sample
 * stats — it captures specific mechanical matchups (pitch mix, arm angle).
 */
export function getCareerVsPitcherPill(
  careerVsPitcher: SplitLine | null,
  pitcherName: string | undefined,
): { verdict: Verdict; label: string } | null {
  if (!careerVsPitcher || !pitcherName) return null;
  if (careerVsPitcher.plateAppearances < 8) return null;

  const ops = careerVsPitcher.ops;
  if (ops === null) return null;

  const shortName = pitcherName.split(' ').pop() ?? pitcherName;
  // Only show AVG when it reinforces the message — a .250 AVG with high OPS
  // (walks + power) is genuinely good but looks misleading in a pill.
  const avg = careerVsPitcher.avg !== null && careerVsPitcher.avg >= 0.300
    ? careerVsPitcher.avg.toFixed(3).replace(/^0\./, '.')
    : null;

  if (ops >= 0.850) {
    return { verdict: 'strong', label: `Owns ${shortName}${avg ? ` ${avg}` : ''}` };
  }
  if (ops <= 0.500) {
    const weakAvg = careerVsPitcher.avg !== null && careerVsPitcher.avg < 0.200
      ? careerVsPitcher.avg.toFixed(3).replace(/^0\./, '.')
      : null;
    return { verdict: 'weak', label: `Can't hit ${shortName}${weakAvg ? ` ${weakAvg}` : ''}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Composite matchup score
//
// Weighted blend of all available signals → 0–1 where higher = better start.
// Follows the same invertNorm pattern as PitchingManager's overallScore.
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function norm(value: number | null, low: number, high: number): number {
  if (value === null) return 0.5;
  return clamp01((value - low) / (high - low));
}

function verdictScore(v: Verdict): number {
  switch (v) {
    case 'strong': return 1;
    case 'neutral': return 0.5;
    case 'weak': return 0;
    case 'unknown': return 0.5;
  }
}

export interface BatterMatchupScore {
  score: number;
  tier: 'great' | 'good' | 'neutral' | 'poor' | 'bad';
}

/**
 * Compute a composite 0–1 "expected value" score for a batter that blends
 * talent baseline (OPS) with matchup context signals.
 *
 * Talent gets 40% weight — enough to ensure studs stay near the top
 * (Soto won't get "Poor" just because he's facing an ace) but not so
 * dominant that matchup context is irrelevant.
 *
 * Weight breakdown:
 *   **Talent baseline:     0.40** (season OPS, normalised .600–.900)
 *   Pitcher quality:       0.15  (biggest matchup factor)
 *   Handedness split:      0.12  (real platoon advantage, 30+ PA)
 *   Recent form:           0.08  (current production level, 30+ PA)
 *   Career vs pitcher:     0.06  (genuinely predictive small-sample stat)
 *   Park factor:           0.06  (stable environmental signal)
 *   Staff quality:         0.06  (bullpen + team defense beyond the SP)
 *   Day/night split:       0.04  (marginal, 40+ PA)
 *   Weather:               0.03  (wind + temperature extremes)
 */
export function getBatterMatchupScore(
  splits: BatterSplits | null,
  careerVsPitcher: SplitLine | null,
  context: MatchupContext | null,
  bats: 'L' | 'R' | 'S' | undefined,
  baselineOPS: number | null = null,
): BatterMatchupScore {
  if (!context) return { score: 0.5, tier: 'neutral' };

  const { opposingPitcher, isHome, game, park } = context;

  // Talent baseline (normalise OPS: .600 → 0, .900 → 1)
  const talentVal = baselineOPS !== null
    ? clamp01((baselineOPS - 0.600) / 0.300)
    : 0.4; // unknown → slightly below average

  // Pitcher quality (ace=0, bad=1)
  const pitcherTier = opposingPitcher?.quality?.tier;
  const pitcherVal = pitcherTier === 'ace' ? 0.0
    : pitcherTier === 'tough' ? 0.25
    : pitcherTier === 'weak' ? 0.75
    : pitcherTier === 'bad' ? 1.0
    : 0.5;

  // Handedness (30+ PA required by getHandednessVerdict)
  const handedness = getHandednessVerdict(splits, opposingPitcher?.throws);

  const handednessVal = verdictScore(handedness.verdict);

  // Recent form (30+ PA required by getFormTrend)
  const form = getFormTrend(splits);
  const formVal = form.trend === 'hot' ? 1.0
    : form.trend === 'cold' ? 0.0
    : 0.5;

  // Career vs pitcher
  let cvpVal = 0.5;
  if (careerVsPitcher && careerVsPitcher.plateAppearances >= 8 && careerVsPitcher.ops !== null) {
    cvpVal = norm(careerVsPitcher.ops, 0.400, 1.000);
  }

  // Park factor
  const pf = bats === 'L' ? park?.parkFactorL
    : bats === 'R' ? park?.parkFactorR
    : park?.parkFactor;
  const parkVal = pf != null ? norm(pf, 90, 115) : 0.5;

  // Opposing team staff quality (captures bullpen + defense)
  const opposingTeam = isHome ? game.awayTeam : game.homeTeam;
  const staffEra = opposingTeam.staffEra;
  const staffVal = staffEra != null
    ? clamp01(1 - (staffEra - 3.0) / 2.5)
    : 0.5;

  // Day/night (40+ PA required by getDayNightVerdict)
  const dayNight = getDayNightVerdict(splits, game.gameDate);
  const dayNightVal = verdictScore(dayNight.verdict);

  // Weather
  const weather = getWeatherFlag(game, park);
  const wxVal = weather.kind === 'boost' ? 0.8
    : weather.kind === 'suppress' ? 0.2
    : 0.5;

  const score =
    talentVal * 0.40 +
    pitcherVal * 0.15 +
    handednessVal * 0.12 +
    formVal * 0.08 +
    cvpVal * 0.06 +
    parkVal * 0.06 +
    staffVal * 0.06 +
    dayNightVal * 0.04 +
    wxVal * 0.03;

  const tier: BatterMatchupScore['tier'] =
    score >= 0.70 ? 'great'
    : score >= 0.55 ? 'good'
    : score >= 0.45 ? 'neutral'
    : score >= 0.30 ? 'poor'
    : 'bad';

  return { score: Math.round(score * 100) / 100, tier };
}

/**
 * Lightweight context-only sort score for ordering the roster list without
 * splits data. Uses pitcher quality, park factor, team staff ERA, and
 * weather — the external matchup conditions available immediately from the
 * game-day API. Returns 0.5 when no context exists.
 */
export function getBatterContextScore(
  context: MatchupContext | null,
  bats?: 'L' | 'R' | 'S',
): number {
  if (!context) return 0.5;
  const { opposingPitcher, isHome, game, park } = context;

  const pitcherTier = opposingPitcher?.quality?.tier;
  const pitcherVal = pitcherTier === 'ace' ? 0.0
    : pitcherTier === 'tough' ? 0.25
    : pitcherTier === 'weak' ? 0.75
    : pitcherTier === 'bad' ? 1.0
    : 0.5;

  // Use xERA when available (Savant bip ≥ 10 gate enforced upstream).
  // Fall back to actual ERA only when IP ≥ 25 — raw ERA is noise at small samples.
  const effectiveEra = opposingPitcher?.xera
    ?? (opposingPitcher?.inningsPitched != null && opposingPitcher.inningsPitched >= 25
      ? opposingPitcher.era
      : null);
  const eraVal = effectiveEra !== null
    ? clamp01(1 - (effectiveEra - 2.0) / 4.0)
    : 0.5;

  const pf = bats === 'L' ? park?.parkFactorL
    : bats === 'R' ? park?.parkFactorR
    : park?.parkFactor;
  const parkVal = pf != null ? norm(pf, 90, 115) : 0.5;

  const opposingTeam = isHome ? game.awayTeam : game.homeTeam;
  const staffEra = opposingTeam.staffEra;
  const staffVal = staffEra != null
    ? clamp01(1 - (staffEra - 3.0) / 2.5)
    : 0.5;

  const weather = getWeatherFlag(game, park);
  const wxVal = weather.kind === 'boost' ? 0.8
    : weather.kind === 'suppress' ? 0.2
    : 0.5;

  return pitcherVal * 0.35 + eraVal * 0.15 + parkVal * 0.15 + staffVal * 0.20 + wxVal * 0.15;
}

// ---------------------------------------------------------------------------
// Weather notability
// ---------------------------------------------------------------------------

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
