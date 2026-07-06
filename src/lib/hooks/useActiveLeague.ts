import { useFantasyContext, type FantasyLeagueContext } from './useFantasyContext';
import { useActiveLeagueKey } from './activeLeagueStore';
import {
  scoringModeForType,
  lineupCadenceForDeadline,
  moveTimingForDeadline,
  type ScoringMode,
  type LineupCadence,
  type RosterMoveTiming,
} from '@/lib/fantasy/scoringMode';
import { resolveEarliestPlayableDate } from '@/lib/dashboard/weekRange';

export interface ActiveLeague {
  /** All of the user's leagues this season (for the switcher). */
  leagues: FantasyLeagueContext[];
  leagueKey: string | undefined;
  teamKey: string | undefined;
  scoringType: string | undefined;
  leagueName: string | undefined;
  /** Engine family for the active league — drives which UI a page renders. */
  mode: ScoringMode;
  /** Daily lineup changes vs lineups locked for the week (Yahoo `weekly_deadline`). */
  lineupCadence: LineupCadence;
  /** When a roster move made now takes effect (immediate / next-day / weekly). */
  moveTiming: RosterMoveTiming;
  /** Earliest date (YYYY-MM-DD) a pickup made now can play — the streaming
   *  window floor. Derived from Yahoo `edit_key`, falling back to timing. */
  earliestPlayableDate: string;
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
    lineupCadence: lineupCadenceForDeadline(active?.weekly_deadline),
    moveTiming: moveTimingForDeadline(active?.weekly_deadline),
    earliestPlayableDate: resolveEarliestPlayableDate({
      editKey: active?.edit_key,
      weeklyDeadline: active?.weekly_deadline,
    }),
    isLoading: ctx.isLoading,
    isError: ctx.isError,
  };
}
