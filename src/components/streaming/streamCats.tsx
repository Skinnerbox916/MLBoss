'use client';

import { formatStatDelta } from '@/lib/formatStat';
import type { CatDelta } from '@/lib/projection/streamCatImpact';

/**
 * Shared display vocabulary for the categories streaming boards (batter +
 * pitcher). Both boards price an add as net per-category deltas
 * (streamCatImpact / streamPitcherCatImpact) and render them the same way:
 * a native-unit chip, sign-aware color (help = green, hurt = red — which
 * for ERA/WHIP means a *lower* value is the good one, handled by the
 * engine's `good` flag). Keep the label map and chip in one place so the
 * two boards can't drift.
 */

/** Yahoo stat_id → short label. Doubles as the `formatStatDelta` name, so
 *  ERA/WHIP/IP format with the right precision. */
export const STREAM_STAT_LABEL: Record<number, string> = {
  // Batter
  3: 'AVG',
  7: 'R',
  8: 'H',
  12: 'HR',
  13: 'RBI',
  16: 'SB',
  18: 'BB',
  21: 'K',
  23: 'TB',
  // Pitcher
  26: 'ERA',
  27: 'WHIP',
  28: 'W',
  42: 'K',
  50: 'IP',
  83: 'QS',
};

/** One net category delta in real units. `good` already accounts for
 *  lower-is-better cats, so callers never re-derive direction from sign. */
export function DeltaChip({ delta, dimmed = false }: { delta: CatDelta; dimmed?: boolean }) {
  const label = STREAM_STAT_LABEL[delta.statId] ?? `#${delta.statId}`;
  const value = formatStatDelta(delta.delta, label);
  const toneClass = delta.good
    ? 'border-success/40 text-success'
    : 'border-error/40 text-error';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-caption font-medium ${toneClass} ${dimmed ? 'opacity-40' : ''}`}
    >
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}
