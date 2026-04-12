'use client';

import { FiHeart } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useRoster } from '@/lib/hooks/useRoster';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';

type StatusTier = 'dtd' | 'il' | 'na';

function getStatusTier(player: RosterEntry): StatusTier | null {
  const s = player.status;
  if (!s) return null;
  if (s === 'DTD') return 'dtd';
  if (s === 'NA' || s === 'SUSP') return 'na';
  return 'il'; // IL, IL10, IL15, IL60, DL, etc.
}

const tierConfig: Record<StatusTier, { label: string; bg: string; text: string; border: string; order: number }> = {
  dtd:  { label: 'DTD',  bg: 'bg-accent-50',   text: 'text-accent-800',   border: 'border-accent',          order: 0 },
  il:   { label: 'IL',   bg: 'bg-error-50',    text: 'text-error-800',    border: 'border-error',           order: 1 },
  na:   { label: 'OUT',  bg: 'bg-primary-50',  text: 'text-primary-800',  border: 'border-muted-foreground', order: 2 },
};

export default function PlayerUpdatesCard() {
  const { teamKey } = useFantasy();
  const { roster, isLoading } = useRoster(teamKey);

  const playersWithStatus = roster
    .filter(p => getStatusTier(p) !== null)
    .sort((a, b) => (getStatusTier(a)?.charCodeAt(0) ?? 99) - (getStatusTier(b)?.charCodeAt(0) ?? 99))
    .sort((a, b) => (tierConfig[getStatusTier(a)!]?.order ?? 99) - (tierConfig[getStatusTier(b)!]?.order ?? 99));

  const healthy = roster.length - playersWithStatus.length;

  return (
    <DashboardCard
      title="Roster Health"
      icon={FiHeart}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-2">
        {roster.length > 0 && (
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">
              {healthy} of {roster.length} healthy
            </span>
            {playersWithStatus.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 bg-error-100 text-error-800 rounded font-medium">
                {playersWithStatus.length} flagged
              </span>
            )}
          </div>
        )}

        {playersWithStatus.length > 0 ? (
          <div className="space-y-1.5">
            {playersWithStatus.map(player => {
              const tier = getStatusTier(player)!;
              const cfg = tierConfig[tier];
              return (
                <div key={player.player_key} className={`border-l-2 ${cfg.border} pl-2.5 py-1`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{player.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-muted-foreground">{player.editorial_team_abbr}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${cfg.bg} ${cfg.text}`}>
                        {player.status}
                      </span>
                    </div>
                  </div>
                  {player.status_full && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{player.status_full}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-3">
            <p className="text-sm text-success font-medium">All players healthy</p>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
