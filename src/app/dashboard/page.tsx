import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import GridLayout from '@/components/dashboard/GridLayout';
import { FantasyProvider } from '@/components/dashboard/FantasyProvider';
import {
  MatchupCard,
  BattingCard,
  PitchingCard,
  LineupIssuesCard,
  WaiversCard,
  PlayerUpdatesCard,
  NextWeekCard,
  RecentActivityCard
} from '@/components/dashboard/cards';
import { DashboardCardMeta } from '@/components/dashboard/types';

// Dashboard card configuration
const dashboardCards: DashboardCardMeta[] = [
  { id: 'matchup', component: MatchupCard, size: 'lg' },
  { id: 'batting', component: BattingCard, size: 'md' },
  { id: 'pitching', component: PitchingCard, size: 'md' },
  { id: 'lineup-issues', component: LineupIssuesCard, size: 'md' },
  { id: 'waivers', component: WaiversCard, size: 'md' },
  { id: 'player-updates', component: PlayerUpdatesCard, size: 'lg' },
  { id: 'next-week', component: NextWeekCard, size: 'md' },
  { id: 'recent-activity', component: RecentActivityCard, size: 'md' },
];

export default async function DashboardPage(): Promise<React.JSX.Element> {
  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6">
          <FantasyProvider>
            <GridLayout>
              {dashboardCards.map(({ id, component: CardComponent }) => (
                <CardComponent key={id} />
              ))}
            </GridLayout>
          </FantasyProvider>
        </div>
      </main>
    </AppLayout>
  );
} 