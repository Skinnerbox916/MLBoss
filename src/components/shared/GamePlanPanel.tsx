'use client';

import { useMemo, useState } from 'react';
import { FiCalendar, FiSlash, FiRotateCcw } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import { formatStatValue } from '@/lib/formatStat';
import type {
  AnalyzedMatchupRow,
  MatchupAnalysis,
} from '@/lib/matchup/analysis';
import { rowHasComparablePair } from '@/components/shared/matchupRows';
import type { DailyBaseline } from '@/lib/projection/slotAware';
import type { WeekTarget } from '@/lib/dashboard/weekRange';

/**
 * Game Plan: per-cat tiles for **this week's matchup**, split into two
 * groups — **In play** (ranked by pivotality: most-contested first) and a
 * **Conceded** shelf. Each tile reads at a glance via state-colored border
 * (winning / losing / tied), shows current → projected swing when available,
 * and carries a single concede/contest toggle so the user can give up a
 * category or pull one back without leaving the panel. The reset affordance
 * lives in the panel header. See docs/pivotality-migration.md.
 *
 * Chase/hold/punt is gone: every category is in-play by default, weighted by
 * how contested it is. The only lever is concede vs contest. A decided loss
 * is conceded automatically; a locked win stays in-play (you're winning it,
 * it's just low-leverage), never on the concede shelf.
 *
 * One component, two pages, two sides:
 *  - `side: 'batting'` filters to is_batter_stat rows
 *  - `side: 'pitching'` filters to is_pitcher_stat rows
 */
interface GamePlanPanelProps {
  analysis: MatchupAnalysis;
  isCorrected: boolean;
  isLoading: boolean;
  /** 'batting' filters to is_batter_stat rows; 'pitching' to is_pitcher_stat. */
  side?: 'batting' | 'pitching';
  /** Opponent name, displayed in the action slot. */
  opponentName?: string;
  /** Number of pickup-playable days remaining. Streaming-only. */
  actionableDays?: number;
  /** Which week the panel describes. Default `'current'` (mid-week
   *  matchup). `'next'` adds a header chip and is set by the end-of-week
   *  streaming pivot. */
  targetWeek?: WeekTarget;
  /** Compact week label ("Wk 17 · 7/13–7/26") — the real matchup dates, so
   *  an irregular week (all-star break) reads structurally. */
  weekLabel?: string;
  /** Per-day slot baselines from the slot-aware engine (batter side
   *  only). When empty, the footer renders nothing. */
  dailyBaselines?: DailyBaseline[];

  /** Composite weight per stat_id (0 = conceded) — used to rank in-play tiles. */
  categoryWeights: Record<number, number>;
  /** Is this category conceded (auto decided-loss or user)? */
  isConceded: (statId: number) => boolean;
  /** Was it conceded purely by the auto rule? Drives the "auto" hint. */
  isAutoConceded: (statId: number) => boolean;
  /** Toggle a category between conceded and contested. */
  onToggleConcede: (statId: number) => void;
  /** Reset affordance — only renders when `hasOverrides`. */
  onReset?: () => void;
  hasOverrides?: boolean;
}

export default function GamePlanPanel({
  analysis,
  isCorrected,
  isLoading,
  side = 'batting',
  opponentName,
  actionableDays,
  targetWeek = 'current',
  weekLabel,
  dailyBaselines = [],
  categoryWeights,
  isConceded,
  isAutoConceded,
  onToggleConcede,
  onReset,
  hasOverrides = false,
}: GamePlanPanelProps) {
  const sideRows = useMemo(
    () => analysis.rows.filter(r => side === 'batting' ? r.isBatterStat : r.isPitcherStat),
    [analysis.rows, side],
  );

  // Mobile-only: which category's detail is open under the chip cluster.
  // On small screens the tiles collapse to stat-name chips (color = status)
  // and one tapped category at a time expands to its full projection.
  const [expandedStatId, setExpandedStatId] = useState<number | null>(null);
  const handleChipTap = (statId: number) =>
    setExpandedStatId(prev => (prev === statId ? null : statId));

  const grouped = useMemo(() => {
    const inPlay: AnalyzedMatchupRow[] = [];
    const conceded: AnalyzedMatchupRow[] = [];
    for (const row of sideRows) {
      if (isConceded(row.statId)) conceded.push(row);
      else inPlay.push(row);
    }
    // In-play: signal-bearing rows first (sorted by most-contested = highest
    // pivotality weight), then no-signal rows at the bottom. Without the signal
    // tier, a no-signal row reads `margin=0 → pivotality=1.0` (the max) and
    // floats above genuinely contested cats with a "no signal yet" caption.
    inPlay.sort((a, b) => {
      const aSig = rowHasComparablePair(a) ? 1 : 0;
      const bSig = rowHasComparablePair(b) ? 1 : 0;
      if (aSig !== bSig) return bSig - aSig;
      return (categoryWeights[b.statId] ?? 0) - (categoryWeights[a.statId] ?? 0);
    });
    // Conceded: most out-of-reach first.
    conceded.sort((a, b) => a.margin - b.margin);
    return { inPlay, conceded };
  }, [sideRows, isConceded, categoryWeights]);

  const projWins = sideRows.filter(r => r.margin > 0).length;
  const projLosses = sideRows.filter(r => r.margin < 0).length;

  const sideLabel = side === 'pitching' ? 'Pitching' : 'Batting';
  const title = `${sideLabel} Game Plan`;

  const action = (
    <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
      {targetWeek === 'next' && (
        <Badge color="accent">Next week</Badge>
      )}
      {weekLabel && (
        <span className="text-muted-foreground font-mono">{weekLabel}</span>
      )}
      {opponentName && (
        <span className="text-muted-foreground">vs {opponentName}</span>
      )}
      <Badge color={projWins >= projLosses ? 'success' : 'error'}>
        {projWins}W · {projLosses}L projected
      </Badge>
      {actionableDays !== undefined && actionableDays > 0 && (
        <span className="text-muted-foreground">
          {actionableDays} day{actionableDays === 1 ? '' : 's'} to act
        </span>
      )}
      {onReset && <FocusResetButton onReset={onReset} hasOverrides={hasOverrides} />}
    </div>
  );

  if (isLoading && sideRows.length === 0) {
    return (
      <Panel title={title} action={action}>
        <p className="text-xs text-muted-foreground">Computing weekly projection…</p>
      </Panel>
    );
  }

  if (sideRows.length === 0) {
    return (
      <Panel title={title} action={action}>
        <p className="text-xs text-muted-foreground">No {side === 'pitching' ? 'pitcher-cat' : 'batter-cat'} signal yet for this matchup week.</p>
      </Panel>
    );
  }

  // Helper text varies by side, week target, and projection state.
  const helper = (() => {
    if (!isCorrected) {
      return targetWeek === 'next'
        ? 'Next-week projection still loading. Reasons will sharpen as it resolves.'
        : 'Matchup-to-date only — projection still loading. Reasons will sharpen as it resolves.';
    }
    if (targetWeek === 'next') {
      return 'Pure-projection values for the upcoming matchup — your roster vs opponent\'s roster against next week\'s schedule, parks, and probable pitchers.';
    }
    if (side === 'pitching') {
      return 'Counting and ratio cats use forward projections when current-week stats are missing or incomplete.';
    }
    return undefined;
  })();

  return (
    <Panel title={title} action={action} helper={helper}>
      <div className="space-y-3">
        <GroupSection
          label="In play"
          tone="success"
          rows={grouped.inPlay}
          empty="Nothing in play — every category is conceded."
          conceded={false}
          isAutoConceded={isAutoConceded}
          onToggleConcede={onToggleConcede}
          expandedStatId={expandedStatId}
          onChipTap={handleChipTap}
        />
        <GroupSection
          label="Conceded"
          tone="muted"
          rows={grouped.conceded}
          empty="Nothing conceded — contesting every category."
          conceded
          isAutoConceded={isAutoConceded}
          onToggleConcede={onToggleConcede}
          expandedStatId={expandedStatId}
          onChipTap={handleChipTap}
        />
        <SlotPressureRow dailyBaselines={dailyBaselines} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// GroupSection — header + tile/chip container (In play / Conceded)
//
// Two renderings of the same rows: full CategoryTiles on sm+, and a compact
// stat-name chip cluster on mobile where one tapped category at a time
// expands to a detail block (per the design system's mobile Game Plan spec —
// mlboss-design-system/project/preview/mobile-cards.html). Chip tint encodes
// status, so the cluster reads as a heatmap of the matchup.
// ---------------------------------------------------------------------------

function GroupSection({
  label,
  tone,
  rows,
  empty,
  conceded,
  isAutoConceded,
  onToggleConcede,
  expandedStatId,
  onChipTap,
}: {
  label: string;
  tone: 'success' | 'muted';
  rows: AnalyzedMatchupRow[];
  empty: string;
  conceded: boolean;
  isAutoConceded: (statId: number) => boolean;
  onToggleConcede: (statId: number) => void;
  expandedStatId: number | null;
  onChipTap: (statId: number) => void;
}) {
  const labelTone = tone === 'success' ? 'text-success' : 'text-muted-foreground';
  const expandedRow = rows.find(r => r.statId === expandedStatId);
  return (
    <div className="bg-surface-muted/30 rounded-lg p-2.5">
      <div className={`flex items-center gap-1.5 ${labelTone} text-caption font-semibold uppercase tracking-wide`}>
        <Icon icon={tone === 'success' ? FiCalendar : FiSlash} size={11} />
        <span>{label}</span>
        <span className="text-muted-foreground/70">· {rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-caption text-muted-foreground/60 mt-1.5">{empty}</p>
      ) : (
        <>
          {/* Desktop: full tiles */}
          <div className="mt-2 hidden sm:flex flex-wrap gap-2">
            {rows.map(row => (
              <CategoryTile
                key={row.statId}
                row={row}
                conceded={conceded}
                autoConceded={conceded && isAutoConceded(row.statId)}
                onToggleConcede={onToggleConcede}
              />
            ))}
          </div>

          {/* Mobile: compact chips, tap to expand one detail at a time */}
          <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
            {rows.map(row => {
              const active = row.statId === expandedStatId;
              return (
                <button
                  key={row.statId}
                  type="button"
                  onClick={() => onChipTap(row.statId)}
                  aria-expanded={active}
                  className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold tracking-wide transition-colors ${chipTone(row, conceded)} ${
                    active ? 'ring-2 ring-offset-1 ring-offset-surface ring-current' : ''
                  }`}
                >
                  {row.label}
                </button>
              );
            })}
          </div>
          {expandedRow && (
            <div className="sm:hidden">
              <ChipDetail
                row={expandedRow}
                conceded={conceded}
                autoConceded={conceded && isAutoConceded(expandedRow.statId)}
                onToggleConcede={onToggleConcede}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Chip tint = at-a-glance status: deep green locked win, green lead, amber
 *  lead-narrowing, red behind, dashed muted conceded, plain neutral. */
function chipTone(row: AnalyzedMatchupRow, conceded: boolean): string {
  if (conceded) return 'border border-dashed border-border bg-muted text-muted-foreground';
  if (!rowHasComparablePair(row)) return 'border border-border bg-surface text-muted-foreground';
  if (row.margin > 0) {
    if (row.swing !== undefined && row.swing < -SWING_NOTABLE) {
      return 'bg-accent/20 text-accent-700';
    }
    if (row.margin >= LOCKED) return 'bg-success/20 text-success-700';
    return 'bg-success/10 text-success';
  }
  if (row.margin < 0) return 'bg-error/10 text-error';
  return 'border border-border bg-surface text-foreground';
}

/** Mobile detail block for the tapped chip — label, status, you/opp
 *  current → projected, and the concede/restore action. */
function ChipDetail({
  row,
  conceded,
  autoConceded,
  onToggleConcede,
}: {
  row: AnalyzedMatchupRow;
  conceded: boolean;
  autoConceded: boolean;
  onToggleConcede: (statId: number) => void;
}) {
  const showSwing =
    row.rawMyVal !== undefined && row.rawOppVal !== undefined &&
    (row.rawMyVal !== row.myVal || row.rawOppVal !== row.oppVal);

  const myTone = conceded
    ? 'text-muted-foreground font-bold'
    : row.margin > 0 ? 'text-success font-bold'
    : row.margin < 0 ? 'text-error font-bold'
    : 'text-foreground font-bold';

  const reason = conceded
    ? (autoConceded ? 'conceded · out of reach' : 'conceded')
    : getReason(row);

  return (
    <div className="mt-2 rounded-lg border border-border bg-surface px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-foreground tracking-wide">{row.label}</span>
        {reason && (
          <span className="flex-1 text-right text-caption italic text-muted-foreground mr-1 truncate">
            {reason}
          </span>
        )}
        <ConcedeToggle statId={row.statId} conceded={conceded} onToggle={onToggleConcede} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums">
        <span className="flex items-baseline gap-1.5">
          <span className="text-micro font-mono uppercase text-muted-foreground">you</span>
          <TileSegment
            rawVal={row.rawMyVal}
            val={row.myVal}
            name={row.name}
            showSwing={showSwing}
            size="my"
            tone={myTone}
          />
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-micro font-mono uppercase text-muted-foreground">opp</span>
          <TileSegment
            rawVal={row.rawOppVal}
            val={row.oppVal}
            name={row.name}
            showSwing={showSwing}
            size="opp"
            tone="text-muted-foreground"
          />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot pressure footer — batter-only; renders nothing when dailyBaselines empty
// ---------------------------------------------------------------------------

function SlotPressureRow({ dailyBaselines }: { dailyBaselines: DailyBaseline[] }) {
  if (dailyBaselines.length === 0) return null;

  const lightDays = dailyBaselines.filter(d => d.activeBatterCount < d.rosterStartersTotal);

  const weakest = dailyBaselines
    .map(d => d.weakestStarter ? { day: d, w: d.weakestStarter } : null)
    .filter((x): x is { day: DailyBaseline; w: NonNullable<DailyBaseline['weakestStarter']> } => x !== null && x.w.score < 50)
    .sort((a, b) => a.w.score - b.w.score)[0];

  if (lightDays.length === 0 && !weakest) return null;

  return (
    <div className="pt-1 mt-1 border-t border-border/60 flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
      {lightDays.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Icon icon={FiCalendar} size={11} />
          <span>
            Light days:{' '}
            {lightDays
              .map(d => `${d.dayLabel} (${d.activeBatterCount}/${d.rosterStartersTotal})`)
              .join(', ')}
          </span>
        </div>
      )}
      {weakest && (
        <span>
          Weakest starter:{' '}
          <span className="text-error font-medium">
            {weakest.w.name} ({weakest.w.position}, {Math.round(weakest.w.score)})
          </span>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryTile — pill-card with state-colored border, label, my/opp values, reason
// ---------------------------------------------------------------------------

function CategoryTile({
  row,
  conceded,
  autoConceded,
  onToggleConcede,
}: {
  row: AnalyzedMatchupRow;
  conceded: boolean;
  autoConceded: boolean;
  onToggleConcede: (statId: number) => void;
}) {
  const showSwing =
    row.rawMyVal !== undefined && row.rawOppVal !== undefined &&
    (row.rawMyVal !== row.myVal || row.rawOppVal !== row.oppVal);

  const borderTone = conceded
    ? 'border-dashed border-border bg-surface-muted/40 opacity-70'
    : row.margin > 0 ? 'border-success/30 bg-success/5'
    : row.margin < 0 ? 'border-error/30 bg-error/5'
    : 'border-border bg-background';

  const myTone = conceded
    ? 'text-muted-foreground font-bold'
    : row.margin > 0 ? 'text-success font-bold'
    : row.margin < 0 ? 'text-error font-bold'
    : 'text-foreground font-bold';

  const reason = conceded
    ? (autoConceded ? 'conceded · out of reach' : 'conceded')
    : getReason(row);

  return (
    <div
      className={`flex flex-col px-3 py-2 rounded-lg border ${borderTone} min-w-[8rem]`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-base font-bold text-foreground tracking-wide leading-none">{row.label}</span>
        <ConcedeToggle statId={row.statId} conceded={conceded} onToggle={onToggleConcede} />
      </div>
      <div className="flex items-baseline gap-2 tabular-nums leading-tight">
        <TileSegment
          rawVal={row.rawMyVal}
          val={row.myVal}
          name={row.name}
          showSwing={showSwing}
          size="my"
          tone={myTone}
        />
        <span aria-hidden="true" className="text-muted-foreground/40 select-none">|</span>
        <TileSegment
          rawVal={row.rawOppVal}
          val={row.oppVal}
          name={row.name}
          showSwing={showSwing}
          size="opp"
          tone="text-muted-foreground"
        />
      </div>
      {reason && (
        <span className="text-caption text-muted-foreground/80 italic mt-0.5 leading-tight">
          {reason}
        </span>
      )}
    </div>
  );
}

function TileSegment({
  rawVal,
  val,
  name,
  showSwing,
  size,
  tone,
}: {
  rawVal: string | undefined;
  val: string;
  name: string;
  showSwing: boolean;
  size: 'my' | 'opp';
  tone: string;
}) {
  const cls = size === 'my' ? 'text-sm' : 'text-xs';
  if (!showSwing || rawVal === undefined) {
    return <span className={`${cls} ${tone}`}>{formatStatValue(val, name)}</span>;
  }
  return (
    <span className={cls}>
      <span className="text-muted-foreground/50">{formatStatValue(rawVal, name)}</span>
      <span className="mx-1 text-muted-foreground/50">→</span>
      <span className={tone}>{formatStatValue(val, name)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reason text — derived from rawMargin / margin / swing
// ---------------------------------------------------------------------------

const LOCKED = 0.7;
const SWING_NOTABLE = 0.15;

function getReason(row: AnalyzedMatchupRow): string {
  // No comparable pair — em-dash row. There's no margin to reason about
  // (the engine produced margin=0 by default), and rendering "tossup"
  // would falsely imply a real even contest. Common cases: SV when
  // neither team has saves yet AND we don't project SV; K/9 / BB/9 / H/9
  // pre-projection. The user typically lands here to assign a manual
  // focus (commonly punt).
  if (!rowHasComparablePair(row)) return 'no signal yet';

  const m = row.margin;
  const raw = row.rawMargin;
  const swing = row.swing;

  if (m >= LOCKED) return 'locked win';
  if (m <= -LOCKED) return 'out of reach';

  if (raw === undefined || swing === undefined) {
    if (m > 0.3) return 'comfortable lead';
    if (m > 0) return 'narrow lead';
    if (m === 0) return 'tossup';
    if (m > -0.3) return 'narrow deficit';
    return 'steady deficit';
  }

  if (raw < 0 && m > 0) return 'projected to flip · roster handles it';
  if (raw > 0 && m < 0) return 'lead at risk · projection erodes it';

  if (m > 0) {
    if (m > 0.3) return 'comfortable lead';
    if (swing < -SWING_NOTABLE) return 'lead narrowing';
    return 'narrow lead';
  }

  if (m === 0) return 'tossup';

  if (swing > SWING_NOTABLE) return 'deficit closing';
  if (swing < -SWING_NOTABLE) return 'falling further behind';
  if (m > -0.3) return 'narrow deficit';
  return 'steady deficit';
}

// ---------------------------------------------------------------------------
// FocusResetButton — header reset affordance (moved here from the retired
// focusPanel.tsx chrome when the last chase/hold/punt surface converted)
// ---------------------------------------------------------------------------

function FocusResetButton({ onReset, hasOverrides }: { onReset: () => void; hasOverrides: boolean }) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={!hasOverrides}
      className="text-caption px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      title={hasOverrides ? 'Reset all concede/contest picks to MLBoss suggestions' : 'No overrides — already showing suggestions'}
    >
      Reset
    </button>
  );
}

// ---------------------------------------------------------------------------
// ConcedeToggle — single concede/contest button on each tile
// ---------------------------------------------------------------------------

function ConcedeToggle({
  statId,
  conceded,
  onToggle,
}: {
  statId: number;
  conceded: boolean;
  onToggle: (statId: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(statId)}
      title={conceded ? 'Contest — put this category back in play' : 'Concede this category'}
      aria-label={conceded ? `Contest stat ${statId}` : `Concede stat ${statId}`}
      className={`flex items-center justify-center w-5 h-5 rounded ring-1 ring-border-muted/60 transition-colors ${
        conceded
          ? 'text-muted-foreground/60 hover:text-success hover:ring-success/40'
          : 'text-muted-foreground/45 hover:text-error hover:ring-error/40'
      }`}
    >
      <Icon icon={conceded ? FiRotateCcw : FiSlash} size={11} />
    </button>
  );
}
