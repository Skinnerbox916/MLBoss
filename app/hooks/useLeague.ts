'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { yahooServices } from '@/app/services/yahoo';

/**
 * Key factory for league-related queries
 */
const leagueKeys = {
  all: ['leagues'] as const,
  details: () => [...leagueKeys.all, 'detail'] as const,
  detail: (leagueId: string) => [...leagueKeys.details(), leagueId] as const,
  standings: (leagueId: string) => [...leagueKeys.detail(leagueId), 'standings'] as const,
  scoreboard: (leagueId: string, week?: number) => 
    [...leagueKeys.detail(leagueId), 'scoreboard', week || 'current'] as const,
  transactions: (leagueId: string, types?: string[]) => 
    [...leagueKeys.detail(leagueId), 'transactions', types?.join(',') || 'all'] as const,
};

/**
 * Hook to get league details
 * 
 * @param leagueId - Yahoo league ID (e.g., "422.l.12345")
 * @param options - Additional options for the query
 */
export function useLeague(leagueId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: leagueId ? leagueKeys.detail(leagueId) : leagueKeys.details(),
    queryFn: () => yahooServices.league.getLeague(leagueId),
    enabled: (options.enabled !== false),
    // League data doesn't change often, so we can cache it longer
    staleTime: 30 * 60 * 1000, // 30 minutes
  });
}

/**
 * Hook to get league standings
 * 
 * @param leagueId - Yahoo league ID
 * @param options - Additional options for the query
 */
export function useLeagueStandings(
  leagueId?: string,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: leagueId ? leagueKeys.standings(leagueId) : leagueKeys.details(),
    queryFn: () => yahooServices.league.getLeagueStandings(leagueId),
    enabled: !!leagueId && (options.enabled !== false),
    // Standings change daily, so moderate cache time
    staleTime: 15 * 60 * 1000, // 15 minutes
  });
}

/**
 * Hook to get league scoreboard
 * 
 * @param leagueId - Yahoo league ID
 * @param week - Optional week number for historical scoreboards
 * @param options - Additional options for the query
 */
export function useLeagueScoreboard(
  leagueId?: string,
  week?: number,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: leagueId ? leagueKeys.scoreboard(leagueId, week) : leagueKeys.details(),
    queryFn: () => yahooServices.league.getLeagueScoreboard(leagueId, week),
    enabled: !!leagueId && (options.enabled !== false),
    // Scoreboard changes frequently, so shorter cache time
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to get league transactions
 * 
 * @param leagueId - Yahoo league ID
 * @param types - Transaction types to include (add, drop, trade, etc.)
 * @param count - Number of transactions to return
 * @param options - Additional options for the query
 */
export function useLeagueTransactions(
  leagueId?: string,
  types?: string[],
  count: number = 10,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: leagueId ? 
      [...leagueKeys.transactions(leagueId, types), count] : 
      leagueKeys.details(),
    queryFn: () => yahooServices.league.getLeagueTransactions(leagueId, types, count),
    enabled: !!leagueId && (options.enabled !== false),
    // Transactions can happen anytime, so short cache time
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to invalidate league data (force refresh)
 */
export function useInvalidateLeagueData() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (leagueId?: string) => {
      if (leagueId) {
        // If league ID is provided, invalidate just that league
        return Promise.resolve(queryClient.invalidateQueries({ queryKey: leagueKeys.detail(leagueId) }));
      } else {
        // Otherwise invalidate all league data
        return Promise.resolve(queryClient.invalidateQueries({ queryKey: leagueKeys.all }));
      }
    }
  });
} 