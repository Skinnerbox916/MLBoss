/**
 * Neutral-week (matchup-vacuum) projection.
 *
 * Used by the L6 roster-strategy forecast. Answers "in a typical
 * neutral week, what would this roster produce per scored category?"
 * — talent-only, no this-week schedule, no park, no opposing SP.
 *
 * See [docs/roster-strategy.md](../../../docs/roster-strategy.md) for the
 * full design rationale. Key contract:
 *
 *   - Volume is observed YTD pace (PA/week for batters, GS/week and
 *     IP/week for pitchers). This is the only place real observed data
 *     enters — it represents "what role does this player play" rather
 *     than "what schedule does this player have."
 *   - Per-PA / per-IP rates come from the rating engines run against
 *     a neutral matchup context (`buildNeutralGame`). The engines
 *     normally take a schedule-aware context; we feed them a synthetic
 *     neutral one so park / opp SP / weather collapse to 1.0.
 *   - Output shape matches `projectBatterTeam` / `projectPitcherTeam`
 *     so `computeLeagueForecast` consumes it unchanged.
 */

import { buildNeutralGame } from '@/lib/pitching/roster';
import { buildGameForecast } from '@/lib/pitching/forecast';
import { getPitcherRating } from '@/lib/pitching/rating';
import { observedSavesPerAppearance } from '@/lib/pitching/talent';
import { getBatterRating } from '@/lib/mlb/batterRating';
import type { Focus } from '@/lib/rating/focus';
import type { MatchupContext } from '@/lib/mlb/matchupContext';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { PitcherTalent } from '@/lib/pitching/talent';
import type {
  ActiveBatter,
  TeamProjection,
  PerCategoryProjection,
} from './batterTeam';
import type { ActivePitcher, PitcherTeamProjection } from './pitcherTeam';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AB ≈ PA × 0.91. Mirrors `batterTeam.AB_PER_PA`. */
const AB_PER_PA = 0.91;

/**
 * Typical full-time games-per-week for an MLB hitter. Used as the volume
 * assumption in the matchup-vacuum projection — see the module header.
 *
 * Why not "observed games / weeks elapsed"? That's what we tried first,
 * and it under-counts every player who missed time (IL, call-up, demotion).
 * Roster-page users explicitly want to strip YTD distortion: a healthy
 * everyday hitter with 30 games YTD and a healthy everyday hitter with 40
 * games YTD should produce the same projected R/RBI/HR per week — the
 * 30-GP one isn't fundamentally worse, they just missed time.
 *
 * 6 games/week is the empirical typical full-time pace (MLB teams play
 * ~6.2 games per calendar week; some hitters get scheduled days off).
 */
const TYPICAL_GAMES_PER_WEEK = 6;

/** Default per-game PA rate when GP is 0 (no games played). Mirrors
 *  `batterTeam.BASELINE_PA_PER_GAME`. */
const DEFAULT_PA_PER_GAME = 4.1;

/**
 * Typical full-rotation starts per calendar week for an SP. Every 5
 * days × 7-day week ≈ 1.4 starts/week, but skipped rotations and 6-man
 * cycles bring the empirical median to ~1.2.
 */
const TYPICAL_SP_STARTS_PER_WEEK = 1.2;

/**
 * Typical reliever weekly innings — fallback when the talent vector has
 * no blended `ipPerAppearance`/`appearancesPerWeek` (shouldn't happen for
 * a live RP, but degrade gracefully). RP usage varies widely (high-
 * leverage arm: ~5 IP/week; mop-up: ~2 IP/week); median across rostered
 * RPs is ~3 IP/week.
 */
const TYPICAL_RP_IP_PER_WEEK = 3.0;

/**
 * Typical reliever appearances per calendar week — fallback companion to
 * `TYPICAL_RP_IP_PER_WEEK`. Live RPs carry a blended per-player value on
 * the talent vector (`appearancesPerWeek`).
 */
const TYPICAL_RP_APPEARANCES_PER_WEEK = 3.0;

/** Min observed GP to use the player's own per-game PA rate. Below this
 *  we fall back to the league average so call-ups with 2 games don't
 *  get penalized for a noisy small-sample per-game rate. */
const MIN_GP_FOR_PA_RATE = 5;

/** Min weekly volume to count a player as a contributor. Below this they
 *  are functionally inactive — including them just adds noise. */
const MIN_WEEKLY_PA = 3.0;
const MIN_WEEKLY_IP = 0.5;

const STAT_ID_AVG = 3;
const STAT_ID_K = 42;
const STAT_ID_W = 28;
const STAT_ID_SV = 32;
const STAT_ID_QS = 83;
const STAT_ID_IP = 50;
const STAT_ID_ERA = 26;
const STAT_ID_WHIP = 27;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function accumulate(
  byCat: Map<number, PerCategoryProjection>,
  statId: number,
  count: number,
  denom: number,
): void {
  const prior = byCat.get(statId);
  if (prior) {
    prior.expectedCount += count;
    prior.expectedDenom += denom;
  } else {
    byCat.set(statId, { statId, expectedCount: count, expectedDenom: denom });
  }
}

// ---------------------------------------------------------------------------
// Batter side
// ---------------------------------------------------------------------------

export interface NeutralBatterDeps {
  scoredCategories: EnrichedLeagueStatCategory[];
  statsByMlbId: Map<number, BatterSeasonStats>;
  /** mlbId → typical observed lineup spot (1-9). Drives per-PA rates in
   *  `getBatterRating` (lineup spot affects matchup quality). Missing
   *  entries fall back to null → neutral. */
  lineupSpots: Map<number, number>;
  focusMap?: Record<number, Focus>;
}

/**
 * Per-batter weekly category contribution, neutral context, observed
 * playing-time pace. See module header for the contract.
 */
function projectOneBatterNeutral(
  player: ActiveBatter,
  deps: NeutralBatterDeps,
  reusableContext: MatchupContext,
): { byCat: Map<number, PerCategoryProjection>; ratingScore: number } | null {
  const stats = deps.statsByMlbId.get(player.mlbId);
  if (!stats) return null;

  // Volume = per-game PA rate × typical full-time games/week.
  // The per-game rate is intrinsic to the player (carries lineup spot
  // signal); the games/week assumption strips IL-stint and demotion
  // distortion. See the constant doc for why this beats observed
  // (pa / weeksElapsed) pace.
  const paPerGame =
    stats.gp >= MIN_GP_FOR_PA_RATE
      ? stats.pa / stats.gp
      : DEFAULT_PA_PER_GAME;
  const weeklyPA = paPerGame * TYPICAL_GAMES_PER_WEEK;
  if (weeklyPA < MIN_WEEKLY_PA) return null;

  const spot = deps.lineupSpots.get(player.mlbId) ?? null;

  // Mutate the reusable context's asBatter for this player. Cheaper than
  // rebuilding the whole context (which clones a neutral park each call).
  const context: MatchupContext = {
    ...reusableContext,
    asBatter: { hand: stats.bats ?? null, battingOrder: spot },
  };

  const rating = getBatterRating({
    context,
    stats,
    scoredCategories: deps.scoredCategories,
    focusMap: deps.focusMap ?? {},
    battingOrder: spot,
  });

  const byCat = new Map<number, PerCategoryProjection>();
  for (const cat of rating.categories) {
    const denom = cat.statId === STAT_ID_AVG ? weeklyPA * AB_PER_PA : weeklyPA;
    const count = cat.expected * denom;
    accumulate(byCat, cat.statId, count, denom);
  }
  return { byCat, ratingScore: rating.score };
}

/**
 * Per-player neutral-week projection — extracted from
 * `projectBatterTeamNeutral` so the same primitive can score free
 * agents for RUPM (replacement upgrade per move) calculation in
 * [src/lib/league/forecast.ts](../league/forecast.ts).
 *
 * Returns null when the batter is functionally inactive (no stats, or
 * `weeklyPA < MIN_WEEKLY_PA`). Otherwise returns a `PlayerProjection`
 * with `byCategory` populated and `weeklyScore` carrying the neutral-
 * context rating score (0-100) — the canonical "how good is this bat in
 * a vacuum" scalar, used by the forecast route's starting-lineup
 * assignment. `perDay`, `weeklyPA`, and `expectedGames` are
 * placeholder/empty since this layer doesn't project per-day or apply
 * schedule.
 */
export function projectBatterNeutral(
  player: ActiveBatter,
  deps: NeutralBatterDeps,
  reusableContext?: MatchupContext,
): import('./batterTeam').PlayerProjection | null {
  const ctx = reusableContext ?? buildNeutralBatterContext();
  const result = projectOneBatterNeutral(player, deps, ctx);
  if (!result) return null;
  return {
    mlbId: player.mlbId,
    name: player.name,
    teamAbbr: player.teamAbbr,
    perDay: [],
    weeklyScore: result.ratingScore,
    weeklyPA: 0,
    byCategory: result.byCat,
    expectedGames: 0,
  };
}

/** Default neutral batter context — exposed for callers projecting many
 *  batters in a loop (avoids cloning the park object per call). */
export function buildNeutralBatterContext(): MatchupContext {
  return {
    game: buildNeutralGame(),
    isHome: true,
    opposingPitcher: null,
    asPitcher: null,
    asBatter: { hand: null, battingOrder: null },
  };
}

/**
 * Sum each active batter's neutral-week category contribution into a
 * `TeamProjection`. Caller filters `batters` to non-injured active
 * roster slots. `perPlayer` is populated so callers can extract
 * per-player breakdowns (e.g. for the league-wide RUPM calculation).
 */
export function projectBatterTeamNeutral(
  batters: ActiveBatter[],
  deps: NeutralBatterDeps,
): TeamProjection {
  // Build the neutral context once and reuse — buildNeutralGame
  // allocates a fresh park object each call (heavy enough to matter
  // when fanned over ~12 teams × ~12 batters).
  const reusableContext = buildNeutralBatterContext();

  const teamByCat = new Map<number, PerCategoryProjection>();
  const perPlayer: import('./batterTeam').PlayerProjection[] = [];

  for (const batter of batters) {
    const proj = projectBatterNeutral(batter, deps, reusableContext);
    if (!proj) continue;
    perPlayer.push(proj);
    for (const [statId, cat] of proj.byCategory) {
      accumulate(teamByCat, statId, cat.expectedCount, cat.expectedDenom);
    }
  }

  return {
    byCategory: teamByCat,
    perPlayer,
    contributorCount: perPlayer.length,
  };
}

// ---------------------------------------------------------------------------
// Pitcher side
// ---------------------------------------------------------------------------

export interface NeutralPitcherEntry {
  talent: PitcherTalent;
  role: 'starter' | 'reliever' | 'inactive';
  isGhost: boolean;
  seasonGS: number;
  seasonIP: number;
  /** Current-season saves — closer signal for the SV projection. */
  seasonSaves: number;
  /** Current-season appearances (G) — denominator for save pace. */
  seasonGames: number;
}

export interface NeutralPitcherDeps {
  scoredCategories: EnrichedLeagueStatCategory[];
  /**
   * `${name.toLowerCase()}|${team.toLowerCase()}` → talent + workload.
   * Same key shape `getPitcherTalentBatch` returns. Pitchers absent from
   * this map are skipped (talent computation failed or the pitcher is
   * unresolved). We key by name|team — not mlbId — because the API
   * route fetches roster entries from Yahoo (name + team) and resolving
   * each to mlbId here would double-pay the identity-resolve cost that
   * `getPitcherTalentBatch` already pays internally.
   */
  talentByNameTeam: Map<string, NeutralPitcherEntry>;
  focusMap?: Record<number, Focus>;
}

function pitcherKey(name: string, team: string): string {
  return `${name.toLowerCase()}|${team.toLowerCase()}`;
}

interface PitcherRateBundle {
  /** Per-IP K rate. */
  kPerIP: number;
  /** Per-IP earned runs. */
  erPerIP: number;
  /** Per-IP base-runners (BB + H). */
  whipNumPerIP: number;
  /** Per-start W expected (talent × neutral context). 0 for relievers. */
  wPerStart: number;
  /** Per-start QS expected. 0 for relievers. */
  qsPerStart: number;
}

/**
 * Run the rating engine against a neutral game once per pitcher and
 * decompose into per-IP / per-start rates. The rating engine returns
 * per-start expecteds (since the underlying forecast models a start);
 * we divide by the forecast's per-game IP to get a clean per-IP rate
 * we can scale by observed ipPerWeek.
 *
 * For relievers we coerce `ipPerStart = 1.0` (matching
 * `getPitcherSeasonRating`'s convention) so the per-start expecteds are
 * effectively per-1-IP outputs.
 */
function getNeutralRateBundle(
  entry: NeutralPitcherEntry,
  scoredCategories: EnrichedLeagueStatCategory[],
  focusMap: Record<number, Focus>,
): PitcherRateBundle {
  const isRP = entry.role === 'reliever';
  const adjustedTalent = isRP
    ? { ...entry.talent, ipPerStart: 1.0 }
    : entry.talent;

  const forecast = buildGameForecast({
    pitcher: adjustedTalent,
    game: buildNeutralGame(),
    isHome: true,
    opposingOffense: null,
    opposingPitcher: null,
  });
  const rating = getPitcherRating({
    forecast,
    scoredCategories,
    focusMap,
  });
  const startIP = Math.max(forecast.expectedPerGame.ip, 0.01);

  let kExpected = 0;
  let wExpected = 0;
  let qsExpected = 0;
  for (const cat of rating.categories) {
    if (cat.statId === STAT_ID_K) kExpected = cat.expected;
    else if (cat.statId === STAT_ID_W) wExpected = cat.expected;
    else if (cat.statId === STAT_ID_QS) qsExpected = cat.expected;
  }

  return {
    kPerIP: kExpected / startIP,
    erPerIP: forecast.expectedPerGame.er / startIP,
    whipNumPerIP:
      (forecast.expectedPerGame.bb + forecast.expectedPerGame.h) / startIP,
    wPerStart: isRP ? 0 : wExpected,
    qsPerStart: isRP ? 0 : qsExpected,
  };
}

function projectOnePitcherNeutral(
  player: ActivePitcher,
  deps: NeutralPitcherDeps,
): Map<number, PerCategoryProjection> | null {
  const entry = deps.talentByNameTeam.get(pitcherKey(player.name, player.teamAbbr));
  if (!entry || entry.isGhost || entry.role === 'inactive') return null;

  // Volume = role-typical workload, not observed YTD pace. Same rationale
  // as the batter side: strip IL-stint / skipped-rotation distortion so
  // the talent comparison reflects roster shape, not who got hurt.
  // `entry.role` was already inferred from observed GS/IP (see
  // `getPitcherTalentBatch`), so this implicitly conditions on "this
  // pitcher is actually being used as an SP / RP." Relievers use their
  // blended per-player workload (usage differences between a closer and
  // a mop-up arm are role signal, not schedule noise), with league-
  // typical fallbacks.
  const isReliever = entry.role === 'reliever';
  const startsPerWeek =
    entry.role === 'starter' ? TYPICAL_SP_STARTS_PER_WEEK : 0;
  const appearancesPerWeek = isReliever
    ? entry.talent.appearancesPerWeek ?? TYPICAL_RP_APPEARANCES_PER_WEEK
    : 0;
  const ipPerWeek = isReliever
    ? entry.talent.ipPerAppearance != null
      ? entry.talent.ipPerAppearance * appearancesPerWeek
      : TYPICAL_RP_IP_PER_WEEK
    : startsPerWeek * entry.talent.ipPerStart;
  if (ipPerWeek < MIN_WEEKLY_IP) return null;

  const rates = getNeutralRateBundle(
    entry,
    deps.scoredCategories,
    deps.focusMap ?? {},
  );

  const byCat = new Map<number, PerCategoryProjection>();

  // The L6 forecast cares about each scored cat's expectedCount (for
  // counting cats) or expectedCount/expectedDenom (for ratio cats). We
  // iterate scoredCategories — not rating.categories — so non-modeled
  // cats (HLD, K9/BB9/H9) just get skipped without producing zero
  // entries that would skew the team's mean.
  //
  // SV is modeled directly (the rating engine has no SV window): observed
  // save-conversion pace × blended appearances/week, relievers only.
  // Starters contribute no SV entry — same as an unmodeled cat — so a
  // roster with zero relievers aggregates to 0 projected saves.
  const svPerAppearance = isReliever
    ? observedSavesPerAppearance(entry.seasonSaves, entry.seasonGames)
    : 0;

  for (const cat of deps.scoredCategories) {
    if (!cat.is_pitcher_stat) continue;

    if (cat.stat_id === STAT_ID_K) {
      accumulate(byCat, cat.stat_id, rates.kPerIP * ipPerWeek, ipPerWeek);
    } else if (cat.stat_id === STAT_ID_W) {
      accumulate(byCat, cat.stat_id, rates.wPerStart * startsPerWeek, startsPerWeek);
    } else if (cat.stat_id === STAT_ID_SV) {
      if (isReliever) {
        accumulate(byCat, cat.stat_id, svPerAppearance * appearancesPerWeek, appearancesPerWeek);
      }
    } else if (cat.stat_id === STAT_ID_QS) {
      accumulate(byCat, cat.stat_id, rates.qsPerStart * startsPerWeek, startsPerWeek);
    } else if (cat.stat_id === STAT_ID_IP) {
      accumulate(byCat, cat.stat_id, ipPerWeek, ipPerWeek);
    } else if (cat.stat_id === STAT_ID_ERA) {
      accumulate(byCat, cat.stat_id, rates.erPerIP * ipPerWeek, ipPerWeek);
    } else if (cat.stat_id === STAT_ID_WHIP) {
      accumulate(byCat, cat.stat_id, rates.whipNumPerIP * ipPerWeek, ipPerWeek);
    }
  }

  return byCat;
}

/**
 * Sum each active pitcher's neutral-week category contribution into a
 * `PitcherTeamProjection`. Caller filters `pitchers` to non-injured
 * roster slots.
 */
export function projectPitcherTeamNeutral(
  pitchers: ActivePitcher[],
  deps: NeutralPitcherDeps,
): PitcherTeamProjection {
  const teamByCat = new Map<number, PerCategoryProjection>();
  let contributorCount = 0;

  for (const pitcher of pitchers) {
    const byCat = projectOnePitcherNeutral(pitcher, deps);
    if (!byCat) continue;
    contributorCount += 1;
    for (const [statId, cat] of byCat) {
      accumulate(teamByCat, statId, cat.expectedCount, cat.expectedDenom);
    }
  }

  return {
    byCategory: teamByCat,
    perPitcher: [],
    perReliever: [],
    weeklySpIp: 0,
    weeklyRpIp: 0,
    weeklyIp: 0,
    contributorCount,
  };
}
