import { useFantasyContext, type FantasyLeagueContext } from './useFantasyContext';
import { useActiveLeagueKey } from './activeLeagueStore';
import { scoringModeForType, type ScoringMode } from '@/lib/fantasy/scoringMode';

export interface ActiveLeague {
  /** All of the user's leagues this season (for the switcher). */
  leagues: FantasyLeagueContext[];
  leagueKey: string | undefined;
  teamKey: string | undefined;
  scoringType: string | undefined;
  leagueName: string | undefined;
  /** Engine family for the active league — drives which UI a page renders. */
  mode: ScoringMode;
  isLoading: boolean;
  isError: boolean;
}

/**
 * The "active league" a multi-league user is currently looking at. Defaults to
 * the bootstrap `primary_league_key`; a `?league=<leagueKey>` query param
 * overrides it (set by the LeagueSwitcher). This is the minimal seed of the
 * team switcher — `mode` lets a page pick the points vs categories experience
 * from the league list alone, and the full points profile (weights) is
 * re-resolved server-side by `/api/points/*` from the passed `scoringType`.
 */
export function useActiveLeague(): ActiveLeague {
  const ctx = useFantasyContext();
  const override = useActiveLeagueKey() ?? undefined;

  const leagues = ctx.context?.leagues ?? [];
  const activeKey = override && leagues.some(l => l.league_key === override) ? override : ctx.leagueKey;
  const active = leagues.find(l => l.league_key === activeKey);

  return {
    leagues,
    leagueKey: activeKey,
    teamKey: active?.user_team?.team_key ?? ctx.teamKey,
    scoringType: active?.scoring_type,
    leagueName: active?.league_name,
    mode: scoringModeForType(active?.scoring_type),
    isLoading: ctx.isLoading,
    isError: ctx.isError,
  };
}
