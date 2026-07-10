'use client';

import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import { Text } from '@/components/typography';
import type { PointsStreamingDay } from '@/lib/points/streaming';
import type { MovesBudget } from '@/lib/fantasy/limits';
import type { LineupCadence } from '@/lib/fantasy/scoringMode';
import type { WeekMove, PlannedMove } from '@/lib/points/weekMoves';

/**
 * Points-league /streaming header: the moves budget priced in points.
 * Pips = the week's move slots (used / staged in the session plan / open);
 * the opportunity tile prices what the remaining slots are worth off the
 * top of the moves board; the day strip shows where the week needs
 * attention — open/idle slots, my SP starts, and marker dots for the days
 * the top (accent) and staged (success) moves go live.
 */

/** Yahoo-default weekly add cap, assumed when settings don't report one. */
export const DEFAULT_WEEKLY_MOVES_CAP = 6;

function StatTile({ label, value, sub, children }: { label: string; value?: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children ?? <span className="font-mono tabular-nums text-xl font-bold text-foreground">{value}</span>}
      {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

function MovePips({ cap, used, planned }: { cap: number; used: number; planned: number }) {
  const usedClamped = Math.min(used, cap);
  const plannedClamped = Math.min(planned, cap - usedClamped);
  const open = cap - usedClamped - plannedClamped;
  return (
    <div className="flex items-center gap-1 h-7">
      {Array.from({ length: usedClamped }).map((_, i) => (
        <span key={`u${i}`} className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
      ))}
      {Array.from({ length: plannedClamped }).map((_, i) => (
        <span key={`p${i}`} className="w-2.5 h-2.5 rounded-full bg-success" />
      ))}
      {Array.from({ length: open }).map((_, i) => (
        <span key={`o${i}`} className="w-2.5 h-2.5 rounded-full border border-border" />
      ))}
      <span className="font-mono tabular-nums text-xl font-bold text-foreground ml-1.5">{open}</span>
    </div>
  );
}

function DayTile({
  d,
  cadence,
  topCount,
  plannedCount,
}: {
  d: PointsStreamingDay;
  cadence: LineupCadence;
  topCount: number;
  plannedCount: number;
}) {
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
        {d.myStarts > 0 ? `${d.myStarts} SP` : ' '}
      </span>
      <span className="flex items-center gap-0.5 h-1.5">
        {Array.from({ length: Math.min(3, plannedCount) }).map((_, i) => (
          <span key={`p${i}`} className="w-1.5 h-1.5 rounded-full bg-success" />
        ))}
        {Array.from({ length: Math.min(3, topCount) }).map((_, i) => (
          <span key={`t${i}`} className="w-1.5 h-1.5 rounded-full bg-accent" />
        ))}
      </span>
    </div>
  );
}

export default function PointsWeekPlan({
  days,
  myStartsRemaining,
  moves,
  isLoading,
  weekStart,
  weekEnd,
  cadence,
  topMoves,
  plan,
}: {
  days: PointsStreamingDay[];
  myStartsRemaining: number;
  moves: MovesBudget | undefined;
  isLoading: boolean;
  weekStart?: string;
  weekEnd?: string;
  cadence: LineupCadence;
  topMoves: WeekMove[];
  plan: PlannedMove[];
}) {
  const cap = moves?.cap ?? DEFAULT_WEEKLY_MOVES_CAP;
  const used = moves?.used ?? 0;
  const left = Math.max(0, cap - used - plan.length);

  // The opportunity tile: what the plan is worth once staged, else what the
  // remaining slots could buy off the top of the board.
  const plannedTotal = plan.reduce((s, m) => s + m.netAtAdd, 0);
  const affordable = topMoves.slice(0, left);
  const onTheTable = affordable.reduce((s, m) => s + m.net, 0);

  const topDates = new Map<string, number>();
  for (const m of affordable) topDates.set(m.goLiveDate, (topDates.get(m.goLiveDate) ?? 0) + 1);
  const plannedDates = new Map<string, number>();
  for (const m of plan) {
    for (const c of m.dayChips) plannedDates.set(c.date, (plannedDates.get(c.date) ?? 0) + 1);
  }

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
              sub={moves?.used != null ? `${moves.used} of ${cap} used` : `cap ${cap}/wk`}
            >
              <MovePips cap={cap} used={used} planned={plan.length} />
            </StatTile>
            {plan.length > 0 ? (
              <StatTile label="planned" sub={`${plan.length} move${plan.length === 1 ? '' : 's'}`}>
                <span className="font-mono tabular-nums text-xl font-bold text-success h-7 flex items-center">
                  +{plannedTotal.toFixed(1)}
                </span>
              </StatTile>
            ) : (
              <StatTile
                label={`best ${affordable.length} move${affordable.length === 1 ? '' : 's'}`}
                sub={affordable.length > 0 ? 'pts on the table' : undefined}
              >
                <span className="font-mono tabular-nums text-xl font-bold text-foreground h-7 flex items-center">
                  {affordable.length > 0 ? `+${onTheTable.toFixed(1)}` : '—'}
                </span>
              </StatTile>
            )}
            <StatTile label="my SP starts" value={String(myStartsRemaining)} />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map(d => (
              <DayTile
                key={d.date}
                d={d}
                cadence={cadence}
                topCount={topDates.get(d.date) ?? 0}
                plannedCount={plannedDates.get(d.date) ?? 0}
              />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
