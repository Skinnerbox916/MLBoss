'use client';

import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import { Heading, Text } from '@/components/typography';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { usePointsTeam } from '@/lib/hooks/usePointsTeam';
import TopWeekMoveTile from '@/components/points/TopWeekMoveTile';
import PointsMarquee from '@/components/dashboard/PointsMarquee';
import GridLayout from '@/components/dashboard/GridLayout';
import { FantasyProvider } from '@/components/dashboard/FantasyProvider';
import {
  LineupIssuesCard,
  PlayerUpdatesCard,
  OpponentStatusCard,
  WaiversCard,
  RecentActivityCard,
} from '@/components/dashboard/cards';

/**
 * Points-league dashboard, in the shared three-row grammar (registry:
 * docs/dashboard-components.md#the-dashboard-grammar):
 *
 *   1. Matchup marquee — live score + projected finals + points brief
 *      (season variant when the league has no weekly opponent).
 *   2. Top action — the week-moves board's #1 move.
 *   3. Reference grid — the scoring-agnostic cards.
 *
 * Roster-construction content (suggested moves, VOR holds/drops) lives on
 * /roster, not here — the dashboard names ONE priced action and routes.
 */
export default function PointsDashboard() {
  const { leagueKey, teamKey, scoringType, leagueName, headToHead } = useActiveLeague();
  const { data, isLoading, isError } = usePointsTeam(leagueKey, teamKey, scoringType);

  return (
    <div className="p-6 space-y-6">
      <header>
        <Heading as="h1" className="text-primary">Dashboard</Heading>
        <Text variant="muted">{leagueName ?? 'Points league'} · week outlook</Text>
      </header>

      {isError && (
        <Panel><Text variant="small" className="text-error">Couldn&apos;t load points analysis. Try refreshing.</Text></Panel>
      )}

      {isLoading && !data && <Skeleton className="h-28 w-full" />}

      <PointsMarquee data={data} />

      <TopWeekMoveTile />

      <FantasyProvider>
        <GridLayout>
          <LineupIssuesCard />
          <PlayerUpdatesCard />
          {headToHead && <OpponentStatusCard />}
          <WaiversCard />
          <RecentActivityCard />
        </GridLayout>
      </FantasyProvider>
    </div>
  );
}
