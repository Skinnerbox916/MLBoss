/**
 * Forward pitcher projection engine.
 *
 * Mirrors `batterTeam.ts` for the pitcher side. The unit of work is a
 * **probable start**, not "every day" — a pitcher with two starts in the
 * pickup window contributes twice; a pitcher with no scheduled starts
 * contributes zero. Aggregation is summed across starts so two-start
 * pitchers naturally outrank single-start pitchers of equal per-start
 * quality (the deliberate streaming-decision bias the user wants).
 *
 * Used in three places, same shape as the batter side:
 *   1. Project my team's expected pitcher-cat output for the rest of the week
 *   2. Project the opponent's expected pitcher-cat output (by team_key)
 *   3. Project free-agent SP candidates for the streaming board
 *
 * Per start the engine uses Layer-2 `buildGameForecast` and Layer-3
 * `getPitcherRating` directly — same primitives the streaming-board
 * single-day score uses, just summed across the window. No new talent
 * math here.
 *
 * Limitations (deliberate, per design discussion):
 *   - SV / HLD / L are not modeled (no relief-pitcher engine yet).
 *   - Ratio-cat numerator/denom is aggregated for completeness but the
 *     corrected-margin pipeline reads only counting cats; ratio fidelity
 *     stays at the per-FA `scorePitcher` per-start view.
 */

import { buildGameForecast } from '@/lib/pitching/forecast';
import { getPitcherRating } from '@/lib/pitching/rating';
import { isLikelySamePlayer, normalizeTeamAbbr } from '@/lib/pitching/display';
import type { Focus } from '@/lib/mlb/batterRating';
import type { EnrichedGame, ProbablePitcher } from '@/lib/mlb/types';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { WeekDay } from '@/lib/dashboard/weekRange';
import type { PitcherRating } from '@/lib/pitching/rating';
import type { PerCategoryProjection } from './batterTeam';

// ---------------------------------------------------------------------------
// Yahoo stat_id → projection-source map
//
// Keep close to `PITCHER_NORM` in `rating.ts` and `PITCHER_CATEGORY_STAT_IDS`
// in `scoring.ts`. The rating layer already projects each of these from
// the forecast; the projection engine layers on top of that primitive.
// ---------------------------------------------------------------------------

const STAT_ID_K = 42;
const STAT_ID_W = 28;
const STAT_ID_QS = 83;
const STAT_ID_IP = 50;
const STAT_ID_ERA = 26;
const STAT_ID_WHIP = 27;

/** Counting cats — `expectedCount` is summed across starts; `expectedDenom`
 *  records the start count for callers that want a per-start rate. */
const COUNTING_PITCHER_STAT_IDS = new Set<number>([
  STAT_ID_K, STAT_ID_W, STAT_ID_QS, STAT_ID_IP,
]);

/** Ratio cats — `expectedCount` is the numerator (ER for ERA, BB+H for
 *  WHIP); `expectedDenom` is IP. The corrected-margin pipeline ignores
 *  these per the design discussion (ratio fidelity lives in per-FA
 *  scoring); aggregated here so per-FA detail panels can show them. */
const RATIO_PITCHER_STAT_IDS = new Set<number>([STAT_ID_ERA, STAT_ID_WHIP]);

export function isProjectablePitcherStat(statId: number): boolean {
  return COUNTING_PITCHER_STAT_IDS.has(statId) || RATIO_PITCHER_STAT_IDS.has(statId);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivePitcher {
  mlbId: number;
  name: string;
  teamAbbr: string;
}

export interface PitcherProjectionDeps {
  /** Calendar days to project — typically the matchup week's remaining
   *  days (for team projection) or the pickup-playable window (for FA
   *  scoring). The engine doesn't care which; it just iterates them. */
  days: WeekDay[];
  /** Per-day game lookup. Each entry's value is the full league slate
   *  for that date, already enriched with park / weather / probable
   *  pitchers (with `talent` stamped by the schedule pipeline). */
  gamesByDate: Map<string, EnrichedGame[]>;
  /** Pitcher-side scored categories (caller filters via `is_pitcher_stat`). */
  scoredCategories: EnrichedLeagueStatCategory[];
  /** Optional: opposing-team offense lookup by MLB team id. When absent
   *  the forecast runs with neutral opponent context. */
  teamOffense?: Map<number, TeamOffense>;
  /** Optional focus map — chase/punt weights drive the per-start score
   *  composite the same way they do for batters. */
  focusMap?: Record<number, Focus>;
}

export interface PerStartProjection {
  date: string;
  dayLabel: string;
  /** True when this pitcher has a probable start on this date. */
  hasStart: boolean;
  /** True when the team plays a doubleheader on this date (rare for the
   *  same SP to start both, but surfaced for completeness). */
  doubleHeader: boolean;
  opponent?: string;
  opponentMlbId?: number;
  isHome?: boolean;
  parkFactor?: number;
  weatherFlag?: string;
  /** Expected IP for this start (forecast.expectedPerGame.ip). 0 when
   *  no start is scheduled. */
  expectedIP: number;
  /** Per-start fantasy-cat rating from `getPitcherRating`. Null on
   *  off-days or when the probable's talent is missing. */
  rating: PitcherRating | null;
  // ----- UI-only refs (omit when serializing to JSON) -----
  /** Reference to the underlying game. Populated by the engine for
   *  in-process consumers (FA week scoring, breakdown panels). The
   *  team-projection HTTP route omits this field when serializing. */
  gameRef?: EnrichedGame;
  /** Reference to the probable-pitcher object on the engine-resolved
   *  start. Same JSON-omission caveat as `gameRef`. */
  ppRef?: ProbablePitcher;
}

export interface PitcherPlayerProjection {
  mlbId: number;
  name: string;
  teamAbbr: string;
  perStart: PerStartProjection[];
  /** Sum of per-start rating scores. Privileges two-start pitchers by
   *  construction — a 2-start pitcher with avg 60 (= 120) outranks a
   *  1-start ace with score 80. Mirrors what `batterTeam.weeklyScore`
   *  encodes on the batter side, but summed not averaged because the
   *  unit of work (a start) carries fixed-ish ~6 IP regardless of
   *  pitcher quality. */
  weeklyScore: number;
  /** Sum of per-start expected IP. */
  weeklyIP: number;
  /** Number of probable starts in the projection window. */
  expectedStarts: number;
  /** Per-cat counting/rate projections. See COUNTING/RATIO sets above. */
  byCategory: Map<number, PerCategoryProjection>;
}

export interface PitcherTeamProjection {
  /** Sum over pitchers for each scored cat. */
  byCategory: Map<number, PerCategoryProjection>;
  perPitcher: PitcherPlayerProjection[];
  /** Number of distinct pitchers that contributed at least one start. */
  contributorCount: number;
}

// ---------------------------------------------------------------------------
// Find this pitcher's probable start in a day's slate
// ---------------------------------------------------------------------------

interface MatchedStart {
  game: EnrichedGame;
  pp: ProbablePitcher;
  isHome: boolean;
}

/** Scan the day's slate for a game where this pitcher's team plays AND
 *  the probable starter (on this pitcher's side) matches by name. Same
 *  matching contract as `matchFreeAgentToGame` / `matchProbableStarts`
 *  — collapsed to a single primitive here so the engine doesn't depend
 *  on either of those higher-level matchers. */
function findStart(player: ActivePitcher, games: EnrichedGame[]): MatchedStart | null {
  const teamAbbr = normalizeTeamAbbr(player.teamAbbr);
  if (!teamAbbr) return null;

  for (const game of games) {
    const homeAbbr = normalizeTeamAbbr(game.homeTeam.abbreviation);
    const awayAbbr = normalizeTeamAbbr(game.awayTeam.abbreviation);
    const isHome = homeAbbr === teamAbbr;
    const isAway = awayAbbr === teamAbbr;
    if (!isHome && !isAway) continue;

    const pp = isHome ? game.homeProbablePitcher : game.awayProbablePitcher;
    if (!pp) continue;
    if (!isLikelySamePlayer(player.name, pp.name)) continue;

    return { game, pp, isHome };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-player primitive
// ---------------------------------------------------------------------------

/**
 * Project one pitcher across the supplied days.
 *
 * Per day:
 *   - Find this pitcher's probable start in the day's slate (no-op when
 *     it's an off-day or the pitcher isn't the probable).
 *   - When a start is found, build the forecast and run `getPitcherRating`.
 *   - Aggregate per-cat expected counts (K/W/QS/IP) and ratio numerators
 *     (ER for ERA, BB+H for WHIP) into `byCategory`.
 *   - Sum `rating.score` into `weeklyScore`.
 */
export function projectPitcherPlayer(
  player: ActivePitcher,
  deps: PitcherProjectionDeps,
): PitcherPlayerProjection {
  const focusMap = deps.focusMap ?? {};
  const perStart: PerStartProjection[] = [];
  const byCategory = new Map<number, PerCategoryProjection>();
  let weeklyScore = 0;
  let weeklyIP = 0;
  let expectedStarts = 0;

  for (const day of deps.days) {
    const games = deps.gamesByDate.get(day.date) ?? [];
    const teamGames = games.filter(g =>
      normalizeTeamAbbr(g.homeTeam.abbreviation) === normalizeTeamAbbr(player.teamAbbr) ||
      normalizeTeamAbbr(g.awayTeam.abbreviation) === normalizeTeamAbbr(player.teamAbbr),
    );
    const doubleHeader = teamGames.length >= 2;

    const match = findStart(player, games);
    const talent = match?.pp.talent ?? null;
    if (!match || !talent) {
      // Off-day, opponent-side game, or talent not stamped (rookie call-up
      // we couldn't resolve). Either way: no contribution.
      perStart.push({
        date: day.date,
        dayLabel: day.dayLabel,
        hasStart: false,
        doubleHeader,
        expectedIP: 0,
        rating: null,
      });
      continue;
    }

    const { game, pp, isHome } = match;
    const opponentTeam = isHome ? game.awayTeam : game.homeTeam;
    const opposingOffense = deps.teamOffense?.get(opponentTeam.mlbId) ?? null;
    const opposingProbable = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;

    const forecast = buildGameForecast({
      pitcher: talent,
      game,
      isHome,
      opposingOffense,
      opposingPitcher: opposingProbable?.talent ?? null,
    });

    const rating = getPitcherRating({
      forecast,
      scoredCategories: deps.scoredCategories,
      focusMap,
    });

    expectedStarts += 1;
    weeklyIP += forecast.expectedPerGame.ip;
    weeklyScore += rating.score;

    // Per-cat aggregation. Counting cats sum the rating's `expected`;
    // ratio cats use raw forecast fields for numerator/denominator so a
    // future corrected-margin extension can blend them properly. The
    // current pipeline only consumes counting cats from this map.
    for (const cat of rating.categories) {
      const prior = byCategory.get(cat.statId);

      let dayCount = 0;
      let dayDenom = 0;
      if (COUNTING_PITCHER_STAT_IDS.has(cat.statId)) {
        dayCount = cat.expected;
        dayDenom = 1; // 1 start per day; useful only for "starts in cat" aggregation
      } else if (cat.statId === STAT_ID_ERA) {
        dayCount = forecast.expectedPerGame.er;
        dayDenom = forecast.expectedPerGame.ip;
      } else if (cat.statId === STAT_ID_WHIP) {
        dayCount = forecast.expectedPerGame.bb + forecast.expectedPerGame.h;
        dayDenom = forecast.expectedPerGame.ip;
      } else {
        // Cat scored by the league but not modeled (SV, HLD, etc.).
        // Skip — no projection contribution.
        continue;
      }

      if (prior) {
        prior.expectedCount += dayCount;
        prior.expectedDenom += dayDenom;
      } else {
        byCategory.set(cat.statId, {
          statId: cat.statId,
          expectedCount: dayCount,
          expectedDenom: dayDenom,
        });
      }
    }

    perStart.push({
      date: day.date,
      dayLabel: day.dayLabel,
      hasStart: true,
      doubleHeader,
      opponent: opponentTeam.abbreviation,
      opponentMlbId: opponentTeam.mlbId,
      isHome,
      parkFactor: game.park?.parkFactor,
      weatherFlag: rating.weather.available ? rating.weather.display : undefined,
      expectedIP: forecast.expectedPerGame.ip,
      rating,
      gameRef: game,
      ppRef: pp,
    });
  }

  return {
    mlbId: player.mlbId,
    name: player.name,
    teamAbbr: player.teamAbbr,
    perStart,
    weeklyScore,
    weeklyIP,
    expectedStarts,
    byCategory,
  };
}

// ---------------------------------------------------------------------------
// Team aggregator
// ---------------------------------------------------------------------------

/**
 * Project a team's pitcher-cat output across the supplied days. Calls
 * `projectPitcherPlayer` per active SP and sums per-cat counts.
 *
 * The caller is responsible for filtering `activePitchers` to actually
 * rostered, non-IL starting pitchers before passing them in. Relievers
 * pass through harmlessly — they just won't match as probable starters
 * on any day, so contribute nothing.
 */
export function projectPitcherTeam(
  activePitchers: ActivePitcher[],
  deps: PitcherProjectionDeps,
): PitcherTeamProjection {
  const perPitcher: PitcherPlayerProjection[] = [];
  const teamByCat = new Map<number, PerCategoryProjection>();

  for (const pitcher of activePitchers) {
    const proj = projectPitcherPlayer(pitcher, deps);
    perPitcher.push(proj);
    for (const [statId, cat] of proj.byCategory) {
      const prior = teamByCat.get(statId);
      if (prior) {
        prior.expectedCount += cat.expectedCount;
        prior.expectedDenom += cat.expectedDenom;
      } else {
        teamByCat.set(statId, { ...cat });
      }
    }
  }

  return {
    byCategory: teamByCat,
    perPitcher,
    contributorCount: perPitcher.filter(p => p.expectedStarts > 0).length,
  };
}
