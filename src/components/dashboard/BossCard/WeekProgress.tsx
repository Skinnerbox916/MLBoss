'use client';

import type { DayProbables } from '@/lib/hooks/useWeekProbables';
import type { PitcherTeamProjectionResponse } from '@/lib/hooks/usePitcherTeamProjection';
import type { LeagueLimits } from '@/lib/fantasy/limits';
import CapPill from '@/components/shared/CapPill';

interface WeekProgressProps {
  myStarts: DayProbables[];
  oppStarts: DayProbables[];
  /** Forward IP projection (SP + RP) for each side. The headline IP-left
   *  number reads from `weeklyIp`; the SP/RP breakdown subline reads
   *  from `weeklySpIp` / `weeklyRpIp`. Undefined while loading. */
  myProjection?: PitcherTeamProjectionResponse;
  oppProjection?: PitcherTeamProjectionResponse;
  isLoading: boolean;
  /** League-wide pitching caps. Null fields hide the corresponding pill. */
  limits?: LeagueLimits;
  /** IP and GS used so far this week, sourced from each team's matchup stats. */
  myUsedIp?: string;
  myUsedGs?: string;
  oppUsedIp?: string;
  oppUsedGs?: string;
}

// ---------------------------------------------------------------------------
// Day strip — one column per matchup-week day. Per pitcher start, render:
//   ✓   = already pitched (past day OR today's concluded game)
//   ◦   = upcoming SP (today-not-yet-started OR future scheduled)
//   ·   = no scheduled start for that team that day
//
// The previous design used a numeric count circle with a "spike" emphasis
// at 3+ probables — but daily counts don't drive matchup outcomes (the
// weekly cumulative does), so the count framing was actively misleading.
// This version is purely status-informational.
// ---------------------------------------------------------------------------

interface DayStripProps {
  starts: DayProbables[];
  side: 'me' | 'opp';
}

function DayStrip({ starts, side }: DayStripProps) {
  const accentText = side === 'me' ? 'text-accent' : 'text-primary';

  return (
    <div className="flex items-end justify-center gap-1.5">
      {starts.map(({ day, starts: dayStarts }) => {
        const hasAny = dayStarts.length > 0;
        const pitcherList = hasAny
          ? dayStarts.map(s => `${s.player.name}${s.hasPitched ? ' (done)' : ''}`).join(', ')
          : 'No probable starts';

        return (
          <div
            key={day.date}
            className="flex flex-col items-center gap-0.5"
            title={`${day.dayName} ${day.date}: ${pitcherList}`}
          >
            <span className="flex items-center justify-center w-5 h-5 font-mono leading-none text-[12px] gap-px">
              {hasAny ? (
                dayStarts.map((s, i) => (
                  <span
                    key={i}
                    className={
                      s.hasPitched
                        ? 'text-muted-foreground/60'
                        : `${accentText} font-semibold`
                    }
                    aria-label={s.hasPitched ? 'already pitched' : 'upcoming start'}
                  >
                    {s.hasPitched ? '✓' : '○'}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground/30">·</span>
              )}
            </span>
            <span
              className={`text-[10px] font-mono uppercase leading-none ${
                day.isToday ? 'text-accent font-bold' : !day.isRemaining ? 'text-muted-foreground/60' : 'text-muted-foreground'
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

interface SidePanelProps {
  label: string;
  ipLeft: number | undefined;
  spIp: number | undefined;
  rpIp: number | undefined;
  starts: DayProbables[];
  side: 'me' | 'opp';
  align: 'left' | 'right';
  limits?: LeagueLimits;
  usedIp?: string;
  usedGs?: string;
}

function SidePanel({
  label,
  ipLeft,
  spIp,
  rpIp,
  starts,
  side,
  align,
  limits,
  usedIp,
  usedGs,
}: SidePanelProps) {
  const accentText = side === 'me' ? 'text-accent' : 'text-primary';
  const showIp = limits?.maxInningsPitched != null;
  const showGs = limits?.maxGamesStarted != null;
  const hasBreakdown = spIp != null && rpIp != null;

  return (
    <div className={`flex flex-col items-center gap-1 ${align === 'left' ? 'sm:items-start' : 'sm:items-end'}`}>
      <span className="text-caption text-muted-foreground uppercase tracking-[0.15em] font-semibold">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono font-numeric text-2xl sm:text-3xl font-bold leading-none ${accentText}`}>
          {ipLeft != null ? `~${ipLeft.toFixed(0)}` : '—'}
        </span>
        <span className="text-xs text-muted-foreground">IP left</span>
      </div>
      {hasBreakdown && (
        <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
          SP <span className="text-foreground/80 font-numeric">{spIp!.toFixed(0)}</span>
          {' · '}
          RP <span className="text-foreground/80 font-numeric">{rpIp!.toFixed(0)}</span>
        </div>
      )}
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
 * Weekly pitcher runway block.
 *
 * Lives under the leverage bar / category rail in the Boss Card. The
 * headline number per side is **projected IP remaining** (SP + RP),
 * which directly anchors the catch-up-on-pitcher-stats question: with
 * X IP coming for me and Y for them, can I close the K / W / QS gap?
 *
 * The Mon..Sun day strip shows pitcher-start *status* informationally
 * (✓ already pitched, ◦ upcoming SP, · no scheduled start). Daily start
 * counts don't drive matchup outcomes — the cumulative-week total does —
 * so the strip is no longer a head-to-head visual. See
 * [[reference-mlboss-deployment]] for the redesign discussion.
 */
export default function WeekProgress({
  myStarts,
  oppStarts,
  myProjection,
  oppProjection,
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
        aria-label="Loading weekly pitcher projection"
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
        label="Your pitching"
        ipLeft={myProjection?.weeklyIp}
        spIp={myProjection?.weeklySpIp}
        rpIp={myProjection?.weeklyRpIp}
        starts={myStarts}
        side="me"
        align="left"
        limits={limits}
        usedIp={myUsedIp}
        usedGs={myUsedGs}
      />
      <SidePanel
        label="Opp pitching"
        ipLeft={oppProjection?.weeklyIp}
        spIp={oppProjection?.weeklySpIp}
        rpIp={oppProjection?.weeklyRpIp}
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
