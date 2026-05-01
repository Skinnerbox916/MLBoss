'use client';

import { cn } from '@/lib/utils';
import { dayOffsetStr } from '@/lib/pitching/display';

interface DateStripProps {
  /** Smallest offset to render (e.g. 1 for "tomorrow"). */
  minOffset?: number;
  /** Largest offset to render (inclusive). Default 5 gives D+1 through D+5. */
  maxOffset?: number;
  /** Currently-selected offset from today. */
  selectedOffset: number;
  onSelect: (offset: number) => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDate(offset: number): { label: string; subLabel: string } {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  if (offset === 1) return { label: 'Tomorrow', subLabel: `${d.getMonth() + 1}/${d.getDate()}` };
  return {
    label: `${DAY_LABELS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`,
    subLabel: `D+${offset}`,
  };
}

/**
 * Horizontal strip of date selector pills for the streaming page.
 *
 * Covers tomorrow (D+1) through D+5. Probable pitchers are most reliable for
 * D+1 and start going stale around D+3; the strip is intentionally limited
 * to what MLB actually publishes — showing D+6 or later would tease users
 * with mostly-empty boards.
 */
export default function DateStrip({
  minOffset = 1,
  maxOffset = 5,
  selectedOffset,
  onSelect,
}: DateStripProps) {
  const offsets: number[] = [];
  for (let i = minOffset; i <= maxOffset; i++) offsets.push(i);

  return (
    <div className="flex gap-2 flex-wrap">
      {offsets.map(offset => {
        const { label, subLabel } = formatDate(offset);
        const active = offset === selectedOffset;
        return (
          <button
            key={offset}
            onClick={() => onSelect(offset)}
            className={cn(
              'flex flex-col items-start px-3 py-2 rounded-lg border transition-colors text-left',
              active
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-surface hover:bg-surface-muted text-foreground',
            )}
            aria-pressed={active}
            title={dayOffsetStr(offset)}
          >
            <span className="text-sm font-semibold leading-tight">{label}</span>
            <span className="text-caption text-muted-foreground leading-tight">{subLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
