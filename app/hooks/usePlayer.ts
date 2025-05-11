'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { yahooServices } from '@/app/services/yahoo';

/**
 * Key factory for player-related queries
 */
const playerKeys = {
  all: ['players'] as const,
  lists: () => [...playerKeys.all, 'list'] as const,
  list: (filters: string) => [...playerKeys.lists(), { filters }] as const,
  details: () => [...playerKeys.all, 'detail'] as const,
  detail: (playerId: string) => [...playerKeys.details(), playerId] as const,
  stats: (playerId: string, statsType: string, statsValue: string) => 
    [...playerKeys.detail(playerId), 'stats', statsType, statsValue] as const,
};

/**
 * Hook to get player details
 * 
 * @param playerId - Yahoo player ID (e.g., "422.p.8967")
 * @param options - Additional options for the query
 */
export function usePlayer(playerId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: playerId ? playerKeys.detail(playerId) : playerKeys.details(),
    queryFn: () => yahooServices.player.getPlayer(playerId!),
    enabled: !!playerId && (options.enabled !== false),
  });
}

/**
 * Hook to get player stats
 * 
 * @param playerId - Yahoo player ID
 * @param statsType - Type of stats (season, lastmonth, lastweek, etc.)
 * @param statsValue - Value for the stats type (year, date, etc.)
 * @param options - Additional options for the query
 */
export function usePlayerStats(
  playerId?: string,
  statsType: string = 'season',
  statsValue: string = new Date().getFullYear().toString(),
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: playerId 
      ? playerKeys.stats(playerId, statsType, statsValue) 
      : playerKeys.details(),
    queryFn: () => yahooServices.player.getPlayerStats(playerId!, statsType, statsValue),
    enabled: !!playerId && (options.enabled !== false),
  });
}

/**
 * Hook to search for players
 * 
 * @param query - Search query string
 * @param count - Number of results to return
 * @param options - Additional options for the query
 */
export function usePlayerSearch(
  query: string,
  count: number = 25,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: playerKeys.list(`search:${query}:${count}`),
    queryFn: () => yahooServices.player.searchPlayers(query, count),
    enabled: !!query && query.length > 2 && (options.enabled !== false),
  });
}

/**
 * Hook to invalidate player data (force refresh)
 */
export function useInvalidatePlayerData() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (playerId?: string) => {
      if (playerId) {
        // If player ID is provided, invalidate just that player
        return Promise.resolve(queryClient.invalidateQueries({ queryKey: playerKeys.detail(playerId) }));
      } else {
        // Otherwise invalidate all player data
        return Promise.resolve(queryClient.invalidateQueries({ queryKey: playerKeys.all }));
      }
    }
  });
} 