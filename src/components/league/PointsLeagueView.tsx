'use client';

import Panel from '@/components/ui/Panel';
import { Heading } from '@/components/typography';
import { useStandings } from '@/lib/hooks/useStandings';
import StandingsTable from '@/components/shared/StandingsTable';

/**
 * Points-league /league experience. Standings are scoring-agnostic (the
 * shared StandingsTable adds PF/PA when the league reports points), so
 * this view is live now; a points-native rankings section (weekly points
 * for/against trends) is the follow-up that grows below it.
 */
export default function PointsLeagueView({
  leagueKey,
  teamKey,
}: {
  leagueKey: string | undefined;
  teamKey: string | undefined;
}) {
  const { standings, isLoading, isError } = useStandings(leagueKey);

  return (
    <div className="p-6 space-y-4">
      <div>
        <Heading as="h1">League Overview</Heading>
        <p className="text-xs text-muted-foreground mt-0.5">
          Standings across your league · points league
        </p>
      </div>

      {isError && (
        <Panel className="p-8 text-center">
          <p className="text-sm text-error">Failed to load standings</p>
        </Panel>
      )}

      {isLoading && !isError ? (
        <Panel className="p-8 text-center">
          <div className="animate-pulse text-sm text-muted-foreground">Loading league data...</div>
        </Panel>
      ) : (
        !isError && <StandingsTable standings={standings} userTeamKey={teamKey} />
      )}
    </div>
  );
}
