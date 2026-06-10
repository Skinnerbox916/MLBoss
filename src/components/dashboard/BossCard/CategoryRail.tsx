'use client';

import { formatStatValue } from '@/lib/formatStat';
import { matchupCellShowsNumeric, type MatchupRow } from '@/components/shared/matchupRows';

interface CategoryRailProps {
  /** Batting categories first, pitching second — preserves Yahoo's natural order. */
  battingRows: MatchupRow[];
  pitchingRows: MatchupRow[];
  /** stat_id of the most contested losing category — gets a "chase me" dot.
   *  Computed once at the BossCard level so the rail doesn't need the
   *  full analysis payload. */
  highlightStatId?: number;
}

function CategoryCell({ row, isHighlight }: { row: MatchupRow; isHighlight: boolean }) {
  const myShown = matchupCellShowsNumeric(row.myVal);
  const oppShown = matchupCellShowsNumeric(row.oppVal);

  const tone =
    !row.countsTowardRecord ? 'border-border bg-surface' :
    row.winning === true ? 'border-success/40 bg-success/5' :
    row.winning === false ? 'border-error/40 bg-error/5' :
    'border-border bg-surface';

  const myValueTone =
    !row.countsTowardRecord ? 'text-muted-foreground/70' :
    row.winning === true ? 'text-success' :
    row.winning === false ? 'text-error' :
    'text-foreground';

  const tooltip = row.countsTowardRecord
    ? `${row.label}: ${formatStatValue(row.myVal, row.name)} vs ${formatStatValue(row.oppVal, row.name)}${isHighlight ? ' · most contested category — chase this' : ''}`
    : myShown || oppShown
      ? `${row.label}: ${myShown ? formatStatValue(row.myVal, row.name) : '—'} vs ${oppShown ? formatStatValue(row.oppVal, row.name) : '—'} · head-to-head pending`
      : `${row.label}: no data yet`;

  return (
    <div
      className={`relative flex flex-col items-center justify-between min-w-0 sm:min-w-[3rem] px-1.5 py-1 rounded border ${tone} ${isHighlight ? 'ring-1 ring-accent/60' : ''}`}
      title={tooltip}
    >
      {isHighlight && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent ring-1 ring-background animate-pulse"
        />
      )}
      <span className="text-[10px] font-bold uppercase tracking-tight font-mono leading-none text-muted-foreground">
        {row.label}
      </span>
      {/* Values: one `my / opp` line on mobile (2-line tile), stacked on sm+
          (3-line tile) — see the design system's mobile Boss Card spec. */}
      <div className="mt-1 flex items-baseline gap-1 font-mono font-numeric leading-none sm:flex-col sm:items-center sm:gap-0">
        <span className={`text-[11px] sm:text-sm font-bold ${myValueTone}`}>
          {myShown ? formatStatValue(row.myVal, row.name) : '—'}
        </span>
        <span aria-hidden="true" className="sm:hidden text-[9px] text-muted-foreground">
          /
        </span>
        <span className="text-[10px] sm:mt-0.5 sm:text-[11px] text-muted-foreground">
          {oppShown ? formatStatValue(row.oppVal, row.name) : '—'}
        </span>
      </div>
    </div>
  );
}

function SideGroup({
  label,
  rows,
  keyPrefix,
  highlightStatId,
}: {
  label: string;
  rows: MatchupRow[];
  keyPrefix: string;
  highlightStatId?: number;
}) {
  return (
    <div className="min-w-0">
      {/* Mobile section caption — replaces the desktop vertical divider,
          which doesn't survive a 4-per-row wrapped grid. */}
      <p className="sm:hidden text-micro font-mono font-bold uppercase tracking-[0.1em] text-muted-foreground mb-1 ml-0.5">
        {label}
      </p>
      <div className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap sm:items-stretch sm:gap-1.5">
        {rows.map(row => (
          <CategoryCell
            key={`${keyPrefix}-${row.statId}`}
            row={row}
            isHighlight={row.statId === highlightStatId}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Compressed category rail — one tile per scoring category.
 *
 * Each tile stacks: category abbreviation (muted), my value (bold, color-
 * coded green/red by winner), opponent value (muted). The colored border
 * carries the win/loss state visually so you can scan the rail at a glance.
 *
 * Splits into batting / pitching halves. On sm+ a vertical divider separates
 * the wrapped tile runs; on mobile each half becomes a labeled 4-up grid of
 * compact 2-line tiles (label / `my / opp`) per the design system's mobile
 * Boss Card spec.
 */
export default function CategoryRail({ battingRows, pitchingRows, highlightStatId }: CategoryRailProps) {
  const hasAny = battingRows.length > 0 || pitchingRows.length > 0;
  if (!hasAny) {
    return (
      <p className="text-xs text-muted-foreground text-center">
        Categories will load with the matchup.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch sm:justify-center sm:gap-2">
      {battingRows.length > 0 && (
        <SideGroup
          label="Batting"
          rows={battingRows}
          keyPrefix="bat"
          highlightStatId={highlightStatId}
        />
      )}

      {battingRows.length > 0 && pitchingRows.length > 0 && (
        <div
          aria-hidden="true"
          className="hidden sm:block self-stretch w-px bg-border mx-1"
        />
      )}

      {pitchingRows.length > 0 && (
        <SideGroup
          label="Pitching"
          rows={pitchingRows}
          keyPrefix="pit"
          highlightStatId={highlightStatId}
        />
      )}
    </div>
  );
}
