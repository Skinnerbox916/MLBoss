"use client";
import { useEffect, useState } from 'react';
import { HiChartBar, HiExclamation, HiCalendar, HiBell, HiRefresh, HiStar } from 'react-icons/hi';

interface DashboardStats {
  categoryDeltas: {
    HR: number;
    RBI: number;
    SB: number;
    AVG: number;
    ERA: number;
  };
  lineupIssues: {
    startersWithNoGames: number;
    ilOutOfIlSpot: number;
    dtdStarting: number;
    openSlots: number;
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
  currentMatchup: {
    opponentName: string;
    yourScore: number;
    opponentScore: number;
    categories: Array<{
      name: string;
      yourValue: string | number;
      opponentValue: string | number;
      winning: boolean | null; // true = you're winning, false = opponent winning, null = tie
    }>;
    daysRemaining: number;
  };
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
          categoryDeltas: {
            HR: 3,
            RBI: -2,
            SB: 1,
            AVG: 0.012,
            ERA: -0.27
          },
          lineupIssues: {
            startersWithNoGames: 2,
            ilOutOfIlSpot: 1,
            dtdStarting: 1,
            openSlots: 2
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
          currentMatchup: {
            opponentName: "Ohtani-Wan Kenobi",
            yourScore: 5,
            opponentScore: 4,
            categories: [
              { name: "HR", yourValue: 12, opponentValue: 9, winning: true },
              { name: "RBI", yourValue: 38, opponentValue: 45, winning: false },
              { name: "R", yourValue: 31, opponentValue: 27, winning: true },
              { name: "SB", yourValue: 5, opponentValue: 5, winning: null },
              { name: "AVG", yourValue: ".278", opponentValue: ".265", winning: true },
              { name: "OPS", yourValue: ".842", opponentValue: ".799", winning: true },
              { name: "ERA", yourValue: "3.24", opponentValue: "2.98", winning: false },
              { name: "WHIP", yourValue: "1.12", opponentValue: "1.20", winning: true },
              { name: "K", yourValue: 62, opponentValue: 67, winning: false }
            ],
            daysRemaining: 4
          }
        });
        setLoading(false);
      }, 1000);
    };

    fetchData();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
      
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
          {/* First row - 3 column cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Mini Category Tracker Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Category Tracker</h2>
                <HiChartBar className="h-6 w-6 text-purple-600" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center p-2 rounded-lg bg-green-50">
                  <span className="text-xs text-gray-500">HR</span>
                  <span className={`text-lg font-bold ${stats?.categoryDeltas?.HR && stats?.categoryDeltas?.HR > 0 ? 'text-green-600' : stats?.categoryDeltas?.HR < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {stats?.categoryDeltas?.HR > 0 ? '+' : ''}{stats?.categoryDeltas?.HR}
                  </span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-red-50">
                  <span className="text-xs text-gray-500">RBI</span>
                  <span className={`text-lg font-bold ${stats?.categoryDeltas?.RBI && stats?.categoryDeltas?.RBI > 0 ? 'text-green-600' : stats?.categoryDeltas?.RBI < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {stats?.categoryDeltas?.RBI > 0 ? '+' : ''}{stats?.categoryDeltas?.RBI}
                  </span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-blue-50">
                  <span className="text-xs text-gray-500">SB</span>
                  <span className={`text-lg font-bold ${stats?.categoryDeltas?.SB && stats?.categoryDeltas?.SB > 0 ? 'text-green-600' : stats?.categoryDeltas?.SB < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {stats?.categoryDeltas?.SB > 0 ? '+' : ''}{stats?.categoryDeltas?.SB}
                  </span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-yellow-50">
                  <span className="text-xs text-gray-500">AVG</span>
                  <span className={`text-lg font-bold ${stats?.categoryDeltas?.AVG && stats?.categoryDeltas?.AVG > 0 ? 'text-green-600' : stats?.categoryDeltas?.AVG < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {stats?.categoryDeltas?.AVG > 0 ? '+' : ''}{stats?.categoryDeltas?.AVG?.toFixed(3)}
                  </span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-purple-50">
                  <span className="text-xs text-gray-500">ERA</span>
                  <span className={`text-lg font-bold ${stats?.categoryDeltas?.ERA && stats?.categoryDeltas?.ERA < 0 ? 'text-green-600' : stats?.categoryDeltas?.ERA > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {stats?.categoryDeltas?.ERA > 0 ? '+' : ''}{stats?.categoryDeltas?.ERA?.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Lineup Issues Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Lineup Issues</h2>
                <HiExclamation className="h-6 w-6 text-amber-600" />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Starters with no games:</span>
                  <span className={`font-bold ${stats?.lineupIssues.startersWithNoGames ? 'text-red-600' : 'text-gray-600'}`}>
                    {stats?.lineupIssues.startersWithNoGames}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">IL players not in IL spots:</span>
                  <span className={`font-bold ${stats?.lineupIssues.ilOutOfIlSpot ? 'text-red-600' : 'text-gray-600'}`}>
                    {stats?.lineupIssues.ilOutOfIlSpot}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">DTD players starting:</span>
                  <span className={`font-bold ${stats?.lineupIssues.dtdStarting ? 'text-amber-600' : 'text-gray-600'}`}>
                    {stats?.lineupIssues.dtdStarting}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Open lineup slots:</span>
                  <span className={`font-bold ${stats?.lineupIssues.openSlots ? 'text-red-600' : 'text-gray-600'}`}>
                    {stats?.lineupIssues.openSlots}
                  </span>
                </div>
              </div>
              <button className="mt-4 text-purple-600 text-sm font-medium hover:text-purple-800">
                Fix Lineup Issues →
              </button>
            </div>
            
            {/* Matchup Score Card - In first row */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-gray-700">Matchup Score</h2>
                <HiStar className="h-6 w-6 text-amber-500" />
              </div>
              
              {/* Simple Score Display */}
              <div className="flex justify-center items-center py-3">
                <div className="text-center bg-green-50 rounded-l-lg py-4 px-6 border-r border-gray-100">
                  <p className="text-3xl font-bold text-green-600">{stats?.currentMatchup?.yourScore || 0}</p>
                  <p className="text-xs text-gray-500 mt-1">You</p>
                </div>
                
                <div className="text-center py-2 px-3">
                  <p className="text-xs text-gray-500">{stats?.currentMatchup?.daysRemaining} days</p>
                  <p className="text-lg font-medium text-gray-400">vs</p>
                </div>
                
                <div className="text-center bg-red-50 rounded-r-lg py-4 px-6 border-l border-gray-100">
                  <p className="text-3xl font-bold text-gray-700">{stats?.currentMatchup?.opponentScore || 0}</p>
                  <p className="text-xs text-gray-500 mt-1">Opp</p>
                </div>
              </div>
              
              <button className="mt-3 text-sm text-purple-600 font-medium hover:text-purple-800 w-full text-center">
                View Full Matchup →
              </button>
            </div>
          </div>
          
          {/* Second row - Upcoming Matchup (2/3) and Player Updates (1/3) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Upcoming Matchup Card - Now 2/3 width */}
            <div className="bg-white rounded-lg shadow-md p-6 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Upcoming Matchup</h2>
                <HiCalendar className="h-6 w-6 text-orange-600" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-gray-800 line-clamp-1">{stats?.upcomingMatchup.opponent}</span>
                <span className="text-gray-600 mt-1">{stats?.upcomingMatchup.dateRange}</span>
                <div className="mt-4 flex flex-col space-y-3">
                  <p className="text-sm text-gray-600">
                    Get ready for your next fantasy matchup! This week you'll be facing "{stats?.upcomingMatchup.opponent}", 
                    one of the stronger teams in your league.
                  </p>
                  <p className="text-sm text-gray-600">
                    Their strengths are in power hitting categories (HR, RBI) while you have advantages in pitching.
                    Consider adjusting your lineup to maximize your strengths.
                  </p>
                </div>
                <button className="mt-4 text-purple-600 text-sm font-medium hover:text-purple-800">
                  View Matchup Details →
                </button>
              </div>
            </div>
            
            {/* Player Updates Card - Now 1/3 width */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-700">Player Updates</h2>
                <HiBell className="h-6 w-6 text-blue-600" />
              </div>
              <div className="space-y-4 overflow-y-auto max-h-64">
                {stats?.playerUpdates.map((update, index) => (
                  <div key={index} className="flex items-start">
                    <div className="rounded-full bg-blue-100 p-2 mr-3 flex-shrink-0">
                      <HiRefresh className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium"><span className="text-blue-600">{update.player}</span></p>
                      <p className="text-xs text-gray-700">{update.update}</p>
                      <p className="text-xs text-gray-500">{update.timestamp}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button className="mt-4 text-sm text-purple-600 font-medium hover:text-purple-800 w-full text-center">
                View All Updates →
              </button>
            </div>
          </div>
          
          {/* Third row - Recent Activity */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Recent Activity</h2>
            <div className="space-y-4">
              {stats?.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-start">
                  <div className={`rounded-full p-2 mr-4 ${
                    activity.type === 'add' ? 'bg-blue-100' : 
                    activity.type === 'drop' ? 'bg-red-100' : 'bg-purple-100'
                  }`}>
                    <svg className={`h-4 w-4 ${
                      activity.type === 'add' ? 'text-blue-600' : 
                      activity.type === 'drop' ? 'text-red-600' : 'text-purple-600'
                    }`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {activity.type === 'add' && (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      )}
                      {activity.type === 'drop' && (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                      )}
                      {activity.type === 'trade' && (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m-8 6H4m0 0l4 4m-4-4l4-4" />
                      )}
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {activity.type === 'add' && <>Added <span className="text-blue-600">{activity.player}</span></>}
                      {activity.type === 'drop' && <>Dropped <span className="text-red-600">{activity.player}</span></>}
                      {activity.type === 'trade' && <>Trade Completed with <span className="text-purple-600">{activity.team}</span></>}
                    </p>
                    <p className="text-xs text-gray-500">{activity.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-4 text-sm text-purple-600 font-medium hover:text-purple-800">
              View All Activity →
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 
