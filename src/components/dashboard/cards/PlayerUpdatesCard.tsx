'use client';

import { FiBell } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useRoster } from '@/lib/hooks/useRoster';

function statusColor(status: string | undefined): string {
  if (!status) return 'border-primary';
  if (status === 'IL' || status === 'IL10' || status === 'IL60' || status === 'DL') return 'border-error';
  if (status === 'DTD') return 'border-accent';
  if (status === 'NA') return 'border-muted-foreground';
  return 'border-primary';
}

function statusBadge(status: string | undefined): { label: string; bg: string; text: string } | null {
  if (!status) return null;
  if (status === 'IL' || status === 'IL10' || status === 'IL60' || status === 'DL')
    return { label: status, bg: 'bg-error-100', text: 'text-error-800' };
  if (status === 'DTD')
    return { label: 'Day-to-Day', bg: 'bg-accent-100', text: 'text-accent-800' };
  if (status === 'NA')
    return { label: 'Not Active', bg: 'bg-primary-100', text: 'text-primary-800' };
  return { label: status, bg: 'bg-primary-100', text: 'text-primary-800' };
}

export default function PlayerUpdatesCard() {
  const { teamKey } = useFantasy();
  const { roster, isLoading } = useRoster(teamKey);

  // Show players with a status flag (injured, DTD, IL, etc.)
  const playersWithStatus = roster
    .filter(p => p.status)
    .slice(0, 5);

  return (
    <DashboardCard
      title="Player Updates"
      icon={FiBell}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        {playersWithStatus.length > 0 ? (
          <div className="space-y-3">
            {playersWithStatus.map(player => {
              const badge = statusBadge(player.status);
              return (
                <div key={player.player_key} className={`border-l-4 ${statusColor(player.status)} pl-3 py-1`}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-sm">{player.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {player.editorial_team_abbr} - {player.display_position}
                    </span>
                  </div>
                  {player.status_full && (
                    <p className="text-xs text-muted-foreground">{player.status_full}</p>
                  )}
                  {badge && (
                    <span className={`inline-block mt-1 px-2 py-0.5 ${badge.bg} ${badge.text} text-xs rounded`}>
                      {badge.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-4">
            <span className="text-success text-2xl">{'\u2705'}</span>
            <p className="text-sm text-muted-foreground mt-2">
              {roster.length > 0 ? 'All players healthy' : 'No roster data available'}
            </p>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
