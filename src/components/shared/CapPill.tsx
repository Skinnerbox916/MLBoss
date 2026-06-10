'use client';

import { formatStatValue } from '@/lib/formatStat';

interface CapPillProps {
  label: string;
  used: string | number | undefined;
  cap: number;
  /** Stat-name passthrough for `formatStatValue` ("IP" preserves one
   *  decimal, anything else falls through to the integer/2-decimal
   *  default). */
  formatName: 'IP' | 'GS';
}

/**
 * League-cap pressure pill. Renders `used/cap` with tone tracking
 * remaining headroom: neutral until 80%, accent at "tight" (80-99%),
 * error when maxed. Used in both BossCard's `WeekProgress` and the
 * streaming-page `VolumeGap` panel — same data, same visual grammar.
 */
export default function CapPill({ label, used, cap, formatName }: CapPillProps) {
  const usedNum = used === undefined ? NaN : typeof used === 'number' ? used : parseFloat(used);
  // Pressure: how much of the cap has been used. Threshold mirrors how a
  // manager actually thinks — "tight" when more than 80% is gone.
  const pct = Number.isFinite(usedNum) ? Math.min(1, usedNum / cap) : 0;
  const isTight = pct >= 0.8;
  const isMaxed = pct >= 1;

  const tone =
    isMaxed ? 'bg-error/15 text-error border-error/30' :
    isTight ? 'bg-accent/15 text-accent-700 border-accent/30' :
    'bg-surface-muted text-muted-foreground border-border';

  const usedStr = Number.isFinite(usedNum) ? formatStatValue(usedNum, formatName) : '–';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-numeric ${tone}`}
      title={`${label}: ${usedStr} of ${cap} used${isTight ? ' — tight' : ''}`}
    >
      <span className="font-semibold uppercase tracking-wider">{label}</span>
      <span>{usedStr}/{cap}</span>
    </span>
  );
}
