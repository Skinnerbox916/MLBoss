'use client';

import type { ReactNode } from 'react';

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
