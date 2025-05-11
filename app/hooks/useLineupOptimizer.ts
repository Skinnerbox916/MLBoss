'use client';

import { useQuery } from '@tanstack/react-query';
import { useTeamRoster } from './useTeam';
import { usePlayerStats } from './usePlayer';
import { useFantasyData } from '@/app/providers/fantasy-data-provider';
import { yahooServices } from '@/app/services/yahoo';
import type { YahooPlayer, YahooTeam } from '@/app/types/yahoo';

// Add type definitions for lineup optimizer
interface OptimizedLineupSuggestion {
  playerId: string;
  name: string;
  position: string;
  currentSlot: string;
  suggestedSlot: string;
  reason: string;
  projectedPoints: number;
}

interface UseLineupOptimizerResult {
  optimizedLineup: OptimizedLineupSuggestion[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Composite hook that combines roster and player stats data
 * to suggest an optimized lineup
 */
export function useLineupOptimizer(date?: string): UseLineupOptimizerResult {
  // Get team ID from context
  const { teamId } = useFantasyData();
  
  // Get current roster
  const {
    data: roster,
    isLoading: rosterLoading,
    isError: rosterError,
    error: rosterErrorDetails,
    refetch: refetchRoster
  } = useTeamRoster(teamId || undefined, date);
  
  // Get player IDs from roster
  const players = roster?.roster?.players || [];
  const playerIds = players.map((player: YahooPlayer) => player.player_id) || [];
  
  // Get stats for each player (this would need to be optimized in production)
  // Ideally, you'd batch fetch player stats rather than doing individual queries
  const playerStatsQueries = useQuery({
    queryKey: ['playerStats', teamId, date, playerIds.join(',')],
    queryFn: async () => {
      if (!playerIds.length) return [];
      
      // This is a simplified example - in production, you'd want to batch this
      const statsPromises = playerIds.map((playerId: string) => 
        yahooServices.player.getPlayerStats(playerId)
      );
      
      return Promise.all(statsPromises);
    },
    enabled: !!teamId && playerIds.length > 0 && !rosterLoading,
  });
  
  // Combine roster and stats to generate lineup suggestions
  const optimizerQuery = useQuery({
    queryKey: ['lineupOptimizer', teamId, date, playerIds.join(',')],
    queryFn: async () => {
      if (!roster?.roster?.players || !playerStatsQueries.data) {
        return [];
      }
      
      // In a real implementation, this would contain complex logic to optimize lineups
      // based on matchups, player performance, schedule, etc.
      const optimizedSuggestions: OptimizedLineupSuggestion[] = roster.roster.players
        .map((player: YahooPlayer, index: number) => {
          const stats = playerStatsQueries.data[index];
          
          // This is placeholder logic - real optimization would be more sophisticated
          // For example, it would consider:
          // - Player's recent performance
          // - Matchup difficulty
          // - Schedule (number of games in period)
          // - Position eligibility and roster constraints
          
          return {
            playerId: player.player_id,
            name: player.name.full,
            position: player.display_position,
            currentSlot: player.selected_position?.position || 'BN',
            // Simplified suggestion (just an example)
            suggestedSlot: player.selected_position?.position || 'BN',
            reason: "Optimal based on current stats",
            // Safely cast/calculate projected points - using a placeholder value
            projectedPoints: 0
          };
        })
        .filter((suggestion: OptimizedLineupSuggestion) => 
          suggestion.currentSlot !== suggestion.suggestedSlot
        );
        
      return optimizedSuggestions;
    },
    enabled: !!playerStatsQueries.data && !playerStatsQueries.isLoading,
  });
  
  return {
    optimizedLineup: optimizerQuery.data || [],
    isLoading: rosterLoading || playerStatsQueries.isLoading || optimizerQuery.isLoading,
    isError: rosterError || playerStatsQueries.isError || optimizerQuery.isError,
    error: rosterErrorDetails || playerStatsQueries.error || optimizerQuery.error,
    refetch: () => {
      refetchRoster();
      playerStatsQueries.refetch();
      optimizerQuery.refetch();
    }
  };
} 