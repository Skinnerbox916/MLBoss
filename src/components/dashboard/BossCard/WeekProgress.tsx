'use client';

import type { PitcherTeamProjectionResponse } from '@/lib/hooks/usePitcherTeamProjection';
import type { LeagueLimits } from '@/lib/fantasy/limits';
import CapPill from '@/components/shared/CapPill';

interface WeekProgressProps {
  /** Forward IP projection (SP + RP) for each side. The headline reads
   *  from `weeklyIp`; SP/RP breakdown lives on the tooltip. Undefined
   *  while loading. */
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

interface SidePanelProps {
  label: string;
  projection?: PitcherTeamProjectionResponse;
  side: 'me' | 'opp';
  align: 'left' | 'right';
  limits?: LeagueLimits;
  usedIp?: string;
  usedGs?: string;
}

function SidePanel({
  label,
  projection,
  side,
  align,
  limits,
  usedIp,
  usedGs,
}: SidePanelProps) {
  const accentText = side === 'me' ? 'text-accent' : 'text-primary';
  const showIp = limits?.maxInningsPitched != null;
  const showGs = limits?.maxGamesStarted != null;

  const ipLeft = projection?.weeklyIp;
  const spIp = projection?.weeklySpIp;
  const rpIp = projection?.weeklyRpIp;
  const tooltip = spIp != null && rpIp != null
    ? `Projected SP IP ${spIp.toFixed(0)} · RP IP ${rpIp.toFixed(0)}`
    : 'Projected IP remaining this matchup week';

  return (
    <div className={`flex flex-col gap-2 ${align === 'right' ? 'sm:items-end' : 'sm:items-start'} items-center`}>
      <span className="text-caption text-muted-foreground uppercase tracking-[0.15em] font-semibold">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5" title={tooltip}>
        <span className={`font-mono font-numeric text-3xl sm:text-4xl font-bold leading-none ${accentText}`}>
          {ipLeft != null ? `~${ipLeft.toFixed(0)}` : '—'}
        </span>
        <span className="text-xs text-muted-foreground">IP left</span>
      </div>
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
 * Weekly pitcher headroom block on the Boss Card.
 *
 * Single-purpose now: shows projected IP remaining per side (SP + RP)
 * for the rest of the matchup week. The per-day schedule context that
 * used to live here (start counts, day strip, spike emphasis) was hard
 * to read at this scale and didn't drive matchup-level decisions —
 * matchups are settled on cumulative weekly stats, not day-by-day start
 * counts. That detail now lives on the streaming page's DateStrip /
 * StreamingBoard where it's actually actionable.
 *
 * SP/RP breakdown is preserved as a hover-tooltip on the number for
 * the rare case it matters; the bare display stays minimal.
 */
export default function WeekProgress({
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
          <div className="h-9 w-20 bg-border-muted rounded" />
        </div>
        <div className="flex flex-col gap-2 items-end">
          <div className="h-3 w-24 bg-border-muted rounded" />
          <div className="h-9 w-20 bg-border-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-8 items-end">
      <SidePanel
        label="Your pitching"
        projection={myProjection}
        side="me"
        align="left"
        limits={limits}
        usedIp={myUsedIp}
        usedGs={myUsedGs}
      />
      <SidePanel
        label="Opp pitching"
        projection={oppProjection}
        side="opp"
        align="right"
        limits={limits}
        usedIp={oppUsedIp}
        usedGs={oppUsedGs}
      />
    </div>
  );
}
