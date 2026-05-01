'use client';

import { useEffect, useState } from 'react';

interface LeverageBarProps {
  wins: number;
  losses: number;
  ties: number;
  /**
   * Magnitude-aware leverage in [-1, +1]. Positive means the user is ahead.
   * Comes from `analyzeMatchup` and reflects per-category margin scaled by
   * how much production is left in the week, so the bar shrinks back toward
   * center for "barely winning lots of cats" situations.
   */
  leverage: number;
  /** Optional huge per-side numerals shown above the bar. Defaults to W/L counts. */
  myScore?: number;
  oppScore?: number;
}

/**
 * Center-origin leverage bar — fills from the middle toward the leading side
 * by `|leverage| * 100%`. The numerals on either side give the actual W/L
 * tally (a different question — "who won more cats"); the bar gives the
 * gestalt of "how solid is the lead".
 *
 * Animates from 0 -> target on first paint so the leverage swing reads as a
 * deliberate beat rather than a static graphic.
 */
export default function LeverageBar({
  wins,
  losses,
  ties,
  leverage,
  myScore,
  oppScore,
}: LeverageBarProps) {
  const clamped = Math.max(-1, Math.min(1, leverage));
  const fillPct = Math.abs(clamped) * 100;
  const isLeading = clamped > 0;
  const isLosing = clamped < 0;

  const [animPct, setAnimPct] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimPct(fillPct));
    return () => cancelAnimationFrame(id);
  }, [fillPct]);

  const myDisplay = myScore ?? wins;
  const oppDisplay = oppScore ?? losses;

  return (
    <div className="w-full">
      {/* Big numerals */}
      <div className="flex items-end justify-between gap-3 mb-1.5">
        <span
          className={`font-mono font-numeric text-3xl sm:text-4xl font-bold leading-none ${
            isLeading ? 'text-accent' : 'text-foreground'
          }`}
        >
          {myDisplay}
        </span>
        <span className="text-caption text-muted-foreground uppercase tracking-[0.2em] mb-1">
          vs
        </span>
        <span
          className={`font-mono font-numeric text-3xl sm:text-4xl font-bold leading-none ${
            isLosing ? 'text-error' : 'text-foreground'
          }`}
        >
          {oppDisplay}
        </span>
      </div>

      {/* Center-origin bar */}
      <div
        className="relative h-2.5 rounded-full bg-border-muted overflow-hidden"
        role="img"
        aria-label={`Leverage: ${wins} wins, ${losses} losses, ${ties} ties`}
      >
        {/* Center divider */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />

        {/* Fill — anchored at center, expanding outward toward the leader's
            corner. The user's team sits on the LEFT, opponent on the RIGHT,
            so a positive leverage (we're winning) fills leftward in gold,
            and a negative leverage fills rightward in red. */}
        {isLeading && (
          <div
            className="absolute top-0 bottom-0 right-1/2 bg-accent rounded-l-full transition-[width] duration-500 ease-out"
            style={{ width: `${animPct / 2}%` }}
          />
        )}
        {isLosing && (
          <div
            className="absolute top-0 bottom-0 left-1/2 bg-error/70 rounded-r-full transition-[width] duration-500 ease-out"
            style={{ width: `${animPct / 2}%` }}
          />
        )}
      </div>

      {/* Tally below */}
      <div className="mt-1.5 flex items-center justify-center gap-2 text-caption text-muted-foreground">
        <span className="text-success font-semibold font-mono font-numeric">{wins}W</span>
        <span aria-hidden="true">·</span>
        <span className="text-error font-semibold font-mono font-numeric">{losses}L</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono font-numeric">{ties}T</span>
      </div>
    </div>
  );
}
