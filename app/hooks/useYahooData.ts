'use client';

import { useState, useEffect, useCallback } from 'react';
import { yahooServices } from '@/app/services/yahoo';

/**
 * Generic hook for fetching data from Yahoo Fantasy API services
 * 
 * @param fetchFn - Async function that fetches data using Yahoo services
 * @param deps - Dependency array that triggers refetch when changed (like useEffect)
 * @param options - Configuration options
 * @returns Object with data, loading state, error state, and refresh function
 */
export function useYahooData<T>(
  fetchFn: () => Promise<T>,
  deps: any[] = [],
  options: {
    initialData?: T;
    skipInitialFetch?: boolean;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
  } = {}
) {
  const [data, setData] = useState<T | undefined>(options.initialData);
  const [loading, setLoading] = useState(!options.skipInitialFetch);
  const [error, setError] = useState<Error | null>(null);

  // Function to fetch data that can be called manually or automatically
  const fetchData = useCallback(async () => {
    if (options.skipInitialFetch) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await fetchFn();
      setData(result);
      if (options.onSuccess) {
        options.onSuccess(result);
      }
    } catch (err) {
      console.error('Error fetching Yahoo data:', err);
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
      if (options.onError) {
        options.onError(errorObj);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchFn, options.skipInitialFetch, options.onSuccess, options.onError]);

  // Automatically fetch data on mount and when dependencies change
  useEffect(() => {
    fetchData();
  }, [fetchData, ...deps]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
}

/**
 * Hook to get player data
 */
export function usePlayer(playerKey: string) {
  return useYahooData(
    () => yahooServices.player.getPlayer(playerKey),
    [playerKey]
  );
}

/**
 * Hook to get player stats
 */
export function usePlayerStats(
  playerKey: string, 
  statsType: string = 'season',
  statsValue: string = new Date().getFullYear().toString()
) {
  return useYahooData(
    () => yahooServices.player.getPlayerStats(playerKey, statsType, statsValue),
    [playerKey, statsType, statsValue]
  );
}

/**
 * Hook to get current team data
 */
export function useTeam(teamKey?: string) {
  return useYahooData(
    () => yahooServices.team.getTeam(teamKey),
    [teamKey]
  );
}

/**
 * Hook to get team roster
 */
export function useTeamRoster(teamKey?: string, date?: string) {
  return useYahooData(
    () => yahooServices.team.getTeamRoster(teamKey, date),
    [teamKey, date]
  );
}

/**
 * Hook to get current matchup
 */
export function useCurrentMatchup(teamKey?: string) {
  return useYahooData(
    () => yahooServices.team.getCurrentMatchup(teamKey),
    [teamKey]
  );
}

/**
 * Hook to get league data
 */
export function useLeague(leagueKey?: string) {
  return useYahooData(
    () => yahooServices.league.getLeague(leagueKey),
    [leagueKey]
  );
}

/**
 * Hook to get league standings
 */
export function useLeagueStandings(leagueKey?: string) {
  return useYahooData(
    () => yahooServices.league.getLeagueStandings(leagueKey),
    [leagueKey]
  );
}

/**
 * Hook to get current league scoreboard
 */
export function useLeagueScoreboard(leagueKey?: string, week?: number) {
  return useYahooData(
    () => yahooServices.league.getLeagueScoreboard(leagueKey, week),
    [leagueKey, week]
  );
}

/**
 * Hook to search for players
 */
export function usePlayerSearch(query: string, count: number = 25) {
  return useYahooData(
    () => yahooServices.player.searchPlayers(query, count),
    [query, count],
    { skipInitialFetch: !query, initialData: [] }
  );
}

/**
 * Hook to get recent league transactions
 */
export function useLeagueTransactions(
  leagueKey?: string, 
  types?: string[], 
  count: number = 10
) {
  return useYahooData(
    () => yahooServices.league.getLeagueTransactions(leagueKey, types, count),
    [leagueKey, types?.join(','), count],
    { initialData: [] }
  );
} 