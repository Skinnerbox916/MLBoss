'use client';

import { useCallback, useState } from 'react';
import { Heading } from '@/components/typography';
import Tabs from '@/components/ui/Tabs';
import { usePointsWeekMoves } from '@/lib/hooks/usePointsWeekMoves';
import {
  plannedMoveFromWeekMove,
  type PlannedMove,
  type WeekMove,
} from '@/lib/points/weekMoves';
import PointsWeekPlan, { DEFAULT_WEEKLY_MOVES_CAP } from './PointsWeekPlan';
import PointsMovesBoard from './PointsMovesBoard';
import PointsPitcherStreamBoard from './PointsPitcherStreamBoard';
import PointsBatterPlugBoard from './PointsBatterPlugBoard';

type StreamTab = 'pitchers' | 'batters';

/**
 * Points-league /streaming view, built around the week-moves board: one
 * ranked list of net-positive add/drop moves for the rest of the window,
 * with a session-only plan. Staging a move re-prices the whole board in a
 * memo (usePointsWeekMoves) — the plan is React state and dies on reload by
 * design; reality (the actual roster) is the durable state. The original
 * stream/plug boards stay below as the browse pool.
 */
export default function PointsStreamingManager() {
  const [plan, setPlan] = useState<PlannedMove[]>([]);
  const { board, cadence, days, movesBudget, streaming, isLoading, isError } =
    usePointsWeekMoves(plan);
  const [tab, setTab] = useState<StreamTab>('pitchers');

  const stage = useCallback((m: WeekMove) => {
    setPlan(prev =>
      prev.some(pm => pm.addKey === m.add.playerKey)
        ? prev
        : [...prev, plannedMoveFromWeekMove(m)],
    );
  }, []);
  const unstage = useCallback((id: string) => {
    setPlan(prev => prev.filter(pm => pm.id !== id));
  }, []);

  if (isError) {
    return (
      <div className="p-6">
        <div className="bg-surface rounded-lg shadow p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </div>
      </div>
    );
  }

  const loading = isLoading && !streaming;
  const cap = movesBudget?.cap ?? DEFAULT_WEEKLY_MOVES_CAP;
  const used = movesBudget?.used ?? 0;
  const affordableCount = Math.max(0, cap - used - plan.length);
  const windowLabel = cadence === 'weekly' ? 'next week' : `next ${streaming?.week.days ?? 0} days`;

  return (
    <div className="p-6 space-y-4">
      <Heading as="h1">Streaming</Heading>

      <PointsWeekPlan
        days={days}
        myStartsRemaining={streaming?.myStartsRemaining ?? 0}
        moves={movesBudget}
        isLoading={loading}
        weekStart={streaming?.week.start}
        weekEnd={streaming?.week.end}
        cadence={cadence}
        topMoves={board.moves}
        plan={plan}
      />

      <PointsMovesBoard
        moves={board.moves}
        plan={plan}
        affordableCount={affordableCount}
        isLoading={loading}
        windowLabel={windowLabel}
        onStage={stage}
        onUnstage={unstage}
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
          rows={streaming?.pitcherStreams ?? []}
          isLoading={loading}
          windowLabel={windowLabel}
        />
      ) : (
        <PointsBatterPlugBoard
          rows={streaming?.batterPlugs ?? []}
          isLoading={loading}
          openSlotDays={streaming?.openSlotDays ?? 0}
          cadence={cadence}
        />
      )}
    </div>
  );
}
