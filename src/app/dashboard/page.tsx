import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import GridLayout from '@/components/dashboard/GridLayout';
import { FantasyProvider } from '@/components/dashboard/FantasyProvider';
import BossCard from '@/components/dashboard/BossCard';
import {
  SeasonComparisonCard,
  OpponentStatusCard,
  LineupIssuesCard,
  WaiversCard,
  PlayerUpdatesCard,
  NextWeekCard,
  RecentActivityCard,
} from '@/components/dashboard/cards';
import { DashboardCardMeta } from '@/components/dashboard/types';

// Reorg: the dashboard is the only reference/overview surface. The
// `BossCard` marquee at the top now owns the live head-to-head headline
// (subsuming the old `CurrentScoreCard`). The grid below covers everything
// the marquee doesn't — attention items, scouting, look-ahead, activity.
//
// Order is "what needs your attention" -> "scouting & comparison"
// -> "look-ahead / activity". Sizes are declared inside each card
// component; the grid uses auto-flow:dense to backfill empty cells.
const dashboardCards: DashboardCardMeta[] = [
  { id: 'lineup-issues', component: LineupIssuesCard },
  { id: 'player-updates', component: PlayerUpdatesCard },
  { id: 'opponent-status', component: OpponentStatusCard },
  { id: 'season-comparison', component: SeasonComparisonCard },
  { id: 'next-week', component: NextWeekCard },
  { id: 'waivers', component: WaiversCard },
  { id: 'recent-activity', component: RecentActivityCard },
];

export default async function DashboardPage(): Promise<React.JSX.Element> {
  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6">
          <FantasyProvider>
            <BossCard />
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
