/**
 * Matchup-adjusted points rates — the designed swap-in scorer for the points
 * engine (see lineupOptimizer.ts: "a matchup-adjusted scorer can be swapped
 * in later").
 *
 * NO new matchup math lives here. Batters run through the canonical L2
 * `buildBatterForecast` (park / platoon / opposing SP+bullpen / weather, with
 * literature-anchored clamps); pitchers through the canonical
 * `buildGameForecast`. This module only re-expresses those adjusted per-event
 * rates in points: dot the adjusted vector with the league's scoring weights,
 * exactly as `pointsValue.ts` does with the neutral vector.
 *
 * Scope boundary (deliberate): matchup adjustment applies ONLY to the
 * day/week LINEUP-DECISION scorers — lineup day scores, streaming coverage /
 * plugs / per-start stream points. Roster-construction values (weeklyPoints,
 * VOR, thisWeekPoints, suggested season swaps) stay talent-neutral, matching
 * the roster page's matchup-vacuum philosophy. Park context tells you who to
 * START this week, not who to OWN.
 */

import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { BatterSeasonStats, EnrichedGame } from '@/lib/mlb/types';
import type { MatchupContext } from '@/lib/mlb/analysis';
import type { TeamOffense } from '@/lib/mlb/teams';
import { buildBatterForecast } from '@/lib/mlb/batterForecast';
import { buildGameForecast } from '@/lib/pitching/forecast';
import {
  batterPointsRateVector,
  decomposeHits,
  POINTS_RATE_CONSTANTS,
} from './rateVector';
import { batterPointsPerPA } from './pointsValue';
import { forecastPitcherPoints } from './forecast';
import type { PointsPitcherInput } from './pitcherInputs';

const STAT_R = 7, STAT_H = 8, STAT_1B = 9, STAT_2B = 10, STAT_3B = 11;
const STAT_HR = 12, STAT_RBI = 13, STAT_SB = 16, STAT_BB = 18, STAT_BK = 21, STAT_TB = 23;
const STAT_W = 28, STAT_OUT = 33, STAT_HA = 34, STAT_ER = 37;
const STAT_PBB = 39, STAT_PHBP = 41, STAT_PK = 42;

/** Batter stats the L2 forecast can matchup-adjust. */
const ADJ_STAT_IDS = [STAT_R, STAT_H, STAT_HR, STAT_RBI, STAT_SB, STAT_BB, STAT_BK, STAT_TB];
/** `buildBatterForecast` only reads `stat_id` off each category entry, so
 *  minimal stubs suffice — points leagues have no EnrichedLeagueStatCategory
 *  list to pass. */
const ADJ_CATS = ADJ_STAT_IDS.map(id => ({ stat_id: id })) as EnrichedLeagueStatCategory[];

export interface AdjustedPointsRate {
  /** Matchup-adjusted expected points per PA. */
  pointsPerPA: number;
  /** Talent-neutral rate (the anchor the UI keeps visible). */
  neutralPointsPerPA: number;
  /** adjusted / neutral. 1.0 when there's no game context. */
  multiplier: number;
  /** The strongest modifier behind the move, e.g. "HR+ (128 vs LHB) · vs LHP −15%". */
  hint: string;
}

function neutralOnly(neutral: number): AdjustedPointsRate {
  return { pointsPerPA: neutral, neutralPointsPerPA: neutral, multiplier: 1, hint: '' };
}

/**
 * Matchup-adjusted points per PA for one batter in one game. Falls back to
 * the neutral rate when there's no context (idle day, missing slate).
 */
export function adjustedBatterPointsPerPA(
  stats: BatterSeasonStats,
  profile: ScoringProfile,
  ctx: MatchupContext | null,
  battingOrder: number | null,
): AdjustedPointsRate {
  const neutral = batterPointsPerPA(stats, profile);
  if (!ctx) return neutralOnly(neutral);

  const neutralVec = batterPointsRateVector(stats).perPA;
  const forecast = buildBatterForecast(stats, ctx, battingOrder, ADJ_CATS).perCategory;

  const adj: Record<number, number> = { ...neutralVec };
  for (const id of ADJ_STAT_IDS) {
    const f = forecast[id];
    if (f) adj[id] = Math.max(0, f.expected);
  }
  // Hit types inherit the matchup through the adjusted aggregates.
  const { singles, doubles, triples } = decomposeHits(
    adj[STAT_H] ?? 0,
    adj[STAT_TB] ?? 0,
    adj[STAT_HR] ?? 0,
  );
  adj[STAT_1B] = singles;
  adj[STAT_2B] = doubles;
  adj[STAT_3B] = triples;

  let pointsPerPA = 0;
  for (const [idStr, weight] of Object.entries(profile.weights)) {
    const r = adj[Number(idStr)];
    if (r) pointsPerPA += r * weight;
  }

  // Hint = the adjusted stat with the biggest points impact. Aggregates
  // (H/TB/HR) carry the hit-type weights they decompose into.
  const w = (id: number) => Math.abs(profile.weights[id] ?? 0);
  const effWeight: Record<number, number> = {
    [STAT_R]: w(STAT_R),
    [STAT_RBI]: w(STAT_RBI),
    [STAT_SB]: w(STAT_SB),
    [STAT_BB]: w(STAT_BB),
    [STAT_BK]: w(STAT_BK),
    [STAT_HR]: w(STAT_HR) + w(STAT_H) + w(STAT_TB),
    [STAT_H]: w(STAT_H) + w(STAT_1B),
    [STAT_TB]: w(STAT_TB) + w(STAT_2B),
  };
  let hint = '';
  let best = 0;
  for (const id of ADJ_STAT_IDS) {
    const f = forecast[id];
    if (!f || !f.modifierHint) continue;
    const impact = Math.abs((adj[id] ?? 0) - (neutralVec[id] ?? 0)) * (effWeight[id] ?? 0);
    if (impact > best) {
      best = impact;
      hint = f.modifierHint;
    }
  }

  return {
    pointsPerPA,
    neutralPointsPerPA: neutral,
    multiplier: neutral > 1e-9 ? pointsPerPA / neutral : 1,
    hint,
  };
}

export interface AdjustedStartPoints {
  /** Matchup-adjusted expected points for this start. */
  points: number;
  /** Talent-neutral per-start points (rate × ipPerStart + crude P(W)). */
  neutralPoints: number;
  /** adjusted / neutral. */
  multiplier: number;
  /** Strongest game-context driver, e.g. "Coors" / "vs Yankees". */
  hint: string;
}

/**
 * Mean of the slate's real team offenses — the empirical "league-average
 * opponent" the pitcher ratio anchors against. Using the live slate instead
 * of the static league anchors makes the points adjustment self-calibrating:
 * `teams.ts`'s LEAGUE_TEAM_* priors are deliberately rough ("stable, not
 * perfectly calibrated"), which is fine for the categories 0–100 scale but
 * shifts ABSOLUTE points by ~10%+ in an era the anchors lag (validated
 * against the 2026 dead-ball environment).
 */
export function meanTeamOffense(list: Array<TeamOffense | null>): TeamOffense | null {
  const real = list.filter((o): o is TeamOffense => o != null);
  if (real.length === 0) return null;
  const avgOf = (vals: Array<number | null>): number | null => {
    const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
    return xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
  };
  const side = (pick: (o: TeamOffense) => { ops: number | null; avg: number | null; strikeOutRate: number | null } | null) => {
    const sides = real.map(pick).filter((s): s is NonNullable<ReturnType<typeof pick>> => s != null);
    if (sides.length === 0) return null;
    return {
      ops: avgOf(sides.map(s => s.ops)),
      avg: avgOf(sides.map(s => s.avg)),
      strikeOutRate: avgOf(sides.map(s => s.strikeOutRate)),
    };
  };
  return {
    mlbId: 0,
    name: 'Slate mean',
    gamesPlayed: Math.round(avgOf(real.map(o => o.gamesPlayed)) ?? 0),
    ops: avgOf(real.map(o => o.ops)),
    avg: avgOf(real.map(o => o.avg)),
    runsPerGame: avgOf(real.map(o => o.runsPerGame)),
    strikeOutRate: avgOf(real.map(o => o.strikeOutRate)),
    homeRunsPerGame: avgOf(real.map(o => o.homeRunsPerGame)),
    vsLeft: side(o => o.vsLeft),
    vsRight: side(o => o.vsRight),
  };
}

/** Dot a game forecast's expected per-game line with the league's weights. */
function forecastToPoints(
  fc: ReturnType<typeof buildGameForecast>,
  profile: ScoringProfile,
): number {
  const g = fc.expectedPerGame;
  const w = (id: number) => profile.weights[id] ?? 0;
  const hbp = POINTS_RATE_CONSTANTS.LEAGUE_PITCHER_HBP_PER_PA * g.pa;
  return (
    g.ip * 3 * w(STAT_OUT) +
    g.h * w(STAT_HA) +
    g.er * w(STAT_ER) +
    g.bb * w(STAT_PBB) +
    hbp * w(STAT_PHBP) +
    g.k * w(STAT_PK) +
    fc.probabilities.w * w(STAT_W)
  );
}

/**
 * Matchup-adjusted points for one pitcher start, via the canonical L2
 * `buildGameForecast` (opposing offense, park, weather, platoon mix).
 *
 * The game forecast and the talent-neutral baseline disagree systematically
 * on scale (deeper IP model, richer P(W)) — validated at ~+12% mean across a
 * real FA slate with zero matchup signal in it. So the forecast is run
 * TWICE — once with the real context, once context-stripped (no park, no
 * weather, league-average offense, no opposing SP) — and only the RATIO is
 * applied to the talent-anchored neutral baseline. Keeps pitcher points on
 * the same scale as batter points (whose adjuster modifies baseline rates
 * directly), so cross-kind move comparisons stay honest.
 */
export function adjustedPitcherStartPoints(
  input: PointsPitcherInput,
  profile: ScoringProfile,
  game: EnrichedGame,
  isHome: boolean,
  opposingOffense: TeamOffense | null,
  /** The "league-average opponent" the ratio anchors against — pass
   *  `meanTeamOffense(...)` over the slate's real offenses. Null falls back
   *  to the forecast's internal (stale-anchored) neutral. */
  baselineOffense: TeamOffense | null = null,
): AdjustedStartPoints {
  const neutralPoints = forecastPitcherPoints(
    input.role === 'starter' ? input : { ...input, role: 'starter' },
    profile,
    { starts: 1, expectedIP: input.talent.ipPerStart },
    { appearances: 0, expectedIP: 0 },
  ).expectedPoints;

  const opposingProbable = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;
  const fc = buildGameForecast({
    pitcher: input.talent,
    game,
    isHome,
    opposingOffense,
    opposingPitcher: opposingProbable?.talent ?? null,
  });
  // Context-stripped twin: neutral park, no weather signal (the weather
  // OBJECT must exist — its fields are the nullable part), league-average
  // offense, unknown opposing SP.
  const neutralWeather = { temperature: null, condition: null, wind: null, windSpeed: null, windDirection: null };
  const fcNeutral = buildGameForecast({
    pitcher: input.talent,
    game: { ...game, park: null, weather: neutralWeather },
    isHome,
    opposingOffense: baselineOffense,
    opposingPitcher: null,
  });

  const ctxPoints = forecastToPoints(fc, profile);
  const baseCtxPoints = forecastToPoints(fcNeutral, profile);
  const multiplier = baseCtxPoints > 1e-9 ? ctxPoints / baseCtxPoints : 1;
  const points = neutralPoints * multiplier;

  // Hint: name the real drivers. The opponent effect mostly flows through
  // the log5 K/contact paths (NOT the display multipliers), so derive it from
  // the opponent-vs-slate OPS gap; park and weather come from the forecast's
  // own multipliers.
  const hints: string[] = [];
  const oppOps = opposingOffense?.ops ?? null;
  const baseOps = baselineOffense?.ops ?? null;
  if (oppOps != null && baseOps != null && baseOps > 0) {
    const d = (oppOps / baseOps - 1) * 100;
    if (d <= -3) hints.push(`weak offense (${oppOps.toFixed(3)} OPS)`);
    else if (d >= 3) hints.push(`strong offense (${oppOps.toFixed(3)} OPS)`);
  }
  for (const m of [fc.multipliers.park, fc.multipliers.weather]) {
    if (m && Math.abs(m.deltaPct) >= 3 && m.display) {
      hints.push(`${m.display} ${m.deltaPct >= 0 ? '+' : ''}${Math.round(m.deltaPct)}%`);
    }
  }
  const hint = hints.join(' · ');

  return {
    points,
    neutralPoints,
    multiplier,
    hint,
  };
}
