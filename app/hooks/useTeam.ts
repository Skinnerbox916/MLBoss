'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { yahooServices } from '@/app/services/yahoo';

/**
 * Key factory for team-related queries
 */
const teamKeys = {
  all: ['teams'] as const,
  lists: () => [...teamKeys.all, 'list'] as const,
  list: (leagueId: string) => [...teamKeys.lists(), leagueId] as const,
  details: () => [...teamKeys.all, 'detail'] as const,
  detail: (teamId: string) => [...teamKeys.details(), teamId] as const,
  roster: (teamId: string, date?: string) => 
    [...teamKeys.detail(teamId), 'roster', date || 'current'] as const,
  matchup: (teamId: string, week?: number) => 
    [...teamKeys.detail(teamId), 'matchup', week || 'current'] as const,
};

/**
 * Hook to get team details
 * 
 * @param teamId - Yahoo team ID (e.g., "422.l.12345.t.1")
 * @param options - Additional options for the query
 */
export function useTeam(teamId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: teamId ? teamKeys.detail(teamId) : teamKeys.details(),
    queryFn: () => yahooServices.team.getTeam(teamId),
    enabled: (options.enabled !== false),
  });
}

/**
 * Hook to get team roster
 * 
 * @param teamId - Yahoo team ID 
 * @param date - Optional date string for historical roster (YYYY-MM-DD)
 * @param options - Additional options for the query
 */
export function useTeamRoster(
  teamId?: string,
  date?: string,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: teamId ? teamKeys.roster(teamId, date) : teamKeys.details(),
    queryFn: () => yahooServices.team.getTeamRoster(teamId, date),
    enabled: !!teamId && (options.enabled !== false),
  });
}

/**
 * Hook to get team's current matchup
 * 
 * @param teamId - Yahoo team ID
 * @param options - Additional options for the query
 */
export function useCurrentMatchup(
  teamId?: string,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: teamId ? teamKeys.matchup(teamId) : teamKeys.details(),
    queryFn: () => yahooServices.team.getCurrentMatchup(teamId),
    enabled: !!teamId && (options.enabled !== false),
  });
}

/**
 * Hook to get a specific matchup by week
 * 
 * @param teamId - Yahoo team ID
 * @param week - Week number
 * @param options - Additional options for the query
 */
export function useWeeklyMatchup(
  teamId?: string,
  week?: number,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: teamId && week ? teamKeys.matchup(teamId, week) : teamKeys.details(),
    queryFn: () => yahooServices.team.getCurrentMatchup(teamId),
    enabled: !!teamId && !!week && (options.enabled !== false),
  });
}

/**
 * Hook to invalidate team data (force refresh)
 */
export function useInvalidateTeamData() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (teamId?: string) => {
      if (teamId) {
        // If team ID is provided, invalidate just that team
        return Promise.resolve(queryClient.invalidateQueries({ queryKey: teamKeys.detail(teamId) }));
      } else {
        // Otherwise invalidate all team data
        return Promise.resolve(queryClient.invalidateQueries({ queryKey: teamKeys.all }));
      }
    }
  });
} 