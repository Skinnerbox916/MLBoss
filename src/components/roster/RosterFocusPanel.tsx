'use client';

import { useMemo } from 'react';
import { FiLock, FiCalendar, FiSlash, FiRotateCcw } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Panel from '@/components/ui/Panel';
import type { ForecastEntry, LeagueForecast } from '@/lib/league/forecast';
import {
  DECIDED_DISTANCE,
  type CategoryLeverage,
  type RosterLeverage,
} from '@/lib/league/rosterValue';

/**
 * Roster Focus: per-cat tiles for ROS roster construction, split into
 * **In play** (ranked by leverage: most-contested first) and a
 * **Conceded** shelf — the same grammar `GamePlanPanel` uses for the
 * weekly matchup, driven by the roster layer's own distance (RUPM
 * moves-from-a-winning-rank; z for pitchers pending pitcher RUPM).
 * See docs/pivotality-migration.md#roster-side-l6.
 *
 * Chase/hold/punt is gone here too: every category is in-play by
 * default, weighted by how contested it is. The only lever is concede
 * vs contest. Auto-concede comes from the chase coalition
 * (rosterValue.ts): unreachable cats and chases the shared move budget
 * didn't fund go to the shelf; a cushioned lead stays in-play at its
 * naturally small weight, never on the shelf. The "→ Nth" chip marks
 * funded chases only.
 */
interface RosterFocusPanelProps {
  forecast: LeagueForecast | undefined;
  isLoading: boolean;
  side?: 'batting' | 'pitching';
  /** Leverage detail from `useRosterCategoryWeights` for this side. */
  leverage: RosterLeverage;
  isConceded: (statId: number) => boolean;
  isAutoConceded: (statId: number) => boolean;
  onToggleConcede: (statId: number) => void;
  onReset?: () => void;
  hasOverrides?: boolean;
}

export default function RosterFocusPanel({
  forecast,
  isLoading,
  side = 'batting',
  leverage,
  isConceded,
  isAutoConceded,
  onToggleConcede,
  onReset,
  hasOverrides = false,
}: RosterFocusPanelProps) {
  const sideEntries = useMemo(() => {
    if (!forecast) return [];
    return forecast.entries.filter(e =>
      side === 'batting' ? e.isBatterStat : e.isPitcherStat,
    );
  }, [forecast, side]);

  const grouped = useMemo(() => {
    const inPlay: ForecastEntry[] = [];
    const conceded: ForecastEntry[] = [];
    for (const entry of sideEntries) {
      if (isConceded(entry.statId)) conceded.push(entry);
      else inPlay.push(entry);
    }
    const weight = (e: ForecastEntry) => leverage.byStatId.get(e.statId)?.pivotalWeight ?? 0;
    inPlay.sort((a, b) => weight(b) - weight(a));
    conceded.sort((a, b) => weight(b) - weight(a));
    return { inPlay, conceded };
  }, [sideEntries, isConceded, leverage]);

  const sideLabel = side === 'pitching' ? 'Pitching' : 'Batting';
  const title = `${sideLabel} Roster Focus`;

  const action = (
    <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
      {forecast && (
        <span className="text-muted-foreground">
          Across {forecast.teamCount} teams
        </span>
      )}
      {onReset && hasOverrides && (
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 text-muted-foreground hover:text-accent transition-colors"
          title="Clear concede/contest overrides — back to the engine's read"
        >
          <Icon icon={FiRotateCcw} size={11} />
          <span>Reset</span>
        </button>
      )}
    </div>
  );

  const helper = useMemo(() => {
    if (sideEntries.length === 0) return undefined;
    if (leverage.flatFallback) {
      return 'Nothing is contested from here — showing unweighted talent value so the boards still rank. Contest a category to put leverage back in charge.';
    }
    const levs = sideEntries
      .map(e => leverage.byStatId.get(e.statId))
      .filter((l): l is NonNullable<typeof l> => Boolean(l));
    const battlegrounds = levs.filter(l => l.status === 'contested').length;
    const cushioned = levs.filter(l => l.status === 'cushioned').length;
    const conceded = levs.filter(l => l.status === 'conceded').length;
    const parts = [
      `${battlegrounds} battleground${battlegrounds === 1 ? '' : 's'}`,
    ];
    if (cushioned > 0) parts.push(`${cushioned} cushioned`);
    if (conceded > 0) parts.push(`${conceded} conceded`);
    return `ROS, matchup vacuum: ${parts.join(' · ')}. Player values weight production by how contested each cat still is.`;
  }, [sideEntries, leverage]);

  if (isLoading && sideEntries.length === 0) {
    return (
      <Panel title={title} action={action}>
        <p className="text-xs text-muted-foreground">Computing league forecast…</p>
      </Panel>
    );
  }

  if (sideEntries.length === 0) {
    return (
      <Panel title={title} action={action}>
        <p className="text-xs text-muted-foreground">
          No {side === 'pitching' ? 'pitcher-cat' : 'batter-cat'} signal yet.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={title} action={action} helper={helper}>
      <div className="space-y-3">
        <GroupSection
          label="In play"
          tone="success"
          entries={grouped.inPlay}
          empty="Nothing in play — every category is conceded."
          conceded={false}
          leverage={leverage}
          isAutoConceded={isAutoConceded}
          onToggleConcede={onToggleConcede}
        />
        <GroupSection
          label="Conceded"
          tone="muted"
          entries={grouped.conceded}
          empty="Nothing conceded — contesting every category."
          conceded
          leverage={leverage}
          isAutoConceded={isAutoConceded}
          onToggleConcede={onToggleConcede}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// GroupSection — header + tile container (In play / Conceded)
// ---------------------------------------------------------------------------

function GroupSection({
  label,
  tone,
  entries,
  empty,
  conceded,
  leverage,
  isAutoConceded,
  onToggleConcede,
}: {
  label: string;
  tone: 'success' | 'muted';
  entries: ForecastEntry[];
  empty: string;
  conceded: boolean;
  leverage: RosterLeverage;
  isAutoConceded: (statId: number) => boolean;
  onToggleConcede: (statId: number) => void;
}) {
  const labelTone = tone === 'success' ? 'text-success' : 'text-muted-foreground';
  return (
    <div className="bg-surface-muted/30 rounded-lg p-2.5">
      <div className={`flex items-center gap-1.5 ${labelTone} text-caption font-semibold uppercase tracking-wide`}>
        <Icon icon={tone === 'success' ? FiCalendar : FiSlash} size={11} />
        <span>{label}</span>
        <span className="text-muted-foreground/70">· {entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-caption text-muted-foreground/60 mt-1.5">{empty}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {entries.map(entry => (
            <CategoryTile
              key={entry.statId}
              entry={entry}
              leverage={leverage}
              conceded={conceded}
              autoConceded={conceded && isAutoConceded(entry.statId)}
              onToggleConcede={onToggleConcede}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryTile — label + concede toggle + rank + target/outlier flags
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Plain-language read of the leverage state for the tile caption. */
function reasonText(
  entry: ForecastEntry,
  lev: CategoryLeverage | undefined,
  distance: number,
  conceded: boolean,
  autoConceded: boolean,
): string {
  if (conceded) {
    if (!autoConceded) return 'conceded';
    return lev?.concedeReason === 'budget'
      ? 'conceded · moves better spent'
      : 'conceded · out of reach';
  }
  if (distance >= DECIDED_DISTANCE) return 'cushioned — defend, don’t dilute';
  if (distance > 0.2) return 'ahead, contestable';
  if (distance >= -0.2) return 'battleground';
  if (lev?.targeted) {
    return entry.movesToTarget !== undefined && entry.movesToTarget <= 1
      ? 'one good move away'
      : 'chaseable with moves';
  }
  return 'behind, contestable';
}

function CategoryTile({
  entry,
  leverage,
  conceded,
  autoConceded,
  onToggleConcede,
}: {
  entry: ForecastEntry;
  leverage: RosterLeverage;
  conceded: boolean;
  autoConceded: boolean;
  onToggleConcede: (statId: number) => void;
}) {
  const lev = leverage.byStatId.get(entry.statId);
  const distance = lev?.distance ?? 0;
  const teamCount = entry.ranking.length;

  const borderTone = conceded
    ? 'border-dashed border-border bg-surface-muted/40 opacity-70'
    : distance >= DECIDED_DISTANCE ? 'border-success/30 bg-success/5'
    : distance <= -0.2 ? 'border-error/30 bg-error/5'
    : 'border-border bg-background';

  const rankColor = conceded
    ? 'text-muted-foreground'
    : entry.me.rank <= 2 ? 'text-success'
    : distance <= -0.2 ? 'text-error'
    : 'text-foreground';

  // Chip only for FUNDED chases — a reachable target the coalition chose
  // to spend moves on. A cat can be in play without a chip (riding its
  // natural weight, no spend planned).
  const targetChip =
    lev?.targeted && entry.targetRank !== undefined && entry.targetRank < entry.me.rank
      ? `→ ${ordinal(entry.targetRank)}`
      : null;

  const outlierAbove = entry.outliers
    .filter(o => o.rank < entry.me.rank)
    .sort((a, b) => a.rank - b.rank)[0];

  return (
    <div className={`flex flex-col px-3 py-2 rounded-lg border ${borderTone} min-w-[9rem]`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-base font-bold text-foreground tracking-wide leading-none">{entry.displayName}</span>
        <button
          type="button"
          onClick={() => onToggleConcede(entry.statId)}
          title={conceded ? 'Contest — put this category back in play' : 'Concede this category for the season'}
          aria-label={conceded ? `Contest ${entry.displayName}` : `Concede ${entry.displayName}`}
          className={`flex items-center justify-center w-5 h-5 rounded ring-1 ring-border-muted/60 transition-colors ${
            conceded
              ? 'text-muted-foreground/60 hover:text-success hover:ring-success/40'
              : 'text-muted-foreground/45 hover:text-error hover:ring-error/40'
          }`}
        >
          <Icon icon={conceded ? FiRotateCcw : FiSlash} size={11} />
        </button>
      </div>
      <div className="flex items-baseline gap-2 tabular-nums leading-tight">
        <span className={`text-sm font-bold ${rankColor}`}>
          {ordinal(entry.me.rank)}
          <span className="text-muted-foreground/60 font-normal"> / {teamCount}</span>
        </span>
        {targetChip && <span className="text-caption text-accent">{targetChip}</span>}
        {outlierAbove && (
          <span
            className="flex items-center gap-1 text-caption text-muted-foreground/80"
            title={`${outlierAbove.teamName} locked at ${ordinal(outlierAbove.rank)}`}
          >
            <Icon icon={FiLock} size={10} />
            <span>{ordinal(outlierAbove.rank)} locked</span>
          </span>
        )}
      </div>
      <span className="text-caption text-muted-foreground/80 italic mt-0.5 leading-tight">
        {reasonText(entry, lev, distance, conceded, autoConceded)}
      </span>
    </div>
  );
}
