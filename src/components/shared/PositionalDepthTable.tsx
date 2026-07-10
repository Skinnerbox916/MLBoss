'use client';

import type { ReactNode } from 'react';
import { FiMinus, FiPlus, FiRotateCcw } from 'react-icons/fi';
import Icon from '@/components/Icon';

/**
 * Positional-depth table — the shared presentation both roster pages use
 * for the "slot picture": starters, best true backup, and gap status per
 * position. Extracted from the categories page's DepthChart when the
 * points page adopted the shared depth solver (2026-07).
 *
 * The Target column (preferred-depth steppers) is caller-provided via
 * `renderTarget`; when omitted the column doesn't render (points v1 runs
 * on default depth).
 */

export interface DepthTableRow {
  position: string;
  startingSlots: number;
  eligibleCount: number;
  minDepth: number;
  depthShortfall: number;
  starters: string[];
  firstBackup: string | null;
}

export function depthStatus(row: DepthTableRow): { label: string; color: string } {
  if (row.startingSlots === 0) return { label: '—', color: 'text-muted-foreground/50' };
  if (row.depthShortfall > 0) return { label: 'GAP', color: 'text-error' };
  if (row.eligibleCount >= row.minDepth + 2) return { label: 'deep', color: 'text-success' };
  return { label: 'ok', color: 'text-accent' };
}

/**
 * Preferred-depth stepper for the Target column — shared by both roster
 * pages (moved here from the categories page when points gained target
 * pickers, 2026-07).
 */
export function DepthStepper({
  value,
  defaultValue,
  min,
  max,
  onChange,
}: {
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  onChange: (next: number | null) => void;
}) {
  const isCustom = value !== defaultValue;
  const canDec = value > min;
  const canInc = value < max;
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="Decrease preferred depth"
        disabled={!canDec}
        onClick={() => canDec && onChange(value - 1)}
        className="flex h-5 w-5 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground"
      >
        <Icon icon={FiMinus} size={10} />
      </button>
      <span
        className={`tabular-nums text-xs font-semibold min-w-[1.25rem] text-center ${
          isCustom ? 'text-accent' : 'text-foreground'
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase preferred depth"
        disabled={!canInc}
        onClick={() => canInc && onChange(value + 1)}
        className="flex h-5 w-5 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground"
      >
        <Icon icon={FiPlus} size={10} />
      </button>
      {isCustom && (
        <button
          type="button"
          aria-label="Reset to default"
          title={`Reset to default (${defaultValue})`}
          onClick={() => onChange(null)}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-accent"
        >
          <Icon icon={FiRotateCcw} size={10} />
        </button>
      )}
    </div>
  );
}

export default function PositionalDepthTable({
  rows,
  renderTarget,
}: {
  rows: DepthTableRow[];
  renderTarget?: (row: DepthTableRow) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Pos</th>
            <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-12">Slots</th>
            <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-16">Eligible</th>
            {renderTarget && (
              <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-28">Target</th>
            )}
            <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-14">Status</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Starters</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Best Backup</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const status = depthStatus(row);
            return (
              <tr key={row.position} className="border-b border-border/50">
                <td className="px-2 py-1.5 font-semibold text-foreground">{row.position}</td>
                <td className="px-2 py-1.5 text-center text-muted-foreground">{row.startingSlots}</td>
                <td className="px-2 py-1.5 text-center text-foreground">{row.eligibleCount}</td>
                {renderTarget && <td className="px-2 py-1.5 text-center">{renderTarget(row)}</td>}
                <td className={`px-2 py-1.5 text-center font-semibold ${status.color}`}>{status.label}</td>
                <td className="px-2 py-1.5 text-foreground truncate max-w-[200px]">
                  {row.starters.join(', ') || <span className="text-error">— empty</span>}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[200px]">
                  {row.firstBackup ?? <span className="text-error">none</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
