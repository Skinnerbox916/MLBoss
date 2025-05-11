'use client';

import { useState } from 'react';
import { useTeam, useTeamRoster, useLeague, useLeagueStandings, usePlayerSearch } from '@/app/hooks/useYahooData';

/**
 * Example component showing how to use Yahoo data hooks
 */
export default function YahooDataHookExample() {
  // Player search state
  const [searchQuery, setSearchQuery] = useState('');
  
  // Using multiple hooks to fetch different types of data
  const { 
    data: team, 
    loading: teamLoading, 
    error: teamError 
  } = useTeam();
  
  const { 
    data: roster, 
    loading: rosterLoading, 
    error: rosterError 
  } = useTeamRoster();
  
  const { 
    data: league, 
    loading: leagueLoading, 
    error: leagueError 
  } = useLeague();
  
  const { 
    data: standings, 
    loading: standingsLoading, 
    refresh: refreshStandings 
  } = useLeagueStandings();
  
  const { 
    data: searchResults, 
    loading: searchLoading 
  } = usePlayerSearch(searchQuery);
  
  // Calculate overall loading state
  const isLoading = teamLoading || rosterLoading || leagueLoading || standingsLoading;
  
  // Combine all potential errors
  const errors = [teamError, rosterError, leagueError].filter(Boolean);
  
  // Handle search input
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  if (isLoading) {
    return <div className="p-4">Loading Yahoo Fantasy data...</div>;
  }
  
  if (errors.length > 0) {
    return (
      <div className="p-4 text-red-600">
        <h2 className="text-lg font-bold">Error Loading Data</h2>
        {errors.map((error, i) => (
          <p key={i}>{error?.message}</p>
        ))}
      </div>
    );
  }
  
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6">Yahoo API Hooks Example</h1>
      
      {/* Team Information */}
      {team && (
        <div className="mb-6 p-4 bg-white shadow rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Team Information</h2>
          <div className="flex items-center">
            {team.logo_url && (
              <img 
                src={team.logo_url} 
                alt={`${team.name} Logo`} 
                className="h-12 w-12 mr-3 rounded-full" 
              />
            )}
            <div>
              <h3 className="font-bold text-lg">{team.name}</h3>
              <p className="text-gray-600">Manager: {team.manager_name}</p>
            </div>
          </div>
        </div>
      )}
      
      {/* League Information */}
      {league && (
        <div className="mb-6 p-4 bg-white shadow rounded-lg">
          <h2 className="text-xl font-semibold mb-2">League Information</h2>
          <p><span className="font-medium">League Name:</span> {league.name}</p>
          <p><span className="font-medium">Current Week:</span> {league.current_week} of {league.end_week}</p>
          {league.settings && (
            <p><span className="font-medium">Scoring Type:</span> {league.settings.scoring_type}</p>
          )}
        </div>
      )}
      
      {/* Standings */}
      {standings && standings.standings && (
        <div className="mb-6 p-4 bg-white shadow rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-semibold">League Standings</h2>
            <button 
              onClick={refreshStandings} 
              className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
            >
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">W-L-T</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Win %</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {standings.standings.teams.team.map((team) => (
                  <tr key={team.team_key} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-sm">{team.team_standings?.rank}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-sm font-medium">{team.name}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm">
                      {team.team_standings?.outcome_totals.wins}-
                      {team.team_standings?.outcome_totals.losses}-
                      {team.team_standings?.outcome_totals.ties}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm">
                      {Number(team.team_standings?.outcome_totals.percentage || 0).toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Team Roster */}
      {roster && roster.roster && (
        <div className="mb-6 p-4 bg-white shadow rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Team Roster</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {roster.roster.players.map((player) => (
              <div key={player.player_key} className="border rounded p-2 flex items-center">
                {player.image_url && (
                  <img 
                    src={player.image_url} 
                    alt={player.name.full} 
                    className="h-10 w-10 mr-2 rounded-full"
                  />
                )}
                <div>
                  <div className="font-medium text-sm">{player.name.full}</div>
                  <div className="text-xs text-gray-500">
                    {player.editorial_team_abbr} - {player.display_position}
                    {player.status && <span className="ml-1 text-red-500">{player.status}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Player Search */}
      <div className="mb-6 p-4 bg-white shadow rounded-lg">
        <h2 className="text-xl font-semibold mb-3">Player Search</h2>
        <div className="flex mb-3">
          <input
            type="text"
            placeholder="Search for players..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="flex-1 px-3 py-2 border rounded-l focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button 
            className="bg-blue-500 text-white px-4 py-2 rounded-r hover:bg-blue-600"
          >
            Search
          </button>
        </div>
        
        {searchLoading ? (
          <p className="text-gray-500">Searching...</p>
        ) : searchResults && searchResults.length > 0 ? (
          <div className="max-h-80 overflow-y-auto border rounded">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Position</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {searchResults.map((player) => (
                  <tr key={player.player_key} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center">
                        {player.image_url && (
                          <img 
                            src={player.image_url} 
                            alt={player.name.full} 
                            className="h-8 w-8 mr-2 rounded-full"
                          />
                        )}
                        <div className="text-sm font-medium">{player.name.full}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm">{player.editorial_team_abbr}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800">
                        {player.display_position}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : searchQuery ? (
          <p className="text-gray-500">No players found matching "{searchQuery}"</p>
        ) : (
          <p className="text-gray-500">Enter a search term to find players</p>
        )}
      </div>
      
      {/* Code Example */}
      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h2 className="text-xl font-semibold mb-3">How to Use These Hooks</h2>
        <div className="bg-gray-800 text-white p-4 rounded-lg overflow-x-auto">
          <pre className="text-sm">
{`// Import the hooks
import { 
  useTeam, 
  useTeamRoster, 
  useLeague, 
  usePlayerSearch 
} from '@/app/hooks/useYahooData';

// Use the hooks in your component
function MyComponent() {
  // Basic usage - will fetch on component mount
  const { data: team, loading, error } = useTeam();

  // With custom parameters
  const { data: roster } = useTeamRoster('team.key.123');

  // With refresh function
  const { 
    data: standings, 
    refresh: refreshStandings 
  } = useLeagueStandings();

  // With search functionality
  const [query, setQuery] = useState('');
  const { data: searchResults } = usePlayerSearch(query);

  // Handle form update
  const handleSearch = (e) => {
    setQuery(e.target.value);
    // The hook will automatically re-fetch when query changes
  };

  // Render your component using the data
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h1>{team?.name}</h1>
      <button onClick={refreshStandings}>Refresh Standings</button>
      {/* Rest of your component */}
    </div>
  );
}`}
          </pre>
        </div>
      </div>
    </div>
  );
} 