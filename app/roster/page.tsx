'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SkeletonPlayerList } from '../components/SkeletonLoading';
import { format } from 'date-fns';
import Link from 'next/link';

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

export default function RosterPage() {
  const router = useRouter();
  const [rosterData, setRosterData] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState('batters');
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [detailView, setDetailView] = useState(false);
  
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

  // Function to render player status icon
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

  // Function to check if player has game today
  const hasGameToday = (player: Player) => {
    return player.has_game_today || 
      (player.matchup && player.matchup.date === selectedDate);
  };

  // Render game matchup info
  const renderMatchupInfo = (player: Player) => {
    if (!player.matchup) return null;
    
    const isHome = player.matchup.home_away === 'home';
    return (
      <div className="text-xs text-gray-600">
        {isHome ? 'vs ' : '@ '}
        <span className="font-medium">{player.matchup.opponent}</span>
        {player.matchup.time && (
          <span className="ml-1">{player.matchup.time}</span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Roster Management</h1>
          <p className="text-gray-600 mt-1">
            {rosterData.length} players • {rosterData.filter(p => hasGameToday(p)).length} with games today • 
            {rosterData.filter(p => p.status && (p.status === 'IL' || p.status.includes('IL'))).length} on IL
          </p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={() => setDetailView(false)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium ${
              !detailView 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Table View
          </button>
          <button 
            onClick={() => setDetailView(true)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium ${
              detailView 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Card View
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md">
        {/* Batters/Pitchers toggle */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex max-w-xs bg-gray-100 rounded-md p-1">
            <button 
              onClick={() => setRosterFilter('batters')}
              className={`flex-1 py-2 px-4 text-sm rounded-md transition-colors ${rosterFilter === 'batters' 
                ? 'bg-white text-purple-600 shadow-sm' 
                : 'text-gray-600 hover:bg-gray-200'}`}
            >
              Batters
            </button>
            <button 
              onClick={() => setRosterFilter('pitchers')}
              className={`flex-1 py-2 px-4 text-sm rounded-md transition-colors ${rosterFilter === 'pitchers' 
                ? 'bg-white text-purple-600 shadow-sm' 
                : 'text-gray-600 hover:bg-gray-200'}`}
            >
              Pitchers
            </button>
          </div>
        </div>
        
        {/* Roster list */}
        <div className="p-4">
          {loading ? (
            <SkeletonPlayerList count={12} isPitcher={rosterFilter === 'pitchers'} />
          ) : error ? (
            <div className="bg-red-50 text-red-700 p-4 rounded">
              {error}
            </div>
          ) : rosterData.length > 0 ? (
            detailView ? (
              // Card view
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sortPlayers(rosterData
                  .filter(player => {
                    // Filter based on position type
                    const isPitcher = player.position.includes('P');
                    return rosterFilter === 'pitchers' ? isPitcher : !isPitcher;
                  }))
                  .map((player, index) => {
                    const rowStatus = getPlayerRowStatus(player);
                    const cardColorClass = 
                      rowStatus === 'il' ? 'border-red-200 bg-red-50' :
                      rowStatus === 'no-game' ? 'border-gray-200 bg-gray-50' : 'border-gray-200';
                    
                    return (
                      <div 
                        key={index} 
                        className={`p-4 rounded-lg border ${cardColorClass} transition-all hover:shadow-md`}
                      >
                        <div className="flex items-start space-x-3">
                          {player.image_url && (
                            <img 
                              src={player.image_url} 
                              alt={player.name} 
                              className="w-16 h-16 rounded-full border object-cover flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 truncate">{player.name}</h3>
                            
                            <div className="flex flex-wrap gap-1 mt-1">
                              <span className="text-sm text-gray-500">{player.team}</span>
                              <span className="text-sm text-gray-400">•</span>
                              <span className="text-sm text-gray-500">{player.position}</span>
                            </div>
                            
                            <div className="flex flex-wrap mt-2">
                              {player.status ? renderPlayerStatus(player) : 
                                <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">Healthy</span>}
                              {player.pitching_today === true ? renderPitchingToday(player) : null}
                              {hasGameToday(player) ? (
                                <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-800">Game Today</span>
                              ) : (
                                <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-800">No Game</span>
                              )}
                            </div>

                            {renderMatchupInfo(player)}
                          </div>
                        </div>
                        
                        {/* Stats section */}
                        {player.stats && Object.keys(player.stats).length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <div className="grid grid-cols-4 gap-2 text-center">
                              {rosterFilter === 'batters' ? (
                                <>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">AVG</div>
                                    <div className="font-medium">{player.stats.AVG || '-'}</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">HR</div>
                                    <div className="font-medium">{player.stats.HR || '-'}</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">RBI</div>
                                    <div className="font-medium">{player.stats.RBI || '-'}</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">SB</div>
                                    <div className="font-medium">{player.stats.SB || '-'}</div>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">ERA</div>
                                    <div className="font-medium">{player.stats.ERA || '-'}</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">WHIP</div>
                                    <div className="font-medium">{player.stats.WHIP || '-'}</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">W</div>
                                    <div className="font-medium">{player.stats.W || '-'}</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">K</div>
                                    <div className="font-medium">{player.stats.K || player.stats.SO || '-'}</div>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Actions row */}
                        <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between">
                          <a 
                            href={`https://sports.yahoo.com/mlb/players/${player.playerKey?.split('.').pop()}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-purple-600 hover:text-purple-800"
                          >
                            View on Yahoo
                          </a>
                          <Link 
                            href={`/lineup?position=${player.eligiblePositions?.[0] || ''}&player=${player.name}`}
                            className="text-xs text-purple-600 hover:text-purple-800"
                          >
                            Set in Lineup
                          </Link>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              // Table view
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Player
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Position
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Team
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Matchup
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Stats
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortPlayers(rosterData
                      .filter(player => {
                        // Filter based on position type
                        const isPitcher = player.position.includes('P');
                        return rosterFilter === 'pitchers' ? isPitcher : !isPitcher;
                      }))
                      .map((player, index) => {
                        const rowStatus = getPlayerRowStatus(player);
                        const rowColorClass = 
                          rowStatus === 'il' ? 'bg-red-50' :
                          rowStatus === 'no-game' ? 'bg-gray-50' : '';
                        
                        return (
                          <tr key={index} className={rowColorClass}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                {player.image_url && (
                                  <img 
                                    src={player.image_url} 
                                    alt={player.name} 
                                    className="w-10 h-10 rounded-full mr-3 border object-cover"
                                  />
                                )}
                                <div>
                                  <div className="text-sm font-medium text-gray-900">{player.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">
                                {player.eligiblePositions?.join(', ') || player.position}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">{player.team}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                {player.status ? renderPlayerStatus(player) : 
                                  <span className="text-sm text-gray-500">Healthy</span>}
                                {player.pitching_today === true ? renderPitchingToday(player) : null}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {hasGameToday(player) ? (
                                <div>
                                  <div className="text-sm">
                                    <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                      Today
                                    </span>
                                  </div>
                                  {renderMatchupInfo(player)}
                                </div>
                              ) : (
                                <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                                  No Game
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {player.stats ? (
                                <div className="text-sm flex space-x-3">
                                  {rosterFilter === 'batters' ? (
                                    <>
                                      <span>AVG: <span className="font-medium">{player.stats.AVG || '-'}</span></span>
                                      <span>HR: <span className="font-medium">{player.stats.HR || '-'}</span></span>
                                      <span>RBI: <span className="font-medium">{player.stats.RBI || '-'}</span></span>
                                    </>
                                  ) : (
                                    <>
                                      <span>ERA: <span className="font-medium">{player.stats.ERA || '-'}</span></span>
                                      <span>WHIP: <span className="font-medium">{player.stats.WHIP || '-'}</span></span>
                                      <span>W: <span className="font-medium">{player.stats.W || '-'}</span></span>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm text-gray-500">No stats</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="text-center text-gray-500 py-8">
              No roster data available
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 