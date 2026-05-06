'use client';

import { FiActivity } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { Text } from '@/components/typography';
import { useFantasy } from '../FantasyProvider';
import { useTransactions } from '@/lib/hooks/useTransactions';
import { useStandings } from '@/lib/hooks/useStandings';
import type { TransactionEntry, StandingsEntry } from '@/lib/yahoo-fantasy-api';

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function txDotColor(type: string): string {
  if (type.includes('add') && type.includes('drop')) return 'bg-accent';
  if (type.includes('add')) return 'bg-success';
  if (type.includes('drop')) return 'bg-error';
  if (type.includes('trade')) return 'bg-primary';
  return 'bg-muted-foreground';
}

function resolveTeamName(
  tx: TransactionEntry,
  standings: StandingsEntry[],
  myTeamKey: string | undefined,
): string | null {
  // Prefer the team key from the add player's destination (most reliable for add/drop)
  const addedPlayer = tx.players.find(p => p.type === 'add');
  const teamKey = addedPlayer?.destination_team_key ?? tx.trader_team_key;
  if (!teamKey) return null;

  if (teamKey === myTeamKey) return 'You';

  const entry = standings.find(s => s.team_key === teamKey);
  return entry?.name ?? null;
}

function TxRow({ tx, myTeamKey, standings }: {
  tx: TransactionEntry;
  myTeamKey: string | undefined;
  standings: StandingsEntry[];
}) {
  const isMyTx = tx.players.some(
    p => p.destination_team_key === myTeamKey || p.source_team_key === myTeamKey,
  );
  const teamName = resolveTeamName(tx, standings, myTeamKey);

  const added = tx.players.filter(p => p.type === 'add');
  const dropped = tx.players.filter(p => p.type === 'drop');

  return (
    <div className={`flex gap-2 ${isMyTx ? 'opacity-100' : 'opacity-60'}`}>
      <div className="flex flex-col items-center pt-1.5 shrink-0">
        <div className={`w-2 h-2 rounded-full shrink-0 ${txDotColor(tx.type)}`} />
      </div>
      <div className="pb-2.5 min-w-0 flex-1">
        {/* Team + timestamp */}
        <div className="flex items-baseline gap-1.5 mb-0.5">
          {teamName && (
            <span className={`text-xs font-semibold ${isMyTx ? 'text-accent' : 'text-foreground'}`}>
              {teamName}
            </span>
          )}
          {tx.timestamp && (
            <span className="text-caption text-muted-foreground">{timeAgo(tx.timestamp)}</span>
          )}
        </div>
        {/* Players */}
        <div className="space-y-0.5">
          {added.map(p => (
            <div key={p.player_key} className="flex items-baseline gap-1 text-xs">
              <span className="text-success font-bold shrink-0">+</span>
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground text-caption">{p.display_position}</span>
            </div>
          ))}
          {dropped.map(p => (
            <div key={p.player_key} className="flex items-baseline gap-1 text-xs">
              <span className="text-error font-bold shrink-0">−</span>
              <span className="text-muted-foreground">{p.name}</span>
              <span className="text-muted-foreground text-caption">{p.display_position}</span>
            </div>
          ))}
          {tx.type === 'trade' && (
            <div className="text-xs text-muted-foreground">Trade</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RecentActivityCard() {
  const { leagueKey, teamKey } = useFantasy();
  const { transactions, isLoading: txLoading } = useTransactions(leagueKey);
  const { standings, isLoading: standingsLoading } = useStandings(leagueKey);

  const isLoading = txLoading || standingsLoading;
  const recent = transactions.slice(0, 6);

  return (
    <DashboardCard
      title="Recent Activity"
      icon={FiActivity}
      size="md"
      isLoading={isLoading}
    >
      {recent.length > 0 ? (
        <div>
          {recent.map(tx => (
            <TxRow key={tx.transaction_key} tx={tx} myTeamKey={teamKey} standings={standings} />
          ))}
        </div>
      ) : (
        <Text variant="small">No recent activity</Text>
      )}
    </DashboardCard>
  );
}
