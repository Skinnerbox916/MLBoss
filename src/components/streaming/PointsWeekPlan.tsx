'use client';

import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import { Text } from '@/components/typography';
import type { PointsStreamingDay } from '@/lib/points/streaming';
import type { MovesBudget } from '@/lib/fantasy/limits';
import type { LineupCadence } from '@/lib/fantasy/scoringMode';

/**
 * Points-league replacement for the GamePlanPanel header on /streaming: there
 * are no categories to chase or punt, so the action surface is the week's
 * volume picture — moves left, slot-days your lineup forfeits, and the
 * day-by-day coverage strip that says WHERE the holes are.
 *
 * Weekly cadence inverts the framing: "open" slots you can still plug become
 * "idle" slot-days the locked lineup is about to bake in.
 */

/** Yahoo-default weekly add cap, assumed when settings don't report one. */
const DEFAULT_WEEKLY_MOVES_CAP = 6;

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-xl font-bold text-foreground">{value}</span>
      {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

function DayTile({ d, cadence }: { d: PointsStreamingDay; cadence: LineupCadence }) {
  const dayOfMonth = Number(d.date.slice(8, 10));
  return (
    <div className="flex min-w-[64px] flex-col items-center gap-0.5 rounded-lg border border-border-muted px-2 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {d.dayName} {dayOfMonth}
      </span>
      {d.open > 0 ? (
        <span className="font-mono tabular-nums text-sm font-bold text-error">
          {d.open} {cadence === 'weekly' ? 'idle' : 'open'}
        </span>
      ) : (
        <span className="font-mono text-sm font-bold text-success">full</span>
      )}
      <span className="font-mono text-[10px] text-muted-foreground">
        {d.myStarts > 0 ? `${d.myStarts} SP` : ' '}
      </span>
    </div>
  );
}

export default function PointsWeekPlan({
  days,
  openSlotDays,
  myStartsRemaining,
  moves,
  isLoading,
  weekStart,
  weekEnd,
  cadence,
}: {
  days: PointsStreamingDay[];
  openSlotDays: number;
  myStartsRemaining: number;
  moves: MovesBudget | undefined;
  isLoading: boolean;
  weekStart?: string;
  weekEnd?: string;
  cadence: LineupCadence;
}) {
  const cap = moves?.cap ?? DEFAULT_WEEKLY_MOVES_CAP;
  const used = moves?.used;
  const left = used != null ? Math.max(0, cap - used) : null;

  return (
    <Panel
      title="Week plan"
      action={
        weekStart && weekEnd ? (
          <Text as="span" variant="caption" className="text-muted-foreground font-mono">
            {weekStart.slice(5).replace('-', '/')} – {weekEnd.slice(5).replace('-', '/')}
          </Text>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-4">
            <StatTile
              label="moves left"
              value={left != null ? String(left) : String(cap)}
              sub={used != null ? `${used} of ${cap} used` : `cap ${cap}/wk`}
            />
            <StatTile
              label={cadence === 'weekly' ? 'idle slot-days' : 'open slot-days'}
              value={String(openSlotDays)}
              sub={cadence === 'weekly' ? 'starters locked in with no game' : "batter slots you can't fill"}
            />
            <StatTile
              label="my SP starts"
              value={String(myStartsRemaining)}
              sub={cadence === 'weekly' ? 'next week' : 'rest of window'}
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map(d => <DayTile key={d.date} d={d} cadence={cadence} />)}
          </div>
          <Text variant="small" className="text-muted-foreground">
            {cadence === 'weekly'
              ? 'Lineups lock for the week, so idle days get baked in when you commit — favor bats with dense schedules and arms with two-start weeks. Adds take effect next Monday.'
              : 'Every open slot-day is foregone points, and a streamed start usually outscores a bench bat’s whole week — spend moves on starts first, then plug the open days.'}
          </Text>
        </div>
      )}
    </Panel>
  );
}
