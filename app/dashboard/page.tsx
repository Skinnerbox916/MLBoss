"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import MatchupDisplay from './components/MatchupDisplay';
import { SkeletonPlayerList, SkeletonTeamInfo } from './components/SkeletonLoading';
import { HiHome, HiUserGroup, HiNewspaper, HiStar, HiChartBar, HiCog, HiSupport, HiLogout } from 'react-icons/hi';
import { CiBellOn } from 'react-icons/ci';
import { FaUserCircle } from 'react-icons/fa';
import PositionDisplay from './components/PositionDisplay';
import PlayerCard from './components/PlayerCard';
import { addDays, format } from 'date-fns';

// Add global styles for dropdown menu
const dropdownStyles = `
  .dropdown:hover .dropdown-menu {
    display: block;
  }
`;

interface Team {
  name: string;
  type: 'fantasy' | 'tournament';
  url: string;
  league_name?: string;
}

interface Player {
  name: string;
  position: string;
  team: string;
  image_url?: string;
  status?: string;     // Add status field for IL/DTD
  pitching_today?: boolean; // Add field for pitching today
  matchup?: {
    opponent: string;
    home_away: 'home' | 'away';
    date?: string;
    time?: string;
  };
  stats?: {
    [key: string]: string | number;
  };
  eligiblePositions?: string[]; // Add eligible positions array
  selectedPosition?: string;    // Add currently selected position
  isStarting?: boolean;         // Add starting status
  has_game_today?: boolean;     // Add has_game_today field
  game_start_time?: string;     // Add game_start_time field
  data_source?: string;         // Add data_source field to track where game info came from
  playerKey?: string;           // Player key for Yahoo API
  teamKey?: string;             // Team key for Yahoo API
}

// Helper to add ordinal suffix to rank
function getOrdinalSuffix(rank: string | number) {
  const n = typeof rank === 'string' ? parseInt(rank, 10) : rank;
  if (isNaN(n)) return rank;
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return n + 'st';
  if (j === 2 && k !== 12) return n + 'nd';
  if (j === 3 && k !== 13) return n + 'rd';
  return n + 'th';
}

// Create default categories if none are provided
function createDefaultCategories() {
  const defaultCategories = [
    { name: 'R', displayName: 'Runs', id: '1', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'HR', displayName: 'Home Runs', id: '2', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'RBI', displayName: 'RBIs', id: '3', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'SB', displayName: 'Stolen Bases', id: '4', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'AVG', displayName: 'Batting Avg', id: '5', myStat: '.000', opponentStat: '.000', winning: null, isHigherBetter: true },
    { name: 'OPS', displayName: 'OPS', id: '6', myStat: '.000', opponentStat: '.000', winning: null, isHigherBetter: true },
    { name: 'K', displayName: 'Batter Ks', id: '7', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: false },
    { name: 'W', displayName: 'Wins', id: '8', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'SV', displayName: 'Saves', id: '9', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'SO', displayName: 'Pitcher Ks', id: '10', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'ERA', displayName: 'ERA', id: '11', myStat: '0.00', opponentStat: '0.00', winning: null, isHigherBetter: false },
    { name: 'WHIP', displayName: 'WHIP', id: '12', myStat: '0.00', opponentStat: '0.00', winning: null, isHigherBetter: false }
  ];
  return defaultCategories;
}

export default function Dashboard() {
  const router = useRouter();
  const [rawData, setRawData] = useState<any>(null);
  const [rosterData, setRosterData] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('stats');
  const [rosterFilter, setRosterFilter] = useState('batters');
  const [loading, setLoading] = useState(true);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [starters, setStarters] = useState<{[key: string]: string}>({}); // Add state for starters
  const [debugResults, setDebugResults] = useState<any>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  // Generate 7-day range for date picker
  const dateOptions = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(new Date(), i);
    return {
      value: format(date, 'yyyy-MM-dd'),
      label: format(date, 'EEE MMM d'),
    };
  });

  useEffect(() => {
    if (typeof document !== 'undefined' && !document.cookie.includes('yahoo_client_access_token')) {
      router.push('/');
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch team data
        const teamRes = await fetch('/api/yahoo/team');
        const teamData = await teamRes.json();
        
        // Debug logs
        console.log('Raw teamData response:', teamData);
        console.log('teamData structure:', {
          hasTeamProperty: 'team' in teamData,
          teamPropertyType: teamData.team ? typeof teamData.team : 'undefined',
          isTeamObject: teamData.team && typeof teamData.team === 'object',
          topLevelKeys: Object.keys(teamData),
          teamKeys: teamData.team ? Object.keys(teamData.team) : []
        });
        
        if (teamData.error) {
          setError(teamData.error);
          setLoading(false);
          return;
        }

        setRawData(teamData);

        // Fetch roster data
        const rosterRes = await fetch('/api/yahoo/roster');
        const rosterData = await rosterRes.json();
        
        if (rosterData.error) {
          setError(rosterData.error);
          setLoading(false);
          return;
        }

        // Only log in development, not during production
        if (process.env.NODE_ENV === 'development') {
          // Log received player data to help with debugging
          // console.log('Received player data:', rosterData.players);
          
          // Check for players with status
          const playersWithStatus = rosterData.players.filter((p: Player) => p.status);
          // console.log('Players with status:', playersWithStatus);
          
          // Check for batter status specifically
          const battersWithStatus = rosterData.players.filter((p: Player) => 
            p.status && !p.position.includes('P')
          );
          // console.log('Batters with status:', battersWithStatus);
        }

        setRosterData(rosterData.players || []);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      }
    };

    // Fetch data
    fetchData();
  }, [router]);

  useEffect(() => {
    if (!rosterData || rosterData.length === 0) return;
    const initialStarters: {[key: string]: string} = {};
    rosterData.forEach(player => {
      if (player.isStarting && player.selectedPosition) {
        initialStarters[player.selectedPosition] = player.name;
      }
    });
    setStarters(initialStarters);
  }, [rosterData]);

  // Extract team data from the new API response
  const teamData = rawData?.team;
  
  // Add defensive rendering code - this function ensures we can safely access teamData properties
  const getTeamProperty = (property: string, fallback: any = null) => {
    if (!teamData) return fallback;
    return teamData[property] !== undefined ? teamData[property] : fallback;
  };

  // Function to render player status icon with more robust checks
  const renderPlayerStatus = (player: Player) => {    
    if (!player.status) {
      return null;
    }
    
    if (player.status === 'IL' || player.status === 'DL' || player.status.includes('IL')) {
      return (
        <div className="ml-1 inline-flex items-center justify-center bg-red-100 text-red-800 text-xs font-medium px-1.5 py-0.5 rounded" title={player.status}>
          <span>{player.status}</span>
        </div>
      );
    } 
    
    if (player.status === 'DTD') {
      return (
        <div className="ml-1 inline-flex items-center justify-center bg-yellow-100 text-yellow-800 text-xs font-medium px-1.5 py-0.5 rounded" title="Day-To-Day">
          <span>DTD</span>
        </div>
      );
    } 
    
    // Handle any other status
    return (
      <div className="ml-1 inline-flex items-center justify-center bg-gray-100 text-gray-800 text-xs font-medium px-1.5 py-0.5 rounded" title={player.status}>
        <span>{player.status}</span>
      </div>
    );
  };

  // Function to render pitcher indicator
  const renderPitchingToday = (player: Player) => {
    if (player.pitching_today === true) {
      return (
        <div className="ml-1 inline-flex items-center justify-center bg-green-100 text-green-800 text-xs font-medium px-1.5 py-0.5 rounded">
          <span>Today</span>
        </div>
      );
    }
    return null;
  };

  const handleLogout = () => {
    fetch('/api/auth/logout')
      .then(() => {
        router.push('/');
      });
  };

  // Add this function to filter players by position
  const getFilteredPlayers = () => {
    if (!selectedPosition) return rosterData;
    if (selectedPosition === 'UTIL') {
      // Show all batters for UTIL
      return rosterData.filter((player: Player) => !player.position.includes('P'));
    }
    return rosterData.filter((player: Player) => {
      const positions = player.position.split(',');
      return positions.some(pos => pos.trim() === selectedPosition);
    });
  };

  // Add this function to handle position selection
  const handlePositionSelect = (position: string) => {
    setSelectedPosition(selectedPosition === position ? null : position);
  };

  // Helper to determine player status for sorting and styling
  function getPlayerRowStatus(player: Player): 'active' | 'no-game' | 'il' {
    const isIL = player.status && (player.status.includes('IL') || player.status.includes('DL'));
    const hasGame = player.matchup && player.matchup.date === selectedDate;
    if (isIL) return 'il';
    if (!hasGame) return 'no-game';
    return 'active';
  }

  // Sort players: active > no-game > il
  function sortPlayers(players: Player[]): Player[] {
    return players.slice().sort((a: Player, b: Player) => {
      const order = { active: 0, 'no-game': 1, il: 2 };
      return order[getPlayerRowStatus(a)] - order[getPlayerRowStatus(b)];
    });
  }

  // Add function to handle starter selection
  const handleStarterSelect = (playerName: string) => {
    if (!selectedPosition) return;
    
    setStarters(prev => {
      const newStarters = { ...prev };
      // Remove any existing starter for this position
      Object.keys(newStarters).forEach(pos => {
        if (newStarters[pos] === playerName) {
          delete newStarters[pos];
        }
      });
      // Set new starter if not already selected
      if (newStarters[selectedPosition] !== playerName) {
        newStarters[selectedPosition] = playerName;
      }
      return newStarters;
    });
  };

  // Add function to debug a player's game status
  const debugPlayerGame = async (playerKey?: string, teamKey?: string) => {
    if (!playerKey) return;
    
    setDebugLoading(true);
    try {
      const url = `/api/yahoo/debug/player-game?playerKey=${playerKey}${teamKey ? `&teamKey=${teamKey}` : ''}${selectedDate ? `&date=${selectedDate}` : ''}`;
      console.log(`Debugging player game with date: ${selectedDate}`);
      const res = await fetch(url);
      const data = await res.json();
      setDebugResults(data);
      console.log('Debug results:', data);
    } catch (err) {
      console.error('Error debugging player game:', err);
    } finally {
      setDebugLoading(false);
    }
  };

  // Debug Results Modal
  const DebugResultsModal = () => {
    if (!debugResults) return null;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-auto">
          <div className="p-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-semibold">Yahoo API Debug Results</h3>
            <button 
              onClick={() => setDebugResults(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <div className="p-4">
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-500">Player Key:</div>
              <div className="text-sm font-mono bg-gray-100 p-2 rounded mt-1">{debugResults.player_key}</div>
            </div>
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-500">Date:</div>
              <div className="text-sm font-mono bg-gray-100 p-2 rounded mt-1">{debugResults.date}</div>
            </div>
            
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-500">Results by Method:</div>
              {debugResults.methods?.map((method: any, index: number) => (
                <div key={index} className="mt-4 p-3 border border-gray-200 rounded">
                  <div className="font-medium">{method.method}</div>
                  
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-xs text-gray-500">Has Game:</span>
                      <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                        method.has_game === true ? 'bg-green-100 text-green-800' : 
                        method.has_game === false ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {method.has_game === null ? 'Unknown' : String(method.has_game)}
                      </span>
                    </div>
                    
                    {method.error && (
                      <div className="col-span-2">
                        <span className="text-xs text-red-500">Error:</span>
                        <span className="ml-2 text-xs">{method.error}</span>
                      </div>
                    )}
                    
                    {method.coverage_start && (
                      <div>
                        <span className="text-xs text-gray-500">Coverage Start:</span>
                        <span className="ml-2 text-xs font-mono">{method.coverage_start}</span>
                      </div>
                    )}
                    
                    {method.game_start_time && (
                      <div>
                        <span className="text-xs text-gray-500">Game Start Time:</span>
                        <span className="ml-2 text-xs font-mono">{method.game_start_time}</span>
                      </div>
                    )}
                    
                    {method.url && (
                      <div className="col-span-2 mt-2">
                        <span className="text-xs text-gray-500">URL:</span>
                        <div className="mt-1 text-xs font-mono bg-gray-50 p-1 rounded overflow-x-auto">
                          {method.url}
                        </div>
                      </div>
                    )}
                  </div>

                  {method.game_indicators && (
                    <div className="col-span-2 mt-3 bg-gray-50 p-2 rounded">
                      <span className="text-xs text-gray-500 font-medium">Game Indicators:</span>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
                        {Object.entries(method.game_indicators).map(([key, value]) => (
                          value !== null && (
                            <div key={key} className="text-xs">
                              <span className="text-gray-500">{key}:</span> <span className="font-mono">{String(value)}</span>
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  )}

                  {method.raw_response_summary && (
                    <div className="col-span-2 mt-3 bg-gray-50 p-2 rounded">
                      <span className="text-xs text-gray-500 font-medium">Player Info:</span>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
                        {Object.entries(method.raw_response_summary).map(([key, value]) => (
                          value !== null && (
                            <div key={key} className="text-xs">
                              <span className="text-gray-500">{key}:</span> <span className="font-mono">{String(value)}</span>
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  )}

                  {method.note && (
                    <div className="col-span-2 mt-2">
                      <span className="text-xs text-blue-500">Note:</span>
                      <span className="ml-2 text-xs">{method.note}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Add style tag for dropdown styles */}
      <style jsx global>{dropdownStyles}</style>
      
      {/* Debug Results Modal */}
      {debugResults && <DebugResultsModal />}
      
      <div className="flex h-screen bg-gray-100">
        {/* Sidebar with logo above */}
        <div className="w-64 bg-white shadow-lg flex flex-col items-center h-full">
          <div className="pt-6 pb-2 w-full flex flex-col items-center">
            <Image
              src="/MLBoss Logo.png"
              alt="MLBoss Logo"
              width={120}
              height={0}
              style={{ height: 'auto' }}
              priority
            />
          </div>
          
          {/* Roster section with filter toggle */}
          <div className="p-4 w-full flex-1 overflow-hidden flex flex-col">
            {/* Batters/Pitchers toggle */}
            <div className="flex mb-4 bg-gray-100 rounded-md p-1">
              <button 
                onClick={() => setRosterFilter('batters')}
                className={`flex-1 py-1 px-2 text-sm rounded-md transition-colors ${rosterFilter === 'batters' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-600 hover:bg-gray-200'}`}
              >
                Batters
              </button>
              <button 
                onClick={() => setRosterFilter('pitchers')}
                className={`flex-1 py-1 px-2 text-sm rounded-md transition-colors ${rosterFilter === 'pitchers' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-600 hover:bg-gray-200'}`}
              >
                Pitchers
              </button>
            </div>
            
            {/* Scrollable roster list */}
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <SkeletonPlayerList count={12} isPitcher={rosterFilter === 'pitchers'} />
              ) : rosterData.length > 0 ? (
                <ul className="space-y-1">
                  {rosterData
                    .filter(player => {
                      // Filter based on position type
                      const isPitcher = player.position.includes('P');
                      return rosterFilter === 'pitchers' ? isPitcher : !isPitcher;
                    })
                    .map((player, index) => {
                      // Remove debug logs that may affect hydration
                      // console.log(`Player ${index}:`, player);
                      
                      return (
                        <li
                          key={index}
                          className="flex items-center text-gray-800 text-sm rounded cursor-pointer transition-colors hover:bg-gray-200 px-2 py-1.5"
                        >
                          {player.image_url && (
                            <img
                              src={player.image_url}
                              alt={player.name}
                              className="w-7 h-7 rounded-full mr-2 border"
                            />
                          )}
                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center flex-wrap">
                              <span className="truncate font-medium">{player.name}</span>
                              <div className="flex ml-1 flex-wrap">
                                {player.status ? renderPlayerStatus(player) : null}
                                {player.pitching_today === true ? renderPitchingToday(player) : null}
                              </div>
                            </div>
                            <div className="flex items-center mt-0.5">
                              <span className="text-xs text-gray-500">{player.position}</span>
                              <span className="text-xs text-gray-400 mx-1">•</span>
                              <span className="text-xs text-gray-500 truncate">{player.team}</span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <div className="text-gray-500">No roster data available</div>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {/* Enhanced Header with Team Info */}
          <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-none">
                {error}
              </div>
            )}

            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                {/* Left Column - Basic Team Info */}
                <div>
                  {loading ? (
                    <SkeletonTeamInfo />
                  ) : teamData ? (
                    <div className="flex items-center">
                      {teamData.team_logo && (
                        <img 
                          src={teamData.team_logo} 
                          alt="Team Logo" 
                          className="w-14 h-14 rounded-full mr-4 border"
                        />
                      )}
                      <div>
                        <a 
                          href={getTeamProperty('url', '#')} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xl font-bold text-[#3C1791] hover:text-[#2A1066] transition-colors inline-flex items-center gap-1 font-oswald"
                        >
                          {getTeamProperty('name', 'Team Name')}
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            className="h-4 w-4 text-gray-400" 
                            fill="none" 
                            viewBox="0 0 24 24" 
                            stroke="currentColor"
                          >
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              strokeWidth={2} 
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" 
                            />
                          </svg>
                        </a>
                        <div className="text-gray-600 text-sm mt-1">
                          {getTeamProperty('league_name', 'Unknown League')}
                          {" | "}
                          {getTeamProperty('record', '0-0')}
                          {" | "}
                          {getTeamProperty('rank') ? `${getOrdinalSuffix(getTeamProperty('rank'))}` : '-'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-500">
                      Team information not available.
                    </div>
                  )}
                </div>

                {/* Middle Column - Team Stats */}
                <div className="flex flex-row items-center justify-center h-full gap-6">
                  {teamData ? (
                    <>
                      <div className="text-center">
                        <span className="block text-gray-700 font-medium text-xs">Waiver Priority</span>
                        <span className="block text-lg font-bold text-gray-900">{getTeamProperty('waiver_priority', '-')}</span>
                      </div>
                      <div className="text-center">
                        <span className="block text-gray-700 font-medium text-xs">Weekly Adds</span>
                        <span className="block text-lg font-bold text-gray-900">{getTeamProperty('moves_used', 0)} of {getTeamProperty('moves_limit', 0)}</span>
                      </div>
                      <div className="text-center">
                        <span className="block text-gray-700 font-medium text-xs">Available Swaps</span>
                        <span className="block text-lg font-bold text-gray-900">{getTeamProperty('available_swaps', 0)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-gray-500">
                      Stats not available
                    </div>
                  )}
                </div>

                {/* Right Column - Account Menu - Always visible */}
                <div className="flex justify-end relative">
                  <div className="dropdown inline-block relative">
                    <button className="bg-white hover:bg-gray-100 text-gray-700 font-medium rounded-md border border-gray-200 shadow-sm py-2 px-3 inline-flex items-center">
                      <span className="mr-1">Account</span>
                      <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                        <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/> 
                      </svg>
                    </button>
                    <ul className="dropdown-menu absolute hidden text-gray-700 pt-1 right-0 w-40 z-10">
                      <li>
                        <Link 
                          href="/admin"
                          className="rounded-t bg-white hover:bg-gray-100 py-2 px-4 block whitespace-no-wrap w-full text-left border border-gray-200 border-b-0 shadow-sm flex items-center"
                        >
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            className="h-4 w-4 mr-2" 
                            fill="none" 
                            viewBox="0 0 24 24" 
                            stroke="currentColor"
                          >
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              strokeWidth={2} 
                              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" 
                            />
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              strokeWidth={2} 
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" 
                            />
                          </svg>
                          Admin Console
                        </Link>
                      </li>
                      <li>
                        <button
                          onClick={handleLogout}
                          className="rounded-b bg-white hover:bg-gray-100 py-2 px-4 block whitespace-no-wrap w-full text-left border border-gray-200 shadow-sm text-red-600 font-medium flex items-center"
                        >
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            className="h-4 w-4 mr-2" 
                            fill="none" 
                            viewBox="0 0 24 24" 
                            stroke="currentColor"
                          >
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              strokeWidth={2} 
                              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" 
                            />
                          </svg>
                          Log Out
                        </button>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-8">
            {/* Matchup Information */}
            {loading ? (
              <div className="mb-8">
                <MatchupDisplay
                  week=""
                  opponentName=""
                  isLoading={true}
                />
              </div>
            ) : teamData ? (
              (() => {
                // Always show matchup information, even if there's no matchup data
                const matchupData = getTeamProperty('matchup', {
                  week: 'N/A',
                  opponentName: 'No Current Matchup',
                  opponentLogo: null,
                  myScore: '0',
                  opponentScore: '0',
                  categories: createDefaultCategories()
                });
                
                console.log('Dashboard: Matchup data:', matchupData);
                console.log('Dashboard: Categories data:', matchupData.categories);
                
                return (
                  <div className="mb-8">
                    <MatchupDisplay
                      week={matchupData.week || 'N/A'}
                      opponentName={matchupData.opponentName || 'No Current Matchup'}
                      opponentLogo={matchupData.opponentLogo || null}
                      myScore={matchupData.myScore || '0'}
                      opponentScore={matchupData.opponentScore || '0'}
                      categories={matchupData.categories || createDefaultCategories()}
                      isLoading={false}
                    />
                  </div>
                );
              })()
            ) : (
              <div className="bg-white rounded-lg shadow p-4 mb-8 text-center text-gray-500">
                <div>No team data available</div>
                <div className="text-xs mt-1">Please check your Yahoo connection</div>
              </div>
            )}

            {/* Combined Batter Comparisons Card */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <PositionDisplay 
                onPositionSelect={handlePositionSelect}
                selectedPosition={selectedPosition}
              />

              {/* 7-day Date Picker */}
              <div className="flex flex-row space-x-2 mb-4">
                {dateOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedDate(opt.value)}
                    className={`px-3 py-1 rounded-md text-sm font-medium transition-colors
                      ${selectedDate === opt.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Player comparison table */}
              {loading ? (
                <SkeletonPlayerList />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-3 py-4 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-3 py-4 text-center text-xs font-medium text-gray-500 uppercase">R</th>
                        <th className="px-3 py-4 text-center text-xs font-medium text-gray-500 uppercase">HR</th>
                        <th className="px-3 py-4 text-center text-xs font-medium text-gray-500 uppercase">RBI</th>
                        <th className="px-3 py-4 text-center text-xs font-medium text-gray-500 uppercase">SB</th>
                        <th className="px-3 py-4 text-center text-xs font-medium text-gray-500 uppercase">AVG</th>
                        <th className="px-3 py-4 text-center text-xs font-medium text-gray-500 uppercase">OPS</th>
                        <th className="px-3 py-4 text-center text-xs font-medium text-gray-500 uppercase">Debug: YAHOO<br/>has_game<br/>from<br/>time</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {sortPlayers(getFilteredPlayers()
                        .filter((player: Player) => !player.position.includes('P'))
                      ).map((player: Player, index: number) => {
                        const rowStatus = getPlayerRowStatus(player);
                        const isStarter = starters[selectedPosition || ''] === player.name;
                        const eligiblePositions = player.eligiblePositions || player.position.split(',').map(p => p.trim());
                        
                        return (
                          <tr key={index} className={
                            rowStatus === 'il' ? 'bg-red-100' :
                            rowStatus === 'no-game' ? 'bg-gray-200' : ''
                          }>
                            <td className="px-3 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <div className="flex items-center">
                                  <input
                                    type="radio"
                                    name={`starter-${selectedPosition}`}
                                    checked={isStarter}
                                    onChange={() => handleStarterSelect(player.name)}
                                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                  />
                                </div>
                                {player.image_url && (
                                  <img src={player.image_url} alt={player.name} className="w-12 h-12 rounded-full border object-cover" />
                                )}
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-base">{player.name}</span>
                                    <span className="text-sm text-gray-500 font-medium">{player.team}</span>
                                    {player.status === 'DTD' && (
                                      <span className="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs font-semibold">DTD</span>
                                    )}
                                    {/* Add Debug button */}
                                    <button 
                                      onClick={(e) => {
                                        e.preventDefault();
                                        debugPlayerGame(player.playerKey, player.teamKey);
                                      }}
                                      className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
                                      title="Debug Yahoo API"
                                    >
                                      Debug
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {eligiblePositions.map((pos, idx) => (
                                      <span
                                        key={idx}
                                        className={`text-xs px-1.5 py-0.5 rounded ${
                                          pos === selectedPosition && isStarter
                                            ? 'bg-blue-100 text-blue-800 font-medium'
                                            : 'bg-gray-300 text-gray-800'
                                        }`}
                                      >
                                        {pos}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-4 text-center">{player.stats?.R ?? '-'}</td>
                            <td className="px-3 py-4 text-center">{player.stats?.HR ?? '-'}</td>
                            <td className="px-3 py-4 text-center">{player.stats?.RBI ?? '-'}</td>
                            <td className="px-3 py-4 text-center">{player.stats?.SB ?? '-'}</td>
                            <td className="px-3 py-4 text-center">{player.stats?.AVG ?? '-'}</td>
                            <td className="px-3 py-4 text-center">{player.stats?.OPS ?? '-'}</td>
                            <td className="px-3 py-4 text-center text-xs text-gray-400">
                              has_game: {String(player.has_game_today)}<br/>
                              from: {player.data_source || 'N/A'}<br/>
                              time: {player.game_start_time ? player.game_start_time.substring(0, 10) : 'none'}<br/>
                              team: {player.team}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
} 
