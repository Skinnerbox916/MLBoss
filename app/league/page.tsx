'use client';

import { useTeam } from '@/app/utils/TeamContext';
import { useRouter } from 'next/navigation';
import { getOrdinalSuffix } from '@/app/utils/formatters';

// Define an interface for the team in standings
interface StandingsTeam {
  id: number;
  name: string;
  isYourTeam: boolean;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  gb: string; // Using string for games behind to display with decimal
}

export default function LeaguePage() {
  const { teamData, loading, error } = useTeam();
  const router = useRouter();

  // Get safe access to team properties
  const getTeamProperty = (property: string, fallback: any = null) => {
    if (!teamData?.team) return fallback;
    return teamData.team[property] !== undefined ? teamData.team[property] : fallback;
  };

  // Placeholder data for standings until API is implemented
  const placeholderStandings: StandingsTeam[] = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    name: i === getTeamProperty('rank', 1) - 1 ? getTeamProperty('name', 'Your Team') : `Team ${i + 1}`,
    isYourTeam: i === getTeamProperty('rank', 1) - 1,
    wins: Math.floor(Math.random() * 20),
    losses: Math.floor(Math.random() * 20),
    ties: Math.floor(Math.random() * 5),
    winPct: 0,
    gb: '0'
  }));

  // Calculate win percentages and games behind
  placeholderStandings.forEach(team => {
    team.winPct = team.wins / (team.wins + team.losses + team.ties);
  });

  // Sort by win percentage
  placeholderStandings.sort((a, b) => b.winPct - a.winPct);

  // Calculate games behind
  const leader = placeholderStandings[0];
  placeholderStandings.forEach(team => {
    if (team === leader) {
      team.gb = '0';
    } else {
      const gbValue = ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2;
      team.gb = gbValue.toFixed(1);
    }
  });

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="bg-white rounded-lg shadow-md p-4 h-24"></div>
        <div className="bg-white rounded-lg shadow-md p-4 h-96"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-800 p-4 rounded-lg shadow">
        <h2 className="text-lg font-medium mb-2">Error Loading League Data</h2>
        <p>{error}</p>
        <button 
          onClick={() => router.refresh()}
          className="mt-3 bg-red-100 hover:bg-red-200 text-red-800 px-4 py-2 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-4">
        <h1 className="text-2xl font-bold text-gray-800">League: {getTeamProperty('league_name', 'Fantasy League')}</h1>
        <p className="text-gray-600">
          Your Rank: {getOrdinalSuffix(getTeamProperty('rank', '-'))} of {getTeamProperty('num_teams', '-')} teams
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="border-b border-gray-200 p-4">
          <h2 className="text-lg font-medium">League Standings</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rank
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Team
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  W
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  L
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  T
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Win%
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  GB
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {placeholderStandings.map((team, index) => (
                <tr key={team.id} className={team.isYourTeam ? 'bg-purple-50' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {index + 1}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="text-sm font-medium text-gray-900 flex items-center">
                        {team.name}
                        {team.isYourTeam && (
                          <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-800">
                            Your Team
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {team.wins}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {team.losses}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {team.ties}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {team.winPct.toFixed(3)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {team.gb}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-lg font-medium mb-4">Recent Transactions</h2>
        <p className="text-gray-500 text-sm">
          Transaction data not available yet. Coming soon!
        </p>
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-lg font-medium mb-4">League Settings</h2>
        <p className="text-gray-500 text-sm">
          League settings not available yet. Coming soon!
        </p>
      </div>
    </div>
  );
} 