'use client';

import type { ReactNode } from 'react';
import { FiArrowRight } from 'react-icons/fi';
import Icon from '@/components/Icon';

/**
 * One suggested roster move (drop → add, or pure add to an open slot) —
 * the shared card layout both roster pages render. Extracted from the
 * categories page's SwapSuggestions when the points page adopted the
 * position-aware swap engine (2026-07), so the two surfaces can't drift.
 *
 * Strategy-specific content stays with the caller: categories passes
 * leverage badges + move-unit deltas, points passes pts/wk deltas. This
 * component owns only the layout grammar.
 */

export interface MoveCardSide {
  name: string;
  displayPosition?: string;
  percentOwned?: number;
  averageDraftPick?: number;
}

export interface MoveCardPositionChange {
  position: string;
  valueDelta: number;
  /** Negative = this move fills a depth gap; positive = it opens one. */
  depthShortfallDelta?: number;
}

export interface MoveCardDelta {
  key: string | number;
  label: string;
  /** Pre-formatted value text (caller owns units/precision). */
  text: string;
  /** Tailwind text tone class. */
  tone: string;
  title?: string;
}

export default function RosterMoveCard({
  add,
  drop,
  badges,
  deltas = [],
  positionChanges = [],
  netValueText,
  netValuePositive,
  netValueLabel = 'net value',
  resistText,
  resistTitle,
}: {
  add: MoveCardSide;
  /** Null for pure adds (no drop required). */
  drop: MoveCardSide | null;
  /** Reason / strategy badges, rendered inline after the names. */
  badges?: ReactNode;
  /** Per-stat delta strip (caller-formatted). Capped to 4 for density. */
  deltas?: MoveCardDelta[];
  /** Per-position roster value deltas. */
  positionChanges?: MoveCardPositionChange[];
  netValueText: string;
  netValuePositive: boolean;
  netValueLabel?: string;
  /** Optional drop-resistance note (categories page). */
  resistText?: string;
  resistTitle?: string;
}) {
  const isPureAdd = drop === null;
  return (
    <div className="flex items-start gap-3 p-2.5 rounded bg-surface-muted/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {isPureAdd ? (
            <>
              <span className="text-caption text-accent font-medium uppercase tracking-wide">
                Add to open slot
              </span>
              <Icon icon={FiArrowRight} size={12} className="text-muted-foreground shrink-0" />
              <span className="text-xs text-success font-medium truncate">{add.name}</span>
              {add.displayPosition && (
                <span className="text-caption text-muted-foreground">{add.displayPosition}</span>
              )}
            </>
          ) : (
            <>
              <span className="text-xs text-error font-medium truncate">{drop.name}</span>
              {drop.displayPosition && (
                <span className="text-caption text-muted-foreground">{drop.displayPosition}</span>
              )}
              {typeof drop.percentOwned === 'number' && (
                <span className="text-caption text-muted-foreground" title="Yahoo percent owned">
                  {Math.round(drop.percentOwned)}%
                </span>
              )}
              {typeof drop.averageDraftPick === 'number' && drop.averageDraftPick > 0 && (
                <span className="text-caption text-muted-foreground" title="Preseason average draft pick">
                  ADP {drop.averageDraftPick.toFixed(0)}
                </span>
              )}
              <Icon icon={FiArrowRight} size={12} className="text-muted-foreground shrink-0" />
              <span className="text-xs text-success font-medium truncate">{add.name}</span>
              {add.displayPosition && (
                <span className="text-caption text-muted-foreground">{add.displayPosition}</span>
              )}
            </>
          )}
          {badges}
        </div>

        {deltas.length > 0 && (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
            {deltas.slice(0, 4).map(d => (
              <span key={d.key} className={`text-caption font-semibold ${d.tone}`} title={d.title}>
                {d.label}: {d.text}
              </span>
            ))}
          </div>
        )}

        {positionChanges.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {[...positionChanges]
              .sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta))
              .map(c => {
                const sign = c.valueDelta >= 0 ? '+' : '';
                const tone = c.valueDelta >= 0 ? 'text-success/80' : 'text-error/80';
                const gap =
                  (c.depthShortfallDelta ?? 0) < 0
                    ? ' (gap→filled)'
                    : (c.depthShortfallDelta ?? 0) > 0
                      ? ' (gap!)'
                      : '';
                return (
                  <span key={c.position} className={`text-caption ${tone}`}>
                    {c.position}: {sign}
                    {c.valueDelta.toFixed(2)}
                    {gap}
                  </span>
                );
              })}
          </div>
        )}
      </div>
      <div className="text-right shrink-0">
        <span className={`text-xs font-bold ${netValuePositive ? 'text-success' : 'text-error'}`}>
          {netValueText}
        </span>
        <span className="block text-caption text-muted-foreground">{netValueLabel}</span>
        {resistText && (
          <span className="block text-caption text-accent/80" title={resistTitle}>
            {resistText}
          </span>
        )}
      </div>
    </div>
  );
}
