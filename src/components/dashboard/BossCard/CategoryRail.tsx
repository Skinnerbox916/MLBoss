'use client';

import { formatStatValue } from '@/lib/formatStat';
import type { MatchupRow } from '@/components/shared/matchupRows';

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
  const tone =
    !row.hasData ? 'border-border bg-surface' :
    row.winning === true ? 'border-success/40 bg-success/5' :
    row.winning === false ? 'border-error/40 bg-error/5' :
    'border-border bg-surface';

  const myValueTone =
    !row.hasData ? 'text-muted-foreground/70' :
    row.winning === true ? 'text-success' :
    row.winning === false ? 'text-error' :
    'text-foreground';

  const tooltip = row.hasData
    ? `${row.label}: ${formatStatValue(row.myVal, row.name)} vs ${formatStatValue(row.oppVal, row.name)}${isHighlight ? ' · most contested category — chase this' : ''}`
    : `${row.label}: no data yet`;

  return (
    <div
      className={`relative flex flex-col items-center justify-between min-w-[3rem] px-1.5 py-1 rounded-md border ${tone} ${isHighlight ? 'ring-1 ring-accent/60' : ''}`}
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
      <span className={`mt-1 text-sm font-bold font-mono font-numeric leading-none ${myValueTone}`}>
        {row.hasData ? formatStatValue(row.myVal, row.name) : '—'}
      </span>
      <span className="mt-0.5 text-[11px] font-mono font-numeric text-muted-foreground leading-none">
        {row.hasData ? formatStatValue(row.oppVal, row.name) : '—'}
      </span>
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
 * Splits into batting / pitching halves with a vertical divider so the
 * groupings stay readable even with 16 categories on a wide screen. On
 * mobile the divider folds into a row break.
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
    <div className="flex flex-wrap items-stretch justify-center gap-1.5 sm:gap-2">
      {battingRows.length > 0 && (
        <div className="flex flex-wrap items-stretch gap-1 sm:gap-1.5">
          {battingRows.map(row => (
            <CategoryCell key={`bat-${row.statId}`} row={row} isHighlight={row.statId === highlightStatId} />
          ))}
        </div>
      )}

      {battingRows.length > 0 && pitchingRows.length > 0 && (
        <div
          aria-hidden="true"
          className="hidden sm:block self-stretch w-px bg-border mx-1"
        />
      )}

      {pitchingRows.length > 0 && (
        <div className="flex flex-wrap items-stretch gap-1 sm:gap-1.5">
          {pitchingRows.map(row => (
            <CategoryCell key={`pit-${row.statId}`} row={row} isHighlight={row.statId === highlightStatId} />
          ))}
        </div>
      )}
    </div>
  );
}
