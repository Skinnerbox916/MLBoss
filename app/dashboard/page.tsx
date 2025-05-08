"use client";
import { useEffect, useState } from 'react';
import { HiChartBar, HiTrendingUp, HiUserGroup, HiCalendar } from 'react-icons/hi';

interface DashboardStats {
  totalPlayers: number;
  activeRoster: number;
  weeklyPoints: number;
  seasonRank: number;
  winPercentage: string;
  streakType: 'win' | 'loss' | 'none';
  streakCount: number;
  nextMatchup: string;
  nextMatchupDate: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real implementation, this would fetch data from your API
    // For now we're just using dummy data with a simulated delay
    const fetchData = async () => {
      setLoading(true);
      // Simulate API call
      setTimeout(() => {
        setStats({
          totalPlayers: 26,
          activeRoster: 21,
          weeklyPoints: 156,
          seasonRank: 3,
          winPercentage: "65.2%",
          streakType: 'win',
          streakCount: 3,
          nextMatchup: "Only Judge Can Judge Me",
          nextMatchupDate: "May 8 - May 14"
        });
        setLoading(false);
      }, 1000);
    };

    fetchData();
  }, []);

  // Function to get ordinal suffix for rank
  const getOrdinalSuffix = (num: number) => {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return num + "st";
    if (j === 2 && k !== 12) return num + "nd";
    if (j === 3 && k !== 13) return num + "rd";
    return num + "th";
  };

  // Helper function to display streak text with appropriate styling
  const getStreakDisplay = () => {
    if (!stats) return null;
    
    const color = stats.streakType === 'win' ? 'text-green-600' : 'text-red-600';
    const prefix = stats.streakType === 'win' ? 'W' : 'L';
    
    return (
      <span className={color}>
        {stats.streakType === 'none' ? 'No Streak' : `${prefix}${stats.streakCount}`}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
      
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-md p-6 animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/2 mb-4"></div>
              <div className="h-10 bg-gray-200 rounded w-1/3"></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Season Stats Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Season Stats</h2>
                <HiChartBar className="h-6 w-6 text-purple-600" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Current Rank:</span>
                  <span className="font-bold text-purple-700">{getOrdinalSuffix(stats?.seasonRank ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Win Percentage:</span>
                  <span className="font-bold">{stats?.winPercentage}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Current Streak:</span>
                  <span className="font-bold">{getStreakDisplay()}</span>
                </div>
              </div>
            </div>
            
            {/* Team Status Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Team Status</h2>
                <HiUserGroup className="h-6 w-6 text-blue-600" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total Players:</span>
                  <span className="font-bold">{stats?.totalPlayers}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Active Roster:</span>
                  <span className="font-bold">{stats?.activeRoster}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Injured List:</span>
                  <span className="font-bold">{(stats?.totalPlayers ?? 0) - (stats?.activeRoster ?? 0)}</span>
                </div>
              </div>
            </div>
            
            {/* Weekly Performance Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Weekly Performance</h2>
                <HiTrendingUp className="h-6 w-6 text-green-600" />
              </div>
              <div className="flex flex-col">
                <span className="text-3xl font-bold text-green-600">{stats?.weeklyPoints}</span>
                <span className="text-gray-600 mt-1">Fantasy Points</span>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="text-sm text-gray-600">
                    <span className="inline-block w-3 h-3 rounded-full bg-green-500 mr-2"></span>
                    12% increase from last week
                  </div>
                </div>
              </div>
            </div>
            
            {/* Upcoming Matchup Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Upcoming Matchup</h2>
                <HiCalendar className="h-6 w-6 text-orange-600" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-gray-800 line-clamp-1">{stats?.nextMatchup}</span>
                <span className="text-gray-600 mt-1">{stats?.nextMatchupDate}</span>
                <button className="mt-4 text-purple-600 text-sm font-medium hover:text-purple-800">
                  View Matchup Details →
                </button>
              </div>
            </div>
          </div>
          
          {/* Recent Activity */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Recent Activity</h2>
            <div className="space-y-4">
              <div className="flex items-start">
                <div className="rounded-full bg-blue-100 p-2 mr-4">
                  <svg className="h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium">Added <span className="text-blue-600">Bryce Harper (PHI - 1B,OF,DH)</span></p>
                  <p className="text-xs text-gray-500">Today, 10:23 AM</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <div className="rounded-full bg-red-100 p-2 mr-4">
                  <svg className="h-4 w-4 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium">Dropped <span className="text-red-600">Carlos Correa (MIN - SS)</span></p>
                  <p className="text-xs text-gray-500">Today, 10:22 AM</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <div className="rounded-full bg-purple-100 p-2 mr-4">
                  <svg className="h-4 w-4 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m-8 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium">Trade Completed with <span className="text-purple-600">Cruel Summer</span></p>
                  <p className="text-xs text-gray-500">Yesterday, 3:45 PM</p>
                </div>
              </div>
            </div>
            <button className="mt-4 text-sm text-purple-600 font-medium hover:text-purple-800">
              View All Activity →
            </button>
          </div>
        </>
      )}
    </div>
  );
} 
