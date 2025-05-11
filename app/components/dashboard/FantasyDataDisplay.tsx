'use client';

import { useState } from 'react';
import { useFantasyData } from '@/app/providers/fantasy-data-provider';
import { useLeagueStandings, useLeagueTransactions } from '@/app/hooks/useLeague';
import { useTeamRoster } from '@/app/hooks/useTeam';

export default function FantasyDataDisplay() {
  // Get core data from context
  const { leagueId, teamId, leagueName, teamName } = useFantasyData();
  
  // If no league/team selected, show a placeholder
  if (!leagueId || !teamId) {
    return (
      <div className="p-4 border rounded-lg bg-gray-50">
        <h2 className="text-xl font-semibold mb-4">Fantasy Data Demo</h2>
        <p>No league or team selected. Please connect to Yahoo Fantasy.</p>
      </div>
    );
  }
  
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <LeagueStandingsCard leagueId={leagueId} leagueName={leagueName} />
      <TeamRosterCard teamId={teamId} teamName={teamName} />
      <RecentTransactionsCard leagueId={leagueId} />
    </div>
  );
}

// Card component for league standings
function LeagueStandingsCard({ leagueId, leagueName }: { leagueId: string, leagueName: string | null }) {
  const { data: standings, isLoading, isError } = useLeagueStandings(leagueId);
  
  if (isLoading) {
    return <LoadingCard title="League Standings" />;
  }
  
  if (isError || !standings) {
    return <ErrorCard title="League Standings" />;
  }
  
  return (
    <div className="p-4 border rounded-lg shadow-sm bg-white">
      <h2 className="text-xl font-semibold mb-4">{leagueName || 'League'} Standings</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">TEAM</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">W</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">L</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">PCT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {/* Render standings data - this is a simplified example */}
            {standings.teams?.map((team: any) => (
              <tr key={team.team_id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm">{team.name}</td>
                <td className="px-4 py-2 text-sm">{team.wins}</td>
                <td className="px-4 py-2 text-sm">{team.losses}</td>
                <td className="px-4 py-2 text-sm">{team.winning_percentage?.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Card component for team roster
function TeamRosterCard({ teamId, teamName }: { teamId: string, teamName: string | null }) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const { data: roster, isLoading, isError, refetch } = useTeamRoster(teamId, selectedDate || undefined);
  
  if (isLoading) {
    return <LoadingCard title="Team Roster" />;
  }
  
  if (isError || !roster) {
    return <ErrorCard title="Team Roster" />;
  }
  
  return (
    <div className="p-4 border rounded-lg shadow-sm bg-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{teamName || 'Team'} Roster</h2>
        <div className="flex space-x-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-2 py-1 text-sm border rounded"
          />
          <button 
            onClick={() => refetch()}
            className="px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Refresh
          </button>
        </div>
      </div>
      
      <div className="overflow-y-auto max-h-96">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">POS</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">PLAYER</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">TEAM</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">STATUS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {/* Render roster data - this is a simplified example */}
            {roster.roster?.players?.map((player: any) => (
              <tr key={player.player_id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm">{player.selected_position?.position}</td>
                <td className="px-4 py-2 text-sm">{player.name?.full}</td>
                <td className="px-4 py-2 text-sm">{player.editorial_team_abbr}</td>
                <td className="px-4 py-2 text-sm">
                  <StatusBadge status={player.status || 'ACTIVE'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Card component for recent league transactions
function RecentTransactionsCard({ leagueId }: { leagueId: string }) {
  const { data: transactions, isLoading, isError } = useLeagueTransactions(
    leagueId, 
    ['add', 'drop', 'trade'], 
    5
  );
  
  if (isLoading) {
    return <LoadingCard title="Recent Transactions" />;
  }
  
  if (isError || !transactions) {
    return <ErrorCard title="Recent Transactions" />;
  }
  
  return (
    <div className="p-4 border rounded-lg shadow-sm bg-white md:col-span-2">
      <h2 className="text-xl font-semibold mb-4">Recent Transactions</h2>
      <div className="space-y-2">
        {transactions.map((transaction: any) => (
          <div key={transaction.id} className="border-b pb-2">
            <div className="flex justify-between">
              <div className="font-medium">{transaction.type}</div>
              <div className="text-sm text-gray-500">{formatDate(transaction.timestamp)}</div>
            </div>
            <div className="text-sm">{transaction.description || 'No description available'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper components
function LoadingCard({ title }: { title: string }) {
  return (
    <div className="p-4 border rounded-lg shadow-sm bg-white">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <div className="flex justify-center py-8">
        <div className="animate-pulse text-blue-500">Loading data...</div>
      </div>
    </div>
  );
}

function ErrorCard({ title }: { title: string }) {
  return (
    <div className="p-4 border rounded-lg shadow-sm bg-white">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <div className="text-red-500 py-4">
        Failed to load data. Please try again later.
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  let bgColor = 'bg-green-100 text-green-800';
  
  if (status === 'DTD') {
    bgColor = 'bg-yellow-100 text-yellow-800';
  } else if (status === 'IL' || status.includes('IL')) {
    bgColor = 'bg-red-100 text-red-800';
  } else if (status === 'NA' || status === 'SUSP') {
    bgColor = 'bg-gray-100 text-gray-800';
  }
  
  return (
    <span className={`px-2 py-1 text-xs rounded ${bgColor}`}>
      {status}
    </span>
  );
}

// Helper function to format dates
function formatDate(timestamp: number | string): string {
  if (!timestamp) return 'Unknown';
  
  const date = typeof timestamp === 'number' 
    ? new Date(timestamp) 
    : new Date(timestamp);
    
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
} 