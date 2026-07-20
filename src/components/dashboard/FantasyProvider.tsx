'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useFantasyContext, type FantasyContext } from '@/lib/hooks/useFantasyContext';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';

interface FantasyContextValue {
  context: FantasyContext | undefined;
  leagueKey: string | undefined;
  teamKey: string | undefined;
  currentWeek: string | undefined;
  scoringProfile: ScoringProfile | undefined;
  isLoading: boolean;
  isError: boolean;
}

const FantasyCtx = createContext<FantasyContextValue>({
  context: undefined,
  leagueKey: undefined,
  teamKey: undefined,
  currentWeek: undefined,
  scoringProfile: undefined,
  isLoading: true,
  isError: false,
});

/**
 * League/team keys for dashboard cards — resolved from the ACTIVE league
 * (account-menu switcher selection, falling back to the primary league),
 * so the same cards serve both mode dashboards. Costs no extra fetch:
 * `useActiveLeague` reads the same SWR-deduped `/api/fantasy/context`.
 *
 * `scoringProfile` is only resolved for the primary league by the
 * bootstrap; cards needing another league's weights use `useScoringProfile`.
 */
export function FantasyProvider({ children }: { children: ReactNode }) {
  const ctx = useFantasyContext();
  const { leagueKey, teamKey } = useActiveLeague();
  const active = ctx.context?.leagues?.find(l => l.league_key === leagueKey);
  const value: FantasyContextValue = {
    context: ctx.context,
    leagueKey,
    teamKey,
    currentWeek: active?.current_week,
    scoringProfile: leagueKey === ctx.context?.primary_league_key ? ctx.scoringProfile : undefined,
    isLoading: ctx.isLoading,
    isError: ctx.isError,
  };
  return <FantasyCtx.Provider value={value}>{children}</FantasyCtx.Provider>;
}

export function useFantasy() {
  return useContext(FantasyCtx);
}
