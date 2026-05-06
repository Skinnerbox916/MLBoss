/**
 * Forward batter projection engine.
 *
 * Runs `getBatterRating` over each (player, day) pair across the rest of
 * the matchup week and aggregates per-category expected output. Used in
 * three places:
 *
 *   1. Project my team's expected batter-cat output for the rest of the week
 *   2. Project the opponent's expected batter-cat output (by team_key)
 *   3. Project free-agent candidates one by one (Phase 4 — FA aggregator)
 *
 * The engine is designed around a single per-player primitive
 * (`projectBatterPlayer`). The team aggregator is a thin sum on top of that
 * primitive; the FA path uses the same primitive but keeps per-player detail
 * for the UI.
 *
 * Design rules:
 *   - Talent comes from the existing Bayesian-blended baselines via
 *     `getBatterRating`. We never re-implement the rating math.
 *   - Park / weather / opposing SP / staff ERA / platoon are folded in at the
 *     per-cat layer inside `getBatterRating` — we pass the full context.
 *   - Lineup spot is sourced from a posted-lineup observation when present
 *     (D+0); otherwise the cached prior from `lineupSpots.ts` (D+1+); else
 *     null and the opportunity multiplier degrades to neutral.
 *   - Counting cats are projected as `expected_per_PA × expected_PA`. AVG
 *     uses native `expected` × `expected_AB` (≈ PA × 0.91) to recover an
 *     expected hits count we can blend with YTD.
 */

import { getBatterRating, type Focus, type BatterRating } from '@/lib/mlb/batterRating';
import { resolveMatchup } from '@/lib/mlb/analysis';
import type { EnrichedGame, BatterSeasonStats } from '@/lib/mlb/types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { WeekDay } from '@/lib/dashboard/weekRange';

// ---------------------------------------------------------------------------
// Per-PA → per-game volume conversion
// ---------------------------------------------------------------------------

/**
 * League-average PA per game per batter slot. ~4.1 across MLB; the lineup
 * spot scales this ±8% per the same shape `buildOpportunityMultiplier` uses
 * inside `getBatterRating`.
 */
const BASELINE_PA_PER_GAME = 4.1;

/**
 * Fraction of plate appearances that result in an at-bat. Walks + HBP + SF
 * are ~9% of PA league-wide, so AB ≈ PA × 0.91. Used to convert AVG (a rate
 * over AB) into an expected-hits count we can sum across players to derive
 * a corrected weekly team AVG.
 */
const AB_PER_PA = 0.91;

/**
 * Expected PA per game for a batter at lineup slot `spot` (1-9).
 * Returns BASELINE_PA_PER_GAME when `spot` is null (no signal — neutral).
 *
 * Mirrors `buildOpportunityMultiplier`'s ±8% linear ramp so the rating's
 * opportunity multiplier and the projection's PA volume agree on what
 * lineup spot means.
 */
export function expectedPAperGame(spot: number | null): number {
  if (spot == null || !Number.isFinite(spot) || spot < 1 || spot > 9) {
    return BASELINE_PA_PER_GAME;
  }
  // #1 → +8%, #9 → −8%, linear.
  const pct = 8 - ((spot - 1) / 8) * 16;
  return BASELINE_PA_PER_GAME * (1 + pct / 100);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveBatter {
  mlbId: number;
  name: string;
  teamAbbr: string;
}

export interface ProjectionDeps {
  /** Calendar days to project, typically the week's *remaining* days. */
  days: WeekDay[];
  /** Stats keyed by mlbId. */
  statsByMlbId: Map<number, BatterSeasonStats>;
  /** Per-day game lookup. Each entry's value is the full league slate for
   *  that date, already enriched with park / weather / probable pitchers. */
  gamesByDate: Map<string, EnrichedGame[]>;
  /** Batter-side scored categories (caller filters via `is_batter_stat`). */
  scoredCategories: EnrichedLeagueStatCategory[];
  /** mlbId → cached typical lineup spot (1-9). Missing entries fall back
   *  to the per-day posted lineup (when available) or null (neutral). */
  lineupSpots: Map<number, number>;
  /** Optional focus map. When provided, the per-day score reflects the
   *  user's chase / neutral / punt weights (used by the FA aggregator).
   *  When omitted, default to all-neutral. */
  focusMap?: Record<number, Focus>;
}

export interface PerDayProjection {
  date: string;
  dayLabel: string;
  hasGame: boolean;
  /** True when the team plays a doubleheader on this date. */
  doubleHeader: boolean;
  /** Opposing team abbreviation, or undefined when no game. */
  opponent?: string;
  /** Resolved batting-order spot used for this day (posted lineup if
   *  available, else cached prior, else null). */
  spotUsed: number | null;
  /** Source of the spot — debug aid for the UI tooltip. */
  spotSource: 'posted' | 'cached' | 'none';
  /** Park factor of the venue (overall PF, 100 = neutral). */
  parkFactor?: number;
  /** Probable opposing SP name, when ESPN/MLB has posted it. */
  spName?: string;
  /** Throwing hand of the opposing SP. */
  spThrows?: 'L' | 'R' | 'S';
  /** Weather flag label ("wind out 12mph", "dome", etc.). */
  weatherFlag?: string;
  /** Expected PA across the day's games (game count × PA/game). */
  expectedPA: number;
  /** The full per-game rating, when a context could be resolved. */
  rating: BatterRating | null;
}

export interface PerCategoryProjection {
  statId: number;
  /** Sum across (player, day) of `expected_rate × expected_PA` for counting
   *  cats; for AVG, the expected hits count `expected_AVG × expected_AB`. */
  expectedCount: number;
  /** Aggregated expected PA across the projection window. For AVG this
   *  is the AB sum (PA × 0.91), used as the rate denominator. */
  expectedPA: number;
}

export interface PlayerProjection {
  mlbId: number;
  name: string;
  teamAbbr: string;
  perDay: PerDayProjection[];
  /** Weighted average of per-day ratings (weighted by expected PA). 0 when
   *  the player has no scheduled games. */
  weeklyScore: number;
  /** Sum of per-day expected PA across the projection window. */
  weeklyPA: number;
  /** Per-cat counting / rate projections. */
  byCategory: Map<number, PerCategoryProjection>;
  /** Number of scheduled games (counts doubleheaders as 2). */
  expectedGames: number;
}

export interface TeamProjection {
  /** Sum over players for each scored cat. */
  byCategory: Map<number, PerCategoryProjection>;
  perPlayer: PlayerProjection[];
  /** Number of distinct active players who contributed. */
  contributorCount: number;
}

// ---------------------------------------------------------------------------
// Per-player primitive
// ---------------------------------------------------------------------------

/**
 * Project one batter across the supplied days.
 *
 * Per day:
 *   - Look up the team's games (0 = off day, 1 = normal, 2 = doubleheader).
 *   - For each game, build a `MatchupContext` via `resolveMatchup`.
 *   - Determine batting-order spot: today's posted lineup → cached prior → null.
 *   - Run `getBatterRating` for the contextual score.
 *   - Project counting cats from `categories[].expected × expected_PA`.
 *
 * Aggregates across days into per-cat counting/AB sums plus a PA-weighted
 * weekly score the FA aggregator can rank by.
 */
export function projectBatterPlayer(
  player: ActiveBatter,
  deps: ProjectionDeps,
): PlayerProjection {
  const stats = deps.statsByMlbId.get(player.mlbId) ?? null;
  const focusMap = deps.focusMap ?? {};
  const perDay: PerDayProjection[] = [];
  const byCategory = new Map<number, PerCategoryProjection>();
  let weeklyPA = 0;
  let scoreNumerator = 0;
  let scoreDenominator = 0;
  let expectedGames = 0;

  for (const day of deps.days) {
    const games = deps.gamesByDate.get(day.date) ?? [];
    const teamGames = games.filter(g =>
      g.homeTeam.abbreviation.toUpperCase() === player.teamAbbr.toUpperCase() ||
      g.awayTeam.abbreviation.toUpperCase() === player.teamAbbr.toUpperCase(),
    );

    if (teamGames.length === 0) {
      perDay.push({
        date: day.date,
        dayLabel: day.dayLabel,
        hasGame: false,
        doubleHeader: false,
        spotUsed: null,
        spotSource: 'none',
        expectedPA: 0,
        rating: null,
      });
      continue;
    }

    const doubleHeader = teamGames.length >= 2;
    expectedGames += teamGames.length;

    // Resolve spot: posted lineup beats cached prior. We check the first
    // game's posted lineup; if multiple games (DH), the same spot likely
    // applies to both starts.
    const firstGame = teamGames[0];
    const isHomeFirst = firstGame.homeTeam.abbreviation.toUpperCase() === player.teamAbbr.toUpperCase();
    const postedLineup = isHomeFirst ? firstGame.homeLineup : firstGame.awayLineup;
    const postedEntry = postedLineup.find(e => e.mlbId === player.mlbId);
    let spotUsed: number | null = null;
    let spotSource: 'posted' | 'cached' | 'none' = 'none';
    if (postedEntry && postedEntry.battingOrder >= 1 && postedEntry.battingOrder <= 9) {
      spotUsed = postedEntry.battingOrder;
      spotSource = 'posted';
    } else {
      const cached = deps.lineupSpots.get(player.mlbId);
      if (cached != null) {
        spotUsed = cached;
        spotSource = 'cached';
      }
    }

    // Build a matchup context for the rating engine. `resolveMatchup`
    // expects the full slate so it can find this team's game; we already
    // filtered to the team's games but pass the full slate so it follows
    // its own postponement / wiped-game logic.
    const context = resolveMatchup(games, firstGame.park ?? null, player.teamAbbr, {
      hand: stats?.bats ?? null,
      battingOrder: spotUsed,
    });

    if (!context) {
      perDay.push({
        date: day.date,
        dayLabel: day.dayLabel,
        hasGame: true,
        doubleHeader,
        spotUsed,
        spotSource,
        expectedPA: 0,
        rating: null,
      });
      continue;
    }

    const rating = getBatterRating({
      context,
      stats,
      scoredCategories: deps.scoredCategories,
      focusMap,
      battingOrder: spotUsed,
    });

    // Per-game PA × game count for the day.
    const gamePA = expectedPAperGame(spotUsed);
    const dayPA = gamePA * teamGames.length;
    weeklyPA += dayPA;

    // PA-weighted rolling weekly score.
    scoreNumerator += rating.score * dayPA;
    scoreDenominator += dayPA;

    // Per-cat counting projections from rating.categories[].expected.
    for (const cat of rating.categories) {
      const dayAB = cat.statId === 3 ? dayPA * AB_PER_PA : dayPA;
      const dayCount = cat.expected * dayAB;
      const prior = byCategory.get(cat.statId);
      if (prior) {
        prior.expectedCount += dayCount;
        prior.expectedPA += dayAB;
      } else {
        byCategory.set(cat.statId, {
          statId: cat.statId,
          expectedCount: dayCount,
          expectedPA: dayAB,
        });
      }
    }

    const opponentTeam = context.isHome ? context.game.awayTeam : context.game.homeTeam;
    const sp = context.opposingPitcher;
    perDay.push({
      date: day.date,
      dayLabel: day.dayLabel,
      hasGame: true,
      doubleHeader,
      opponent: opponentTeam.abbreviation,
      spotUsed,
      spotSource,
      parkFactor: context.game.park?.parkFactor,
      spName: sp?.name,
      spThrows: sp?.throws,
      weatherFlag: rating.weather.available ? rating.weather.display : undefined,
      expectedPA: dayPA,
      rating,
    });
  }

  return {
    mlbId: player.mlbId,
    name: player.name,
    teamAbbr: player.teamAbbr,
    perDay,
    weeklyPA,
    weeklyScore: scoreDenominator > 0 ? scoreNumerator / scoreDenominator : 0,
    byCategory,
    expectedGames,
  };
}

// ---------------------------------------------------------------------------
// Team aggregator
// ---------------------------------------------------------------------------

/**
 * Project a team's batter-cat output across the supplied days. Calls
 * `projectBatterPlayer` per active batter and sums per-cat counting / AB
 * totals.
 *
 * The caller is responsible for filtering `activeBatters` to actually-active
 * roster slots (i.e. excluding IL/IL+/NA) before passing them in.
 */
export function projectBatterTeam(
  activeBatters: ActiveBatter[],
  deps: ProjectionDeps,
): TeamProjection {
  const perPlayer: PlayerProjection[] = [];
  const teamByCat = new Map<number, PerCategoryProjection>();

  for (const batter of activeBatters) {
    const proj = projectBatterPlayer(batter, deps);
    perPlayer.push(proj);
    for (const [statId, cat] of proj.byCategory) {
      const prior = teamByCat.get(statId);
      if (prior) {
        prior.expectedCount += cat.expectedCount;
        prior.expectedPA += cat.expectedPA;
      } else {
        teamByCat.set(statId, { ...cat });
      }
    }
  }

  return {
    byCategory: teamByCat,
    perPlayer,
    contributorCount: perPlayer.filter(p => p.expectedGames > 0).length,
  };
}
