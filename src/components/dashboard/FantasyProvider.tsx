'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useFantasyContext, type FantasyContext } from '@/lib/hooks/useFantasyContext';

interface FantasyContextValue {
  context: FantasyContext | undefined;
  leagueKey: string | undefined;
  teamKey: string | undefined;
  currentWeek: string | undefined;
  isLoading: boolean;
  isError: boolean;
}

const FantasyCtx = createContext<FantasyContextValue>({
  context: undefined,
  leagueKey: undefined,
  teamKey: undefined,
  currentWeek: undefined,
  isLoading: true,
  isError: false,
});

export function FantasyProvider({ children }: { children: ReactNode }) {
  const value = useFantasyContext();
  return <FantasyCtx.Provider value={value}>{children}</FantasyCtx.Provider>;
}

export function useFantasy() {
  return useContext(FantasyCtx);
}
