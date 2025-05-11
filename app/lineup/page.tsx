'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SkeletonPlayerList } from '../components/SkeletonLoading';
import PositionSelector from '../components/PositionSelector';
import { format, addDays } from 'date-fns';

interface Player {
  name: string;
  position: string;
  team: string;
  image_url?: string;
  status?: string;
  pitching_today?: boolean;
  matchup?: {
    opponent: string;
    home_away: 'home' | 'away';
    date?: string;
    time?: string;
  };
  stats?: {
    [key: string]: string | number;
  };
  eligiblePositions?: string[];
  selectedPosition?: string;
  isStarting?: boolean;
  has_game_today?: boolean;
  game_start_time?: string;
  data_source?: string;
  playerKey?: string;
  teamKey?: string;
}

export default function LineupPage() {
  const router = useRouter();
  const [rosterData, setRosterData] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
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
      label: format(date, 'EEE'),
      fullLabel: format(date, 'MMM d'),
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
        // Fetch roster data
        const rosterRes = await fetch('/api/yahoo/roster');
        const rosterData = await rosterRes.json();
        
        if (rosterData.error) {
          setError(rosterData.error);
          setLoading(false);
          return;
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

  // Function to filter players by position
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

  // Function to handle position selection
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

  // Function to handle starter selection
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

  // Function to debug a player's game status
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
                              <span className="text-gray-500">{key}:</span> {String(value)}
                            </div>
                          )
                        ))}
                      </div>
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
    <div className="space-y-4">
      {/* Debug Modal */}
      <DebugResultsModal />
      
      {/* Date selection bar */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex space-x-2 justify-between items-center">
          <h2 className="text-lg font-semibold">Set Your Lineup</h2>
          
          <div className="flex space-x-1">
            {dateOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setSelectedDate(option.value)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                  selectedDate === option.value
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <div className="flex flex-col items-center">
                  <span className="text-xs">{option.label}</span>
                  <span className="text-xs">{option.fullLabel}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Position selection */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <PositionSelector onPositionSelect={handlePositionSelect} selectedPosition={selectedPosition} />
      </div>
      
      {/* Roster list */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <h3 className="text-md font-medium mb-3">{selectedPosition || 'All'} Players</h3>
        
        {loading ? (
          <SkeletonPlayerList count={10} />
        ) : error ? (
          <div className="text-red-500 p-4">{error}</div>
        ) : (
          <ul className="space-y-1">
            {sortPlayers(getFilteredPlayers()).map((player, i) => {
              const isStarting = Object.values(starters).includes(player.name);
              const isStartingThisPosition = starters[selectedPosition || ''] === player.name;
              const rowStatus = getPlayerRowStatus(player);
              const hasGameToday = rowStatus === 'active';
              const isIL = rowStatus === 'il';
              
              return (
                <li 
                  key={i} 
                  className={`flex items-center text-gray-800 text-sm rounded px-2 py-1.5 ${
                    isStarting ? 'bg-green-50' : 
                    isIL ? 'bg-red-50' : 
                    !hasGameToday ? 'bg-gray-50' : 
                    'hover:bg-gray-50'
                  } ${
                    selectedPosition && isStartingThisPosition ? 'border border-green-500' : ''
                  }`}
                >
                  {/* Player icon */}
                  {player.image_url ? (
                    <img src={player.image_url} alt={player.name} className="w-7 h-7 rounded-full mr-2 border object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-200 mr-2 flex items-center justify-center">
                      <span className="text-xs text-gray-500">{player.name.charAt(0)}</span>
                    </div>
                  )}
                  
                  {/* Player info */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center flex-wrap">
                      <span className="font-medium truncate mr-1">{player.name}</span>
                      
                      {/* Status badges */}
                      {player.status && (
                        <span className={`px-1 py-0.5 text-xs rounded ${
                          player.status.includes('IL') || player.status.includes('DL')
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {player.status}
                        </span>
                      )}
                      
                      {/* Starting badge */}
                      {isStarting && (
                        <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-800">
                          Starting
                        </span>
                      )}
                      
                      {/* Pitching today badge */}
                      {player.pitching_today && (
                        <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-800">
                          Pitching
                        </span>
                      )}
                      
                      {/* No game badge */}
                      {!hasGameToday && !isIL && (
                        <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-800">
                          No Game
                        </span>
                      )}
                    </div>
                    
                    {/* Team and position info */}
                    <div className="text-xs text-gray-500 flex items-center mt-0.5">
                      <span>{player.team}</span>
                      <span className="mx-1 h-1 w-1 rounded-full bg-gray-300"></span>
                      <span>{player.eligiblePositions?.join(', ') || player.position}</span>
                      
                      {/* Matchup info when available */}
                      {hasGameToday && player.matchup && (
                        <>
                          <span className="mx-1 h-1 w-1 rounded-full bg-gray-300"></span>
                          <span>
                            {player.matchup.home_away === 'home' ? 'vs ' : '@ '}
                            {player.matchup.opponent}
                            {player.matchup.time && ` (${player.matchup.time})`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Action buttons */}
                  <div className="flex space-x-1 ml-2">
                    {/* Debug button - only show for development */}
                    {process.env.NODE_ENV === 'development' && player.playerKey && (
                      <button
                        onClick={() => debugPlayerGame(player.playerKey, player.teamKey)}
                        disabled={debugLoading}
                        className="px-1.5 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                        title="Debug game data"
                      >
                        {debugLoading ? '...' : 'Debug'}
                      </button>
                    )}
                    
                    {/* Set as starter button - only when position is selected */}
                    {selectedPosition && (
                      <button
                        onClick={() => handleStarterSelect(player.name)}
                        className={`px-1.5 py-0.5 text-xs rounded ${
                          isStartingThisPosition
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                        }`}
                      >
                        {isStartingThisPosition ? 'Starting' : 'Start'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      
      {/* Current starters */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <h3 className="text-md font-medium mb-3">Current Lineup</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL'].map(position => {
            const starterName = starters[position];
            const starterData = rosterData.find(p => p.name === starterName);
            
            return (
              <div 
                key={position}
                className={`border rounded p-3 ${
                  starterName ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{position}</span>
                  {starterName && selectedPosition === position && (
                    <button
                      onClick={() => {
                        setStarters(prev => {
                          const newStarters = {...prev};
                          delete newStarters[position];
                          return newStarters;
                        });
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
                
                {starterName ? (
                  <div className="mt-1">
                    <div className="font-medium text-sm">{starterName}</div>
                    {starterData && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {starterData.team}
                        {starterData.matchup && starterData.matchup.date === selectedDate && (
                          <span className="ml-1">
                            {starterData.matchup.home_away === 'home' ? 'vs ' : '@ '}
                            {starterData.matchup.opponent}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 mt-1">No player selected</div>
                )}
              </div>
            );
          })}
        </div>
        
        <div className="mt-4 text-right">
          <button 
            className="bg-purple-600 text-white px-4 py-2 rounded font-medium hover:bg-purple-700 transition"
            onClick={() => console.log('Saving lineup:', starters)}
          >
            Save Lineup
          </button>
        </div>
      </div>
    </div>
  );
} 