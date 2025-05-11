"use client";
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMatchupStats } from '../utils/hooks';
import { useDashboardData } from '../utils/dashboard-hooks';
import { processCategoryStats, groupCategoriesByType } from '@/app/utils/stats';

// Import all the card components
import MatchupScoreCard from './components/MatchupScoreCard';
import BattingCategoryCard from './components/BattingCategoryCard';
import PitchingCategoryCard from './components/PitchingCategoryCard';
import LineupIssuesCard from './components/LineupIssuesCard';
import RecentActivityCard from './components/RecentActivityCard';
import PlayerUpdatesCard from './components/PlayerUpdatesCard';
import WaiversCard from './components/WaiversCard';
import NextWeekCard from './components/NextWeekCard';

export default function Dashboard() {
  const router = useRouter();
  
  // Get matchup data from matchup hook
  const { 
    categories, 
    opponentName, 
    myScore, 
    opponentScore,
    myTeamLogo,
    opponentLogo,
    wins,
    losses,
    ties,
    loading: matchupLoading 
  } = useMatchupStats();

  // Get all dashboard data from central dashboard hook
  const {
    data: dashboardData,
    loading: dashboardLoading,
    error: dashboardError,
    refreshData
  } = useDashboardData();

  // Group categories into batting and pitching
  const processedCategories = useMemo(() => processCategoryStats(categories), [categories]);
  const groupedStats = useMemo(() => groupCategoriesByType(processedCategories), [processedCategories]);
  const { batting, pitching } = groupedStats;

  // Handle navigation to matchup page
  const handleViewAllStats = () => {
    router.push('/dashboard/matchup');
  };

  // Handle navigation to lineup page
  const handleFixLineup = () => {
    router.push('/lineup');
  };

  // Handle navigation to schedule analysis page
  const handleScheduleAnalysis = () => {
    router.push('/schedule');
  };

  return (
    <div className="space-y-6 px-2">
      {dashboardLoading || matchupLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-md p-6 animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/2 mb-4"></div>
              <div className="h-10 bg-gray-200 rounded w-1/3"></div>
            </div>
          ))}
        </div>
      ) : dashboardError ? (
        <div className="bg-red-50 p-4 rounded-md text-red-800">
          Error loading dashboard data: {dashboardError}
        </div>
      ) : (
        <div className="space-y-6">
          {/* First row - 4 column cards (1/4 width each) - Square aspect ratio */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Matchup Score Card */}
            <MatchupScoreCard
              wins={wins}
              losses={losses}
              ties={ties}
              myTeamLogo={myTeamLogo || undefined}
              opponentLogo={opponentLogo || undefined}
              opponentName={opponentName}
              onViewAllClick={handleViewAllStats}
            />
            
            {/* Batting Category Card */}
            <BattingCategoryCard 
              categories={batting} 
              onViewAllClick={handleViewAllStats}
              loading={matchupLoading}
            />
            
            {/* Pitching Category Card */}
            <PitchingCategoryCard 
              categories={pitching} 
              onViewAllClick={handleViewAllStats}
              loading={matchupLoading}
            />
            
            {/* Lineup Issues Card */}
            <LineupIssuesCard
              startersWithNoGames={dashboardData?.lineupIssues.startersWithNoGames ?? 0}
              ilOutOfIlSpot={dashboardData?.lineupIssues.ilOutOfIlSpot ?? 0}
              dtdStarting={dashboardData?.lineupIssues.dtdStarting ?? 0}
              openSlots={dashboardData?.lineupIssues.openSlots ?? 0}
              availableSwaps={dashboardData?.lineupIssues.availableSwaps ?? 0}
              onFixLineupClick={handleFixLineup}
            />
          </div>

          {/* Second row - 3 column cards (1/3 width each) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Recent Activity Card */}
            <RecentActivityCard
              activities={dashboardData?.recentActivity ?? []}
              onViewAllClick={() => router.push('/activity')}
            />
            
            {/* Player Updates Card */}
            <PlayerUpdatesCard
              updates={dashboardData?.playerUpdates ?? []}
              onViewAllClick={() => router.push('/updates')}
            />

            {/* Waivers Card */}
            <WaiversCard
              priority={dashboardData?.waiver.priority ?? 0}
              weeklyAdds={dashboardData?.waiver.weeklyAdds ?? 0}
              weeklyLimit={dashboardData?.waiver.weeklyLimit ?? 0}
            />
          </div>

          {/* Next Week card */}
          <div className="mt-4">
            <NextWeekCard
              opponent={dashboardData?.upcomingMatchup.opponent ?? ''}
              dateRange={dashboardData?.upcomingMatchup.dateRange ?? ''}
              onScheduleAnalysisClick={handleScheduleAnalysis}
            />
          </div>
        </div>
      )}
    </div>
  );
} 
