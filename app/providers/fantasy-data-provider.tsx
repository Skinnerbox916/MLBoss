'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useLeague } from '@/app/hooks/useLeague';
import { useTeam } from '@/app/hooks/useTeam';

interface FantasyContextState {
  // Core identifiers
  leagueId: string | null;
  teamId: string | null;
  userId: string | null;
  
  // League data
  leagueName: string | null;
  leagueLoading: boolean;
  
  // Team data
  teamName: string | null;
  teamLoading: boolean;
  
  // Actions
  setLeagueId: (id: string) => void;
  setTeamId: (id: string) => void;
  setUserId: (id: string) => void;
}

// Create context with default values
const FantasyDataContext = createContext<FantasyContextState>({
  leagueId: null,
  teamId: null,
  userId: null,
  leagueName: null,
  leagueLoading: false,
  teamName: null,
  teamLoading: false,
  setLeagueId: () => {},
  setTeamId: () => {},
  setUserId: () => {},
});

// Provider component
export function FantasyDataProvider({ children }: { children: ReactNode }) {
  // State for IDs (these could be loaded from localStorage or an API)
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  
  // Get data using base hooks
  const { 
    data: leagueData, 
    isLoading: leagueLoading 
  } = useLeague(leagueId || undefined, { enabled: !!leagueId && isClient });
  
  const { 
    data: teamData, 
    isLoading: teamLoading 
  } = useTeam(teamId || undefined, { enabled: !!teamId && isClient });
  
  // Set isClient when component mounts
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  // Load IDs from localStorage on mount - only on client
  useEffect(() => {
    if (!isClient) return;
    
    // Try to get stored IDs from localStorage
    const storedLeagueId = localStorage.getItem('mlboss_league_id');
    const storedTeamId = localStorage.getItem('mlboss_team_id');
    const storedUserId = localStorage.getItem('mlboss_user_id');
    
    if (storedLeagueId) setLeagueId(storedLeagueId);
    if (storedTeamId) setTeamId(storedTeamId);
    if (storedUserId) setUserId(storedUserId);
  }, [isClient]);
  
  // Persist ID changes to localStorage - only on client
  useEffect(() => {
    if (!isClient) return;
    
    if (leagueId) localStorage.setItem('mlboss_league_id', leagueId);
    if (teamId) localStorage.setItem('mlboss_team_id', teamId);
    if (userId) localStorage.setItem('mlboss_user_id', userId);
  }, [leagueId, teamId, userId, isClient]);
  
  // Value object with all context data
  const value: FantasyContextState = {
    leagueId,
    teamId,
    userId,
    leagueName: leagueData?.name || null,
    leagueLoading: leagueLoading || !isClient,
    teamName: teamData?.name || null,
    teamLoading: teamLoading || !isClient,
    setLeagueId,
    setTeamId,
    setUserId,
  };
  
  return (
    <FantasyDataContext.Provider value={value}>
      {children}
    </FantasyDataContext.Provider>
  );
}

// Custom hook to use the fantasy data context
export function useFantasyData() {
  const context = useContext(FantasyDataContext);
  
  if (context === undefined) {
    throw new Error('useFantasyData must be used within a FantasyDataProvider');
  }
  
  return context;
} 