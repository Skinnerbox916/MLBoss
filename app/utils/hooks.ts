'use client';

import { useState, useEffect } from 'react';
import { CategoryStat } from './stats';

interface UseMatchupStatsResult {
  categories: CategoryStat[];
  opponentName: string;
  week: string | number;
  myScore: string | number;
  opponentScore: string | number;
  myTeamLogo: string | null;
  opponentLogo: string | null;
  wins: number;
  losses: number;
  ties: number;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch matchup statistics from the Yahoo API
 */
export function useMatchupStats(): UseMatchupStatsResult {
  const [data, setData] = useState<{
    categories: CategoryStat[];
    opponentName: string;
    week: string | number;
    myScore: string | number;
    opponentScore: string | number;
    myTeamLogo: string | null;
    opponentLogo: string | null;
    wins: number;
    losses: number;
    ties: number;
  }>({
    categories: [],
    opponentName: '',
    week: '',
    myScore: 0,
    opponentScore: 0,
    myTeamLogo: null,
    opponentLogo: null,
    wins: 8,
    losses: 5,
    ties: 3
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Fetch team data
        const teamRes = await fetch('/api/yahoo/team');
        
        if (!teamRes.ok) {
          throw new Error(`API error: ${teamRes.status}`);
        }
        
        const teamData = await teamRes.json();
        
        if (teamData.error) {
          throw new Error(teamData.error);
        }

        // Create default values if data is missing
        let matchupData = {
          week: 'N/A',
          opponentName: 'No Current Matchup',
          myScore: '0',
          opponentScore: '0',
          categories: [] as CategoryStat[],
          myTeamLogo: null,
          opponentLogo: null,
          wins: 8,
          losses: 5,
          ties: 3
        };
        
        // Extract matchup data if it exists
        if (teamData.team && teamData.team.matchup) {
          matchupData = {
            week: teamData.team.matchup.week || 'N/A',
            opponentName: teamData.team.matchup.opponentName || 'No Current Matchup',
            myScore: teamData.team.matchup.myScore || '0',
            opponentScore: teamData.team.matchup.opponentScore || '0',
            categories: teamData.team.matchup.categories || [],
            myTeamLogo: teamData.team.team_logo || null,
            opponentLogo: teamData.team.matchup.opponentLogo || null,
            wins: teamData.team.matchup.wins || 8,
            losses: teamData.team.matchup.losses || 5, 
            ties: teamData.team.matchup.ties || 3
          };
        }
        
        setData(matchupData);
      } catch (err) {
        console.error('Error fetching matchup data:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return {
    ...data,
    loading,
    error
  };
} 