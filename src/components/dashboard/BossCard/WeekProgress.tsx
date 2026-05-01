'use client';

import { formatStatValue } from '@/lib/formatStat';
import type { DayProbables } from '@/lib/hooks/useWeekProbables';
import type { LeagueLimits } from '@/lib/fantasy/limits';

interface WeekProgressProps {
  myStarts: DayProbables[];
  oppStarts: DayProbables[];
  myRemaining: number;
  oppRemaining: number;
  isLoading: boolean;
  /** League-wide pitching caps. Null fields hide the corresponding pill. */
  limits?: LeagueLimits;
  /** IP and GS used so far this week, sourced from each team's matchup stats. */
  myUsedIp?: string;
  myUsedGs?: string;
  oppUsedIp?: string;
  oppUsedGs?: string;
}

const SPIKE_THRESHOLD = 3; // 3+ probables on one day = "Sunday spike"

interface DayStripProps {
  starts: DayProbables[];
  side: 'me' | 'opp';
}

function DayStrip({ starts, side }: DayStripProps) {
  return (
    <div className="flex items-end justify-center gap-1.5">
      {starts.map(({ day, starts: dayStarts }) => {
        const isPast = !day.isRemaining;
        const count = dayStarts.length;
        const isSpike = count >= SPIKE_THRESHOLD;

        const pitcherList = dayStarts.length > 0
          ? dayStarts.map(s => s.player.name).join(', ')
          : 'No probable starts';

        const dotTone = isPast
          ? 'bg-border-muted text-muted-foreground/60'
          : count === 0
            ? 'bg-surface-muted text-muted-foreground/60 border border-border'
            : isSpike
              ? side === 'me'
                ? 'bg-accent text-background'
                : 'bg-error text-background'
              : side === 'me'
                ? 'bg-accent/70 text-background'
                : 'bg-primary/60 text-background';

        return (
          <div
            key={day.date}
            className="flex flex-col items-center gap-0.5"
            title={`${day.dayName} ${day.date}: ${pitcherList}`}
          >
            <span
              className={`flex items-center justify-center rounded-full font-mono font-numeric text-[10px] font-bold leading-none transition-transform ${
                isSpike ? 'w-6 h-6 ring-2 ring-accent/40' : 'w-5 h-5'
              } ${dotTone}`}
            >
              {count > 0 ? count : ''}
            </span>
            <span
              className={`text-[10px] font-mono uppercase leading-none ${
                day.isToday ? 'text-accent font-bold' : isPast ? 'text-muted-foreground/60' : 'text-muted-foreground'
              }`}
            >
              {day.dayLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CapPill({
  label,
  used,
  cap,
  formatName,
}: {
  label: string;
  used: string | undefined;
  cap: number;
  formatName: 'IP' | 'GS';
}) {
  const usedNum = used !== undefined ? parseFloat(used) : NaN;
  // Pressure: how much of the cap has been used. Threshold mirrors how a
  // manager actually thinks — "tight" when more than 80% is gone.
  const pct = Number.isFinite(usedNum) ? Math.min(1, usedNum / cap) : 0;
  const isTight = pct >= 0.8;
  const isMaxed = pct >= 1;

  const tone =
    isMaxed ? 'bg-error/15 text-error border-error/30' :
    isTight ? 'bg-accent/15 text-accent-700 border-accent/30' :
    'bg-surface-muted text-muted-foreground border-border';

  const usedStr = Number.isFinite(usedNum) ? formatStatValue(used!, formatName) : '–';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono font-numeric ${tone}`}
      title={`${label}: ${usedStr} of ${cap} used${isTight ? ' — tight' : ''}`}
    >
      <span className="font-semibold uppercase tracking-wider">{label}</span>
      <span>{usedStr}/{cap}</span>
    </span>
  );
}

interface SidePanelProps {
  label: string;
  remaining: number;
  starts: DayProbables[];
  side: 'me' | 'opp';
  align: 'left' | 'right';
  limits?: LeagueLimits;
  usedIp?: string;
  usedGs?: string;
}

function SidePanel({ label, remaining, starts, side, align, limits, usedIp, usedGs }: SidePanelProps) {
  const accentText = side === 'me' ? 'text-accent' : 'text-primary';
  const showIp = limits?.maxInningsPitched != null;
  const showGs = limits?.maxGamesStarted != null;
  return (
    <div className={`flex flex-col items-center gap-1 ${align === 'left' ? 'sm:items-start' : 'sm:items-end'}`}>
      <span className="text-caption text-muted-foreground uppercase tracking-[0.15em] font-semibold">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono font-numeric text-2xl sm:text-3xl font-bold leading-none ${accentText}`}>
          {remaining}
        </span>
        <span className="text-xs text-muted-foreground">SP left</span>
      </div>
      <DayStrip starts={starts} side={side} />
      {(showIp || showGs) && (
        <div className={`flex flex-wrap gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
          {showIp && (
            <CapPill label="IP" used={usedIp} cap={limits!.maxInningsPitched!} formatName="IP" />
          )}
          {showGs && (
            <CapPill label="GS" used={usedGs} cap={limits!.maxGamesStarted!} formatName="GS" />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Weekly probable-pitcher runway block.
 *
 * Lives under the leverage bar / category rail in the Boss Card. Shows the
 * count of probable starts each side has *remaining* (today + future days),
 * along with a Mon..Sun day strip so you can spot weekend spikes — the
 * scenarios where one side has 3+ probables on a single day and ratios are
 * about to swing hard. Played days dim out so the strip reads as
 * "what's left."
 */
export default function WeekProgress({
  myStarts,
  oppStarts,
  myRemaining,
  oppRemaining,
  isLoading,
  limits,
  myUsedIp,
  myUsedGs,
  oppUsedIp,
  oppUsedGs,
}: WeekProgressProps) {
  if (isLoading) {
    return (
      <div
        aria-label="Loading weekly probable pitchers"
        className="flex items-center justify-between gap-4 animate-pulse"
      >
        <div className="flex flex-col gap-2 items-start">
          <div className="h-3 w-24 bg-border-muted rounded" />
          <div className="h-7 w-12 bg-border-muted rounded" />
          <div className="h-4 w-32 bg-border-muted rounded" />
        </div>
        <div className="flex flex-col gap-2 items-end">
          <div className="h-3 w-24 bg-border-muted rounded" />
          <div className="h-7 w-12 bg-border-muted rounded" />
          <div className="h-4 w-32 bg-border-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-8 items-end">
      <SidePanel
        label="Your starts"
        remaining={myRemaining}
        starts={myStarts}
        side="me"
        align="left"
        limits={limits}
        usedIp={myUsedIp}
        usedGs={myUsedGs}
      />
      <SidePanel
        label="Opp starts"
        remaining={oppRemaining}
        starts={oppStarts}
        side="opp"
        align="right"
        limits={limits}
        usedIp={oppUsedIp}
        usedGs={oppUsedGs}
      />
    </div>
  );
}
