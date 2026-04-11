'use client';

import { FiShoppingCart } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useTransactions } from '@/lib/hooks/useTransactions';

export default function WaiversCard() {
  const { context, leagueKey, teamKey } = useFantasy();
  const { transactions, isLoading } = useTransactions(leagueKey);

  // Find waiver priority from context
  const league = context?.leagues?.find(l => l.league_key === leagueKey);
  const waiverPriority = league?.user_team?.waiver_priority;

  // Filter to pending waiver claims for the user's team
  const pendingClaims = transactions.filter(
    tx => tx.status === 'pending' && tx.players.some(p => p.destination_team_key === teamKey),
  );

  // Recent successful adds (waiver pickups)
  const recentAdds = transactions
    .filter(tx => tx.type.includes('add') && tx.status === 'successful')
    .slice(0, 3);

  return (
    <DashboardCard
      title="Waivers"
      icon={FiShoppingCart}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Waiver Priority</span>
          <span className="font-semibold text-lg">
            {waiverPriority ? `#${waiverPriority}` : '—'}
          </span>
        </div>

        {pendingClaims.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">Pending Claims</div>
            <div className="space-y-1">
              {pendingClaims.map(tx => (
                <div
                  key={tx.transaction_key}
                  className="flex justify-between items-center p-2 bg-primary-50 rounded"
                >
                  <span className="text-sm font-medium">
                    {tx.players.find(p => p.type === 'add')?.name ?? 'Unknown'}
                  </span>
                  <span className="text-xs text-primary">Pending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentAdds.length > 0 && (
          <div className="pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground mb-1">Recent Pickups</div>
            <div className="space-y-1">
              {recentAdds.map(tx => (
                <div key={tx.transaction_key} className="text-sm">
                  <span className="font-medium">
                    {tx.players.find(p => p.type === 'add')?.name ?? 'Unknown'}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    {tx.players.find(p => p.type === 'add')?.display_position ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {pendingClaims.length === 0 && recentAdds.length === 0 && (
          <p className="text-sm text-muted-foreground">No waiver activity</p>
        )}
      </div>
    </DashboardCard>
  );
}
