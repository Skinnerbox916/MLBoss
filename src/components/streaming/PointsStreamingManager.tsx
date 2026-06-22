'use client';

import { useState } from 'react';
import { Heading } from '@/components/typography';
import Tabs from '@/components/ui/Tabs';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { usePointsStreaming } from '@/lib/hooks/usePointsStreaming';
import { useMovesBudget } from '@/lib/hooks/useMovesBudget';
import PointsWeekPlan from './PointsWeekPlan';
import PointsPitcherStreamBoard from './PointsPitcherStreamBoard';
import PointsBatterPlugBoard from './PointsBatterPlugBoard';

type StreamTab = 'pitchers' | 'batters';

/**
 * Points-league /streaming view. In points there are no categories to manage —
 * the streaming game is volume: pitcher starts are the marquee pickup (a start
 * usually outscores a bench bat's week), and bats matter on the specific days
 * the lineup has open slots. Week-plan header (moves budget + day coverage)
 * replaces the categories GamePlanPanel; the boards reuse the shared
 * PlayerRowShell so rows match the points lineup page.
 */
export default function PointsStreamingManager() {
  const { leagueKey, teamKey, scoringType, lineupCadence, isError } = useActiveLeague();
  const { data, isLoading } = usePointsStreaming(leagueKey, teamKey, scoringType);
  const { data: moves } = useMovesBudget(leagueKey, teamKey);
  const [tab, setTab] = useState<StreamTab>('pitchers');

  if (isError) {
    return (
      <div className="p-6">
        <div className="bg-surface rounded-lg shadow p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </div>
      </div>
    );
  }

  const loading = isLoading && !data;
  // Server-derived cadence is authoritative once loaded; the client-side
  // league setting covers the loading state so labels don't flash.
  const cadence = data?.cadence ?? lineupCadence;

  return (
    <div className="p-6 space-y-4">
      <div>
        <Heading as="h1">Streaming</Heading>
        <p className="text-xs text-muted-foreground mt-0.5">
          {cadence === 'weekly'
            ? 'Lineups lock for the week — build next week’s roster: two-start arms and dense schedules win.'
            : 'Stream pitcher starts and plug open lineup days — in points, the game is volume.'}
        </p>
      </div>

      <PointsWeekPlan
        days={data?.days ?? []}
        openSlotDays={data?.openSlotDays ?? 0}
        myStartsRemaining={data?.myStartsRemaining ?? 0}
        moves={moves}
        isLoading={loading}
        weekStart={data?.week.start}
        weekEnd={data?.week.end}
        cadence={cadence}
      />

      <Tabs<StreamTab>
        variant="segment"
        ariaLabel="Streaming tab"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'pitchers', label: 'Pitchers' },
          { id: 'batters', label: 'Batters' },
        ]}
      />

      {tab === 'pitchers' ? (
        <PointsPitcherStreamBoard
          rows={data?.pitcherStreams ?? []}
          isLoading={loading}
          windowLabel={cadence === 'weekly' ? 'next week' : `next ${data?.week.days ?? 0} days`}
        />
      ) : (
        <PointsBatterPlugBoard
          rows={data?.batterPlugs ?? []}
          isLoading={loading}
          openSlotDays={data?.openSlotDays ?? 0}
          cadence={cadence}
        />
      )}
    </div>
  );
}
