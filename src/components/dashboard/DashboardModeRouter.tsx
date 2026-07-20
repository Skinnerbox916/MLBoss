'use client';

import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import Skeleton from '@/components/ui/Skeleton';
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
import PointsDashboard from './PointsDashboard';

/**
 * Picks the dashboard experience by the ACTIVE league's scoring mode. Points →
 * the points week-outlook / moves / value landing; categories → the Boss Card
 * marquee + full card grid. `FantasyProvider` resolves the ACTIVE league, and
 * the scoring-agnostic cards (mode-axis registry in
 * docs/dashboard-components.md) render on both dashboards; the Boss Card and
 * projection cards are category-shaped and stay categories-only.
 */
export default function DashboardModeRouter() {
  const { mode, isLoading, leagueKey } = useActiveLeague();

  if (isLoading && !leagueKey) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (mode === 'points') return <PointsDashboard />;

  return (
    <div className="p-6">
      <FantasyProvider>
        <BossCard />
        <GridLayout>
          <LineupIssuesCard />
          <PlayerUpdatesCard />
          <OpponentStatusCard />
          <SeasonComparisonCard />
          <NextWeekCard />
          <WaiversCard />
          <RecentActivityCard />
        </GridLayout>
      </FantasyProvider>
    </div>
  );
}
