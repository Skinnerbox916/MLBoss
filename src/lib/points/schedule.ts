/**
 * Schedule-aware volume resolution for points forecasts.
 *
 * Phase 1 gives the per-PA / per-IP points RATE. Phase 2 multiplies it by how
 * much a player actually plays over a horizon (a set of calendar days):
 *   - Batters: games his team plays × expected PA/game (lineup-spot aware).
 *   - Starters: probable starts matched on the day's slate × IP/start.
 *   - Relievers: appearances ≈ role pace scaled to the horizon length.
 *
 * Reuses the same primitives the categories projection engines use
 * (`expectedPAperGame`, `isLikelySamePlayer`, `normalizeTeamAbbr`) so points
 * and categories agree on "how many games / starts" a player gets. Matchup
 * QUALITY (park / opp SP / weather) is intentionally NOT applied here — that's
 * the Phase 3 lineup-optimizer's job; over a week, volume dominates value in
 * points leagues.
 */

import type { EnrichedGame } from '@/lib/mlb/types';
import type { WeekDay } from '@/lib/dashboard/weekRange';
import { normalizeTeamAbbr } from '@/lib/mlb/teamAbbr';
import { isLikelySamePlayer } from '@/lib/pitching/display';
import { expectedPAperGame } from '@/lib/projection/batterTeam';

/** Typical reliever appearances per 7-day week when role data is missing. */
const DEFAULT_RP_APPEARANCES_PER_WEEK = 3.0;
/** Typical reliever IP per appearance when role data is missing. */
const DEFAULT_RP_IP_PER_APPEARANCE = 1.0;

export interface BatterVolume {
  games: number;
  expectedPA: number;
}

export interface PitcherStartVolume {
  starts: number;
  expectedIP: number;
}

export interface ReliefVolume {
  appearances: number;
  expectedIP: number;
}

function teamPlaysCount(games: EnrichedGame[], teamAbbr: string): number {
  const t = normalizeTeamAbbr(teamAbbr);
  if (!t) return 0;
  return games.filter(
    g =>
      normalizeTeamAbbr(g.homeTeam.abbreviation) === t ||
      normalizeTeamAbbr(g.awayTeam.abbreviation) === t,
  ).length;
}

/**
 * Count a batter's games over the horizon and the expected PA (game count ×
 * lineup-spot-adjusted PA/game). Doubleheaders count as 2 games.
 */
export function resolveBatterVolume(
  teamAbbr: string,
  lineupSpot: number | null,
  gamesByDate: Map<string, EnrichedGame[]>,
  days: WeekDay[],
): BatterVolume {
  const paPerGame = expectedPAperGame(lineupSpot);
  let games = 0;
  for (const day of days) {
    games += teamPlaysCount(gamesByDate.get(day.date) ?? [], teamAbbr);
  }
  return { games, expectedPA: games * paPerGame };
}

/**
 * Count a starter's probable starts over the horizon (matched by name against
 * each day's slate) and the expected IP (starts × IP/start).
 */
export function resolvePitcherStartVolume(
  name: string,
  teamAbbr: string,
  ipPerStart: number,
  gamesByDate: Map<string, EnrichedGame[]>,
  days: WeekDay[],
): PitcherStartVolume {
  const t = normalizeTeamAbbr(teamAbbr);
  let starts = 0;
  for (const day of days) {
    const games = gamesByDate.get(day.date) ?? [];
    for (const g of games) {
      const isHome = normalizeTeamAbbr(g.homeTeam.abbreviation) === t;
      const isAway = normalizeTeamAbbr(g.awayTeam.abbreviation) === t;
      if (!isHome && !isAway) continue;
      const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
      if (pp && isLikelySamePlayer(name, pp.name)) starts += 1;
    }
  }
  return { starts, expectedIP: starts * ipPerStart };
}

/**
 * Estimate a reliever's appearances over the horizon from role pace, scaled
 * to the horizon length (relievers don't appear on probable lists, so there's
 * no per-day match to count). `days.length` is the horizon in calendar days.
 */
export function resolveReliefVolume(
  appearancesPerWeek: number | null,
  ipPerAppearance: number | null,
  days: WeekDay[],
): ReliefVolume {
  const horizonFraction = days.length / 7;
  const appearances = (appearancesPerWeek ?? DEFAULT_RP_APPEARANCES_PER_WEEK) * horizonFraction;
  const ipApp = ipPerAppearance ?? DEFAULT_RP_IP_PER_APPEARANCE;
  return { appearances, expectedIP: appearances * ipApp };
}
