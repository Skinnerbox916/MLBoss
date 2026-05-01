import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { ProbablePitcher } from '@/lib/mlb/types';
import { normalizeTeamAbbr, lastNameKey, isPitcher } from '@/lib/pitching/display';

/**
 * Minimal game shape needed for matching a rostered pitcher to a probable
 * start. Decoupled from `EnrichedGame` so this matcher works for any caller
 * that has an `MLBGame`-shaped collection.
 */
export interface ProbableMatchGame {
  homeTeam: { abbreviation: string };
  awayTeam: { abbreviation: string };
  homeProbablePitcher: ProbablePitcher | null;
  awayProbablePitcher: ProbablePitcher | null;
}

export interface MatchedProbable {
  player: RosterEntry;
  pitcher: ProbablePitcher;
  /** True when the pitcher's MLB team is the home team in this game. */
  isHome: boolean;
  /** Opposing team abbreviation (the team the pitcher is throwing against). */
  opponentAbbr: string;
}

/**
 * Match each rostered pitcher to a probable start in the given games list.
 *
 * Used by both the dashboard's `BossCard` (multi-day weekly runway) and the
 * `OpponentStatusCard` scouting widget (today + tomorrow). Centralizing the
 * matcher keeps abbreviation aliasing (CHW/CWS, KCR/KC, etc.) and last-name
 * normalization in one place.
 */
export function matchProbableStarts<G extends ProbableMatchGame>(
  roster: RosterEntry[],
  games: G[],
): MatchedProbable[] {
  const pitchers = roster.filter(isPitcher);
  if (pitchers.length === 0 || games.length === 0) return [];

  const results: MatchedProbable[] = [];
  const matchedPlayerKeys = new Set<string>();

  for (const player of pitchers) {
    if (matchedPlayerKeys.has(player.player_key)) continue;
    const teamAbbr = normalizeTeamAbbr(player.editorial_team_abbr);
    const lastKey = lastNameKey(player.name);
    if (!teamAbbr || !lastKey) continue;

    for (const g of games) {
      const homeAbbr = normalizeTeamAbbr(g.homeTeam.abbreviation);
      const awayAbbr = normalizeTeamAbbr(g.awayTeam.abbreviation);
      const isHome = homeAbbr === teamAbbr;
      const isAway = awayAbbr === teamAbbr;
      if (!isHome && !isAway) continue;

      const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
      if (!pp) continue;
      if (lastNameKey(pp.name) !== lastKey) continue;

      results.push({
        player,
        pitcher: pp,
        isHome,
        opponentAbbr: isHome ? g.awayTeam.abbreviation : g.homeTeam.abbreviation,
      });
      matchedPlayerKeys.add(player.player_key);
      break;
    }
  }
  return results;
}
