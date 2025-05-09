'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SkeletonPlayerList } from '../components/SkeletonLoading';
import PositionDisplay from '../components/PositionDisplay';
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
    <div className="space-y-4">
      {/* Debug Results Modal */}
      {debugResults && <DebugResultsModal />}

      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Lineup Builder</h1>
            <p className="text-sm text-gray-600">
              {selectedDate && format(new Date(selectedDate), 'EEEE, MMMM d, yyyy')}
            </p>
          </div>
          
          {/* Compact Date Selector */}
          <div className="mt-3 sm:mt-0">
            <div className="inline-flex rounded-lg shadow-sm overflow-hidden">
              {dateOptions.map((opt, index) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedDate(opt.value)}
                  className={`relative px-3 py-2 text-xs font-medium transition-colors
                    ${selectedDate === opt.value 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}
                    ${index === 0 ? 'rounded-l-lg' : ''}
                    ${index === dateOptions.length - 1 ? 'rounded-r-lg' : ''}
                    border-r last:border-r-0 border-gray-200`}
                >
                  <div className="flex flex-col items-center">
                    <span className="font-bold">{opt.label}</span>
                    <span className="text-xs">{opt.fullLabel}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-4">
        {/* Position selection - use PositionDisplay component */}
        <PositionDisplay 
          onPositionSelect={handlePositionSelect}
          selectedPosition={selectedPosition}
        />

        {/* Player selection */}
        <div className="mt-4">
          {loading ? (
            <SkeletonPlayerList />
          ) : error ? (
            <div className="bg-red-50 text-red-700 p-4 rounded">
              {error}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">R</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">HR</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">RBI</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">SB</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">AVG</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">OPS</th>
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
                        rowStatus === 'il' ? 'bg-red-50' :
                        rowStatus === 'no-game' ? 'bg-gray-50' : ''
                      }>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`starter-${selectedPosition}`}
                              checked={isStarter}
                              onChange={() => handleStarterSelect(player.name)}
                              disabled={!selectedPosition}
                              className="h-3 w-3 text-blue-600 border-gray-300 focus:ring-blue-500"
                            />
                            {player.image_url && (
                              <img src={player.image_url} alt={player.name} className="w-8 h-8 rounded-full border object-cover" />
                            )}
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="font-medium text-sm">{player.name}</span>
                                <span className="text-xs text-gray-500">{player.team}</span>
                                {player.status === 'DTD' && (
                                  <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs font-medium">DTD</span>
                                )}
                                {player.status && player.status.includes('IL') && (
                                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-xs font-medium">{player.status}</span>
                                )}
                                <button 
                                  onClick={(e) => {
                                    e.preventDefault();
                                    debugPlayerGame(player.playerKey, player.teamKey);
                                  }}
                                  className="px-1.5 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
                                  title="Debug Yahoo API"
                                >
                                  Debug
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {eligiblePositions.map((pos, idx) => (
                                  <span
                                    key={idx}
                                    className={`text-xs px-1 py-0 rounded ${
                                      pos === selectedPosition && isStarter
                                        ? 'bg-blue-100 text-blue-800 font-medium'
                                        : 'bg-gray-200 text-gray-700'
                                    }`}
                                  >
                                    {pos}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center text-xs">{player.stats?.R ?? '-'}</td>
                        <td className="px-3 py-2 text-center text-xs">{player.stats?.HR ?? '-'}</td>
                        <td className="px-3 py-2 text-center text-xs">{player.stats?.RBI ?? '-'}</td>
                        <td className="px-3 py-2 text-center text-xs">{player.stats?.SB ?? '-'}</td>
                        <td className="px-3 py-2 text-center text-xs">{player.stats?.AVG ?? '-'}</td>
                        <td className="px-3 py-2 text-center text-xs">{player.stats?.OPS ?? '-'}</td>
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
  );
} 