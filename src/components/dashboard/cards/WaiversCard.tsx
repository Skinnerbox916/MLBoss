'use client';

import Link from 'next/link';
import { FiShoppingCart } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useTransactions } from '@/lib/hooks/useTransactions';

/**
 * Waiver process facts: priority position and claims in flight. Deliberately
 * NOT a "top available" list — an unranked pool sample is value-free, and the
 * pool is priced properly (native units, net of the incumbent) on /streaming
 * and /roster. See docs/history.md.
 */
export default function WaiversCard() {
  const { context, leagueKey, teamKey } = useFantasy();
  const { transactions, isLoading } = useTransactions(leagueKey);

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
                className="flex justify-between items-center px-2 py-1.5 bg-accent/10 rounded text-sm"
              >
                <span className="font-medium">
                  {tx.players.find(p => p.type === 'add')?.name ?? 'Unknown'}
                </span>
                <span className="text-xs text-accent font-medium">Pending</span>
              </div>
            ))}
          </div>
        )}

        <Link
          href="/streaming"
          className="block text-xs text-accent hover:underline pt-1"
        >
          Priced pickups →
        </Link>
      </div>
    </DashboardCard>
  );
}
