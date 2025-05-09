"use client";
import { useEffect, useState } from 'react';
import { HiChartBar, HiExclamation, HiCalendar, HiBell, HiRefresh, HiStar } from 'react-icons/hi';
import { useRouter } from 'next/navigation';
import CategoryTracker from './components/CategoryTracker';
import { useMatchupStats } from '../utils/hooks';

interface DashboardStats {
  lineupIssues: {
    startersWithNoGames: number;
    ilOutOfIlSpot: number;
    dtdStarting: number;
    openSlots: number;
    availableSwaps: number;
  };
  upcomingMatchup: {
    opponent: string;
    dateRange: string;
  };
  recentActivity: Array<{
    type: 'add' | 'drop' | 'trade';
    player?: string;
    team?: string;
    timestamp: string;
  }>;
  playerUpdates: Array<{
    player: string;
    update: string;
    timestamp: string;
  }>;
  waiver: {
    priority: number;
    weeklyAdds: number;
    weeklyLimit: number;
  };
}

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Use the shared hook to fetch matchup stats
  const { 
    categories, 
    opponentName, 
    myScore, 
    opponentScore,
    myTeamLogo,
    opponentLogo,
    loading: matchupLoading 
  } = useMatchupStats();

  useEffect(() => {
    // In a real implementation, this would fetch data from your API
    // For now we're just using dummy data with a simulated delay
    const fetchData = async () => {
      setLoading(true);
      // Simulate API call
      setTimeout(() => {
        setStats({
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
    };

    fetchData();
  }, []);

  // Handle navigation to matchup page
  const handleViewAllStats = () => {
    router.push('/dashboard/matchup');
  };

  return (
    <div className="space-y-6 px-2">
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-md p-6 animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/2 mb-4"></div>
              <div className="h-10 bg-gray-200 rounded w-1/3"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* First row - 4 column cards (1/4 width each) - Square aspect ratio */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Matchup Score Card */}
            <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-700">Matchup Score</h2>
                <HiStar className="h-6 w-6 text-amber-500" />
              </div>
              
              {/* Simple Score Display */}
              <div className="flex justify-center items-center py-3 mt-auto mb-auto">
                <div className="text-center bg-green-50 rounded-l-lg py-4 px-4 border-r border-gray-100">
                  <p className="text-3xl font-bold text-green-600">{myScore || 0}</p>
                  <p className="text-xs text-gray-500 mt-1">You</p>
                </div>
                
                <div className="text-center py-2 px-2">
                  <p className="text-xs text-gray-500">vs</p>
                  <p className="text-lg font-medium text-gray-400">{opponentName}</p>
                </div>
                
                <div className="text-center bg-red-50 rounded-r-lg py-4 px-4 border-l border-gray-100">
                  <p className="text-3xl font-bold text-gray-700">{opponentScore || 0}</p>
                  <p className="text-xs text-gray-500 mt-1">Opp</p>
                </div>
              </div>
              
              <button 
                onClick={handleViewAllStats}
                className="mt-3 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center"
              >
                View Full Matchup →
              </button>
            </div>
            
            {/* Category Tracker Card - now using our shared component */}
            <CategoryTracker 
              categories={categories} 
              isSmall={true} 
              onViewAllClick={handleViewAllStats}
              loading={matchupLoading}
            />
            
            {/* Lineup Issues Card */}
            <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-700">Lineup Issues</h2>
                <HiExclamation className="h-6 w-6 text-amber-500" />
              </div>
              <div className="flex-1 flex flex-col justify-center space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">No games:</span>
                  <span className="font-bold text-gray-600">
                    {stats?.lineupIssues.startersWithNoGames}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">IL players starting:</span>
                  <span className="font-bold text-gray-600">
                    {stats?.lineupIssues.ilOutOfIlSpot}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">DTD starting:</span>
                  <span className="font-bold text-gray-600">
                    {stats?.lineupIssues.dtdStarting}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Open slots:</span>
                  <span className="font-bold text-gray-600">
                    {stats?.lineupIssues.openSlots}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Available Swaps:</span>
                  <span className="font-bold text-gray-600">
                    {stats?.lineupIssues.availableSwaps}
                  </span>
                </div>
              </div>
              <button className="mt-3 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center">
                Fix Lineup Issues →
              </button>
            </div>
            
            {/* Upcoming Matchup Card */}
            <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-700">Next Week</h2>
                <HiCalendar className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1 flex flex-col justify-center">
                <div className="text-sm text-gray-700 mb-4">
                  <p className="mb-1 font-semibold">{stats?.upcomingMatchup.opponent}</p>
                  <p className="text-gray-500">{stats?.upcomingMatchup.dateRange}</p>
                </div>
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Matchup Analysis</span>
                  <span>Coming Soon</span>
                </div>
              </div>
              <button className="mt-3 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center">
                Schedule Analysis →
              </button>
            </div>
          </div>

          {/* Second row - 3 column cards (1/3 width each) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Recent Activity Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Recent Activity</h2>
                <HiRefresh className="h-6 w-6 text-green-600" />
              </div>
              <div className="space-y-4">
                {stats?.recentActivity.map((activity, index) => (
                  <div key={index} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-start">
                      <div className={`mt-1 h-4 w-4 rounded-full flex-shrink-0 ${
                        activity.type === 'add' ? 'bg-green-100' : 
                        activity.type === 'drop' ? 'bg-red-100' : 'bg-blue-100'
                      }`}>
                        <span className={`block h-2 w-2 rounded-full mx-auto mt-1 ${
                          activity.type === 'add' ? 'bg-green-500' : 
                          activity.type === 'drop' ? 'bg-red-500' : 'bg-blue-500'
                        }`}></span>
                      </div>
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-800">
                          {activity.type === 'add' && 'Added'} 
                          {activity.type === 'drop' && 'Dropped'} 
                          {activity.type === 'trade' && 'Traded with'}
                          {' '}
                          <span className="font-semibold">
                            {activity.player || activity.team}
                          </span>
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{activity.timestamp}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="mt-4 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center">
                View All Activity →
              </button>
            </div>
            
            {/* Player Updates Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Player Updates</h2>
                <HiBell className="h-6 w-6 text-orange-500" />
              </div>
              <div className="space-y-4">
                {stats?.playerUpdates.map((update, index) => (
                  <div key={index} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
                    <p className="text-sm font-medium text-gray-800">{update.player}</p>
                    <p className="text-xs text-gray-600 mt-1">{update.update}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{update.timestamp}</p>
                  </div>
                ))}
              </div>
              <button className="mt-4 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center">
                View All Updates →
              </button>
            </div>

            {/* Waivers Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Waivers</h2>
                <HiChartBar className="h-6 w-6 text-indigo-600" />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Waiver Priority:</span>
                  <span className="font-bold text-gray-900">{stats?.waiver.priority}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Weekly Adds:</span>
                  <span className="font-bold text-gray-900">{stats?.waiver.weeklyAdds} of {stats?.waiver.weeklyLimit}</span>
                </div>
                <div className="text-center text-gray-500 pt-4">
                  <p className="text-sm">Additional waiver data coming soon</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
