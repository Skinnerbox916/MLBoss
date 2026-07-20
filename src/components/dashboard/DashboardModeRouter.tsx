'use client';

import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import Skeleton from '@/components/ui/Skeleton';
import GridLayout from '@/components/dashboard/GridLayout';
import { FantasyProvider } from '@/components/dashboard/FantasyProvider';
import BossCard from '@/components/dashboard/BossCard';
import TopStreamTile from '@/components/dashboard/TopStreamTile';
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
 * Picks the dashboard experience by the ACTIVE league's scoring mode; both
 * modes render the shared three-row grammar (marquee / top action /
 * reference grid — registry: docs/dashboard-components.md#the-dashboard-grammar).
 * Opponent-shaped cards (Boss Card, matchup projections, opponent scouting)
 * additionally gate on `headToHead` — roto and season-points leagues have
 * no weekly opponent.
 */
export default function DashboardModeRouter() {
  const { mode, headToHead, isLoading, leagueKey } = useActiveLeague();

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
        {headToHead && <BossCard />}
        <TopStreamTile className="mb-6" />
        <GridLayout>
          <LineupIssuesCard />
          <PlayerUpdatesCard />
          {headToHead && <OpponentStatusCard />}
          {headToHead && <SeasonComparisonCard />}
          {headToHead && <NextWeekCard />}
          <WaiversCard />
          <RecentActivityCard />
        </GridLayout>
      </FantasyProvider>
    </div>
  );
}
