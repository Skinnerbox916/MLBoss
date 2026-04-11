'use client';

import { FiActivity } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useTransactions } from '@/lib/hooks/useTransactions';

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function txColor(type: string): string {
  if (type.includes('add')) return 'bg-success';
  if (type.includes('drop')) return 'bg-error';
  if (type.includes('trade')) return 'bg-primary';
  return 'bg-muted-foreground';
}

function txLabel(type: string): string {
  if (type === 'add/drop') return 'Add/Drop';
  if (type === 'add') return 'Added';
  if (type === 'drop') return 'Dropped';
  if (type === 'trade') return 'Traded';
  return type;
}

export default function RecentActivityCard() {
  const { leagueKey } = useFantasy();
  const { transactions, isLoading } = useTransactions(leagueKey);

  // Show the 5 most recent transactions
  const recent = transactions.slice(0, 5);

  return (
    <DashboardCard
      title="Recent Activity"
      icon={FiActivity}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        {recent.length > 0 ? (
          recent.map(tx => (
            <div key={tx.transaction_key} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className={`w-2 h-2 ${txColor(tx.type)} rounded-full`}></span>
                <span className="text-muted-foreground">
                  {tx.timestamp ? timeAgo(tx.timestamp) : ''}
                </span>
              </div>
              <div className="text-sm">
                <span className="font-medium">{txLabel(tx.type)}</span>{' '}
                {tx.players.map(p => p.name).join(', ')}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No recent activity</p>
        )}
      </div>
    </DashboardCard>
  );
}
