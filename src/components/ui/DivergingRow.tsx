/**
 * DivergingRow — the canonical head-to-head stat comparison.
 *
 * Refined per the design system (see docs/design-system.md, preview/comp-diverging):
 *  - a labelled header (CAT · ●You · ●Opponent · MARGIN) so every column reads
 *  - zebra-banded rows you can track across
 *  - each team's value anchored to its own side of a recessed bar "well"
 *  - the bar grows TOWARD the leader's value (green left = you, red right = opp)
 *  - the delta is a W/L margin pill, not a bare number
 *
 * Render a whole table with <DivergingTable>; <DivergingRow> is the per-row unit.
 */

export interface DivergingDatum {
  label: string;
  /** Your formatted value (e.g. "48.9", ".255"). */
  myVal: string;
  /** Opponent's formatted value. */
  oppVal: string;
  /** |my − opp| / max(|my|, |opp|) — relative gap, used to scale the bar. */
  relDelta: number;
  /** true = you lead, false = opp leads, null = tied/neutral. */
  winning: boolean | null;
  /** Signed, formatted margin (e.g. "+14.4", "-.006"). */
  deltaStr: string;
}

// Shared 3-column track so the header and every row align exactly.
const GRID = 'grid grid-cols-[2.5rem_minmax(0,1fr)_3.75rem] items-center gap-x-2.5';

interface DivergingTableProps {
  rows: DivergingDatum[];
  /** Left-side (your) header label. */
  youLabel?: string;
  /** Right-side (opponent) header label. */
  oppLabel: string;
  /** Shared bar scale — pass the max relDelta across all tabs so bars stay comparable. */
  maxRel?: number;
}

export default function DivergingTable({
  rows,
  youLabel = 'You',
  oppLabel,
  maxRel,
}: DivergingTableProps) {
  const scale = maxRel ?? rows.reduce((m, r) => Math.max(m, r.relDelta), 0);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className={`${GRID} bg-muted rounded px-2 py-[5px] mb-0.5`}>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
          Cat
        </span>
        <div className="flex items-center justify-between min-w-0">
          <span className="flex items-center gap-1 text-[11px] font-bold text-foreground whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            {youLabel}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-bold text-foreground whitespace-nowrap truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            <span className="truncate">{oppLabel}</span>
          </span>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground text-right">
          Margin
        </span>
      </div>

      {/* Rows */}
      {rows.map((row, i) => (
        <DivergingRow key={row.label} row={row} maxRel={scale} zebra={i % 2 === 1} />
      ))}
    </div>
  );
}

interface DivergingRowProps {
  row: DivergingDatum;
  maxRel: number;
  zebra: boolean;
}

export function DivergingRow({ row, maxRel, zebra }: DivergingRowProps) {
  const { label, myVal, oppVal, relDelta, winning, deltaStr } = row;
  const isWin = winning === true;
  const isLoss = winning === false;

  // Bar grows from the center toward the leader's value, up to ~half the well.
  const barWidth = maxRel > 0 ? Math.min(relDelta / maxRel, 1) * 48 : 0;

  return (
    <div className={`${GRID} rounded px-2 py-[5px] ${zebra ? 'bg-primary/[0.03]' : ''}`}>
      {/* Category */}
      <span className="text-xs font-bold text-foreground truncate">{label}</span>

      {/* You · well · opponent */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-10 shrink-0 text-right font-mono tabular-nums text-[11px] ${
            isWin ? 'text-success font-bold' : 'text-muted-foreground'
          }`}
        >
          {myVal}
        </span>

        <div className="relative flex-1 min-w-0 h-[15px] rounded bg-primary/[0.06] ring-1 ring-inset ring-primary/20">
          {/* center divider */}
          <div className="absolute left-1/2 -top-0.5 -bottom-0.5 w-px bg-primary/30" />
          {barWidth > 0 && isWin && (
            <div
              className="absolute top-[3px] bottom-[3px] right-1/2 rounded-[2px] bg-success"
              style={{ width: `${barWidth}%` }}
            />
          )}
          {barWidth > 0 && isLoss && (
            <div
              className="absolute top-[3px] bottom-[3px] left-1/2 rounded-[2px] bg-error"
              style={{ width: `${barWidth}%` }}
            />
          )}
        </div>

        <span
          className={`w-10 shrink-0 text-left font-mono tabular-nums text-[11px] ${
            isLoss ? 'text-error font-bold' : 'text-muted-foreground'
          }`}
        >
          {oppVal}
        </span>
      </div>

      {/* Margin pill */}
      <span
        className={`justify-self-end inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-mono tabular-nums text-[10px] font-bold ${
          isWin
            ? 'bg-success/[0.16] text-success'
            : isLoss
              ? 'bg-error/[0.14] text-error'
              : 'bg-muted text-muted-foreground'
        }`}
      >
        {(isWin || isLoss) && (
          <span className="text-[8px] tracking-[0.04em]">{isWin ? 'W' : 'L'}</span>
        )}
        {deltaStr}
      </span>
    </div>
  );
}
