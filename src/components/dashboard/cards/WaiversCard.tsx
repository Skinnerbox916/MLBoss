'use client';

import { FiShoppingCart } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useTransactions } from '@/lib/hooks/useTransactions';
import { useAvailableBatters } from '@/lib/hooks/useAvailableBatters';

export default function WaiversCard() {
  const { context, leagueKey, teamKey } = useFantasy();
  const { transactions, isLoading: txLoading } = useTransactions(leagueKey);
  const { batters, isLoading: battersLoading } = useAvailableBatters(leagueKey);

  const isLoading = txLoading || battersLoading;

  const league = context?.leagues?.find(l => l.league_key === leagueKey);
  const waiverPriority = league?.user_team?.waiver_priority;

  const pendingClaims = transactions.filter(
    tx => tx.status === 'pending' && tx.players.some(p => p.destination_team_key === teamKey),
  );

  return (
    <DashboardCard
      title="Waivers"
      icon={FiShoppingCart}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        {/* Priority */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Waiver Priority</span>
          <span className="font-semibold text-lg">
            {waiverPriority ? `#${waiverPriority}` : '—'}
          </span>
        </div>

        {/* Pending claims */}
        {pendingClaims.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pending Claims</div>
            {pendingClaims.map(tx => (
              <div
                key={tx.transaction_key}
                className="flex justify-between items-center px-2 py-1.5 bg-accent-50 rounded text-sm"
              >
                <span className="font-medium">
                  {tx.players.find(p => p.type === 'add')?.name ?? 'Unknown'}
                </span>
                <span className="text-xs text-accent font-medium">Pending</span>
              </div>
            ))}
          </div>
        )}

        {/* Top available batters */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Top Available
          </div>
          {batters.length === 0 ? (
            <p className="text-xs text-muted-foreground">No available batters</p>
          ) : (
            batters.slice(0, 6).map(player => (
              <div key={player.player_key} className="flex items-center justify-between py-0.5">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium truncate block">{player.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-xs text-muted-foreground">{player.editorial_team_abbr}</span>
                  <span className="text-[11px] px-1.5 py-0.5 bg-surface-muted rounded font-medium text-muted-foreground">
                    {player.display_position}
                  </span>
                  {player.ownership_type === 'waivers' && (
                    <span className="text-[11px] px-1.5 py-0.5 bg-primary-50 rounded font-medium text-primary">
                      W
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardCard>
  );
}
