'use client';

import { useState, useEffect } from 'react';
import { yahooServices } from '@/app/services/yahoo';
import { YahooPlayer, YahooTeam, YahooLeague } from '@/app/types/yahoo';

/**
 * Example component showing how to use Yahoo API services
 */
export default function YahooDataExample() {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  const [teamData, setTeamData] = useState<YahooTeam | null>(null);
  const [rosterPlayers, setRosterPlayers] = useState<YahooPlayer[]>([]);
  const [leagueData, setLeagueData] = useState<YahooLeague | null>(null);
  
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      
      try {
        // Example 1: Get current user's team
        const team = await yahooServices.team.getTeam();
        setTeamData(team);
        
        // Example 2: Get team roster
        const teamWithRoster = await yahooServices.team.getTeamRoster();
        if (teamWithRoster.roster?.players) {
          setRosterPlayers(teamWithRoster.roster.players);
        }
        
        // Example 3: Get league data
        const league = await yahooServices.league.getLeague();
        setLeagueData(league);
        
      } catch (err) {
        console.error('Error fetching Yahoo data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchData();
  }, []);
  
  if (isLoading) {
    return <div className="p-4">Loading Yahoo Fantasy data...</div>;
  }
  
  if (error) {
    return (
      <div className="p-4 text-red-600">
        <h2 className="text-lg font-bold">Error Loading Data</h2>
        <p>{error}</p>
      </div>
    );
  }
  
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6">Yahoo Fantasy Data Example</h1>
      
      {/* Team Info Section */}
      {teamData && (
        <div className="mb-8 p-4 border border-gray-200 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Team Information</h2>
          <div className="flex items-center mb-4">
            {teamData.logo_url && (
              <img 
                src={teamData.logo_url} 
                alt={`${teamData.name} Logo`} 
                className="h-16 w-16 mr-4 rounded-full"
              />
            )}
            <div>
              <h3 className="text-lg font-bold">{teamData.name}</h3>
              <p className="text-gray-600">Manager: {teamData.manager_name}</p>
            </div>
          </div>
          
          {/* Team Stats */}
          {teamData.team_standings && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2">Standings</h4>
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div className="bg-gray-100 p-2 rounded">
                  <span className="block text-gray-600">Rank</span>
                  <span className="font-bold">{teamData.team_standings.rank}</span>
                </div>
                <div className="bg-gray-100 p-2 rounded">
                  <span className="block text-gray-600">Wins</span>
                  <span className="font-bold">{teamData.team_standings.outcome_totals.wins}</span>
                </div>
                <div className="bg-gray-100 p-2 rounded">
                  <span className="block text-gray-600">Losses</span>
                  <span className="font-bold">{teamData.team_standings.outcome_totals.losses}</span>
                </div>
                <div className="bg-gray-100 p-2 rounded">
                  <span className="block text-gray-600">Ties</span>
                  <span className="font-bold">{teamData.team_standings.outcome_totals.ties}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Roster Section */}
      {rosterPlayers.length > 0 && (
        <div className="mb-8 p-4 border border-gray-200 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Team Roster</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Player</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Position</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rosterPlayers.map((player) => (
                  <tr key={player.player_key} className="hover:bg-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex items-center">
                        {player.image_url && (
                          <img 
                            src={player.image_url} 
                            alt={player.name.full} 
                            className="h-10 w-10 mr-2 rounded-full"
                          />
                        )}
                        <div>
                          <div className="font-medium">{player.name.full}</div>
                          <div className="text-xs text-gray-500">{player.player_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {player.editorial_team_abbr}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                        {player.display_position}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {player.status && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          player.status === 'IL' ? 'bg-red-100 text-red-800' :
                          player.status === 'NA' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {player.status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* League Information */}
      {leagueData && (
        <div className="mb-8 p-4 border border-gray-200 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">League Information</h2>
          <div className="mb-4">
            <h3 className="text-lg font-bold">{leagueData.name}</h3>
            <p className="text-gray-600">
              Week {leagueData.current_week} of {leagueData.end_week}
            </p>
          </div>
          
          {/* League Settings */}
          {leagueData.settings && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2">League Settings</h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="bg-gray-100 p-2 rounded">
                  <span className="block text-gray-600">Scoring Type</span>
                  <span className="font-bold">{leagueData.settings.scoring_type}</span>
                </div>
                <div className="bg-gray-100 p-2 rounded">
                  <span className="block text-gray-600">Draft Type</span>
                  <span className="font-bold">{leagueData.settings.draft_type}</span>
                </div>
                <div className="bg-gray-100 p-2 rounded">
                  <span className="block text-gray-600">Teams</span>
                  <span className="font-bold">{leagueData.num_teams}</span>
                </div>
              </div>
            </div>
          )}
          
          {/* League Stats Categories */}
          {leagueData.settings?.stat_categories && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2">Stat Categories</h4>
              <div className="flex flex-wrap gap-2">
                {leagueData.settings.stat_categories.stats.stat.map((stat) => (
                  <span 
                    key={stat.stat_id} 
                    className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800"
                  >
                    {stat.display_name || stat.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* API Services Usage Examples */}
      <div className="mt-8 p-4 border border-gray-200 rounded-lg bg-gray-50">
        <h2 className="text-xl font-semibold mb-4">How to Use These Services</h2>
        <div className="bg-gray-800 text-white p-4 rounded-lg overflow-x-auto">
          <pre className="text-sm">
{`// Import the services
import { yahooServices } from '@/app/services/yahoo';

// Get player data
const player = await yahooServices.player.getPlayer('player_key');

// Get team roster
const roster = await yahooServices.team.getTeamRoster();

// Get league standings
const standings = await yahooServices.league.getLeagueStandings();

// Search for players
const players = await yahooServices.player.searchPlayers('Mike Trout');

// Get player's game info
const gameInfo = await yahooServices.player.getPlayerGameInfo('player_key');

// Get current matchup
const matchup = await yahooServices.team.getCurrentMatchup();

// Get league transactions
const transactions = await yahooServices.league.getLeagueTransactions();`}
          </pre>
        </div>
      </div>
    </div>
  );
} 