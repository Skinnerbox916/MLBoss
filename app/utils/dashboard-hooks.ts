'use client';

import { useState, useEffect } from 'react';

export interface LineupIssues {
  startersWithNoGames: number;
  ilOutOfIlSpot: number;
  dtdStarting: number;
  openSlots: number;
  availableSwaps: number;
}

export interface UpcomingMatchup {
  opponent: string;
  dateRange: string;
}

export interface ActivityItem {
  type: 'add' | 'drop' | 'trade';
  player?: string;
  team?: string;
  timestamp: string;
}

export interface PlayerUpdate {
  player: string;
  update: string;
  timestamp: string;
}

export interface WaiverInfo {
  priority: number;
  weeklyAdds: number;
  weeklyLimit: number;
}

export interface DashboardData {
  lineupIssues: LineupIssues;
  upcomingMatchup: UpcomingMatchup;
  recentActivity: ActivityItem[];
  playerUpdates: PlayerUpdate[];
  waiver: WaiverInfo;
}

interface UseDashboardDataResult {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  refreshData: () => Promise<void>;
}

/**
 * Hook to fetch all dashboard data in one place
 * This centralizes data fetching for all dashboard components
 */
export function useDashboardData(): UseDashboardDataResult {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // In a real implementation, fetch data from API
      // For now using dummy data with simulated delay
      
      // This would be replaced with actual API calls:
      // const lineupRes = await fetch('/api/lineup/issues');
      // const activityRes = await fetch('/api/activity/recent');
      // etc.
      
      setTimeout(() => {
        setData({
          lineupIssues: {
            startersWithNoGames: 2,
            ilOutOfIlSpot: 1,
            dtdStarting: 1,
            openSlots: 2,
            availableSwaps: 1
          },
          upcomingMatchup: {
            opponent: "Only Judge Can Judge Me",
            dateRange: "May 8 - May 14"
          },
          recentActivity: [
            {
              type: 'add',
              player: 'Bryce Harper (PHI - 1B,OF,DH)',
              timestamp: 'Today, 10:23 AM'
            },
            {
              type: 'drop',
              player: 'Carlos Correa (MIN - SS)',
              timestamp: 'Today, 10:22 AM'
            },
            {
              type: 'trade',
              team: 'Cruel Summer',
              timestamp: 'Yesterday, 3:45 PM'
            }
          ],
          playerUpdates: [
            {
              player: 'Juan Soto (NYY - OF)',
              update: 'Day-to-Day - Back stiffness',
              timestamp: 'Today, 2:15 PM'
            },
            {
              player: 'Freddie Freeman (LAD - 1B)',
              update: 'No longer DTD - Expected to start tonight',
              timestamp: 'Today, 12:30 PM'
            },
            {
              player: 'Spencer Strider (ATL - SP)',
              update: 'Moved to 60-day IL - Tommy John surgery',
              timestamp: 'Yesterday, 4:45 PM'
            }
          ],
          waiver: {
            priority: 8,
            weeklyAdds: 3,
            weeklyLimit: 6
          }
        });
        setLoading(false);
      }, 1000);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  };

  // Fetch data on initial load
  useEffect(() => {
    fetchData();
  }, []);

  return {
    data,
    loading,
    error,
    refreshData: fetchData
  };
} 