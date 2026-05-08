'use client';

import { useMemo } from 'react';
import { FiTarget, FiShield, FiSlash, FiCalendar } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import { formatStatValue } from '@/lib/formatStat';
import type {
  AnalyzedMatchupRow,
  MatchupAnalysis,
  SuggestedFocus,
} from '@/lib/matchup/analysis';
import type { DailyBaseline } from '@/lib/projection/slotAware';
import type { Focus } from '@/lib/mlb/batterRating';

/**
 * Streaming-page Game Plan: per-cat current → projected → reason, grouped
 * by suggested focus, with the user's chase/punt override pill inline on
 * each row.
 *
 * One component, two sides: pass `side: 'batting'` for the batter tab
 * (default) or `side: 'pitching'` for the pitcher tab. Filtering picks
 * the right cats off the analysis. Section grouping (Chase / Hold /
 * Punt) follows MLBoss's suggestion; the inline pill reflects the
 * user's effective override. An override dot on the pill keeps the
 * manual choice legible at a glance.
 *
 * The reset-to-suggested affordance is in the panel header (next to the
 * W/L projection badge) when overrides exist — the standalone
 * `CategoryFocusBar` is no longer used on the streaming page.
 */
interface GamePlanPanelProps {
  analysis: MatchupAnalysis;
  isCorrected: boolean;
  isLoading: boolean;
  /** 'batting' filters to is_batter_stat rows; 'pitching' to is_pitcher_stat. */
  side?: 'batting' | 'pitching';
  /** Week number from the scoreboard, e.g. 14. */
  week?: number;
  /** Opponent name, displayed in the action slot. */
  opponentName?: string;
  /** Number of pickup-playable days remaining. */
  actionableDays?: number;
  /** Sunday-pickup-for-next-week banner condition. */
  isPickingForNextWeek?: boolean;
  /** Per-day slot baselines from the slot-aware engine (batter side
   *  only). When empty, the footer renders nothing. */
  dailyBaselines?: DailyBaseline[];

  // ----- Inline focus pill props (replaces standalone CategoryFocusBar) -----

  /** User's effective focus per stat_id. Required when the panel is in
   *  control of focus pills. */
  focusMap: Record<number, Focus>;
  /** Toggle callback — should cycle neutral → chase → punt → neutral. */
  onToggle: (statId: number) => void;
  /** MLBoss's suggestion baseline. When provided, pills whose effective
   *  focus differs render an override dot. */
  suggestedFocusMap?: Record<number, Focus>;
  /** Reset-to-suggested affordance — only renders when `hasOverrides`. */
  onReset?: () => void;
  hasOverrides?: boolean;
}

export default function GamePlanPanel({
  analysis,
  isCorrected,
  isLoading,
  side = 'batting',
  week,
  opponentName,
  actionableDays,
  isPickingForNextWeek = false,
  dailyBaselines = [],
  focusMap,
  onToggle,
  suggestedFocusMap,
  onReset,
  hasOverrides = false,
}: GamePlanPanelProps) {
  const sideRows = useMemo(
    () => analysis.rows.filter(r =>
      (side === 'batting' ? r.isBatterStat : r.isPitcherStat) && r.hasData,
    ),
    [analysis.rows, side],
  );

  const grouped = useMemo(() => {
    const chase: AnalyzedMatchupRow[] = [];
    const hold: AnalyzedMatchupRow[] = [];
    const punt: AnalyzedMatchupRow[] = [];
    for (const row of sideRows) {
      if (row.suggestedFocus === 'chase') chase.push(row);
      else if (row.suggestedFocus === 'punt') punt.push(row);
      else hold.push(row);
    }
    chase.sort((a, b) => a.margin - b.margin);
    hold.sort((a, b) => a.margin - b.margin);
    punt.sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin));
    return { chase, hold, punt };
  }, [sideRows]);

  const projWins = sideRows.filter(r => r.margin > 0).length;
  const projLosses = sideRows.filter(r => r.margin < 0).length;

  const sideLabel = side === 'pitching' ? 'Pitching' : 'Batting';
  const title = week ? `${sideLabel} Game Plan — Week ${week}` : `${sideLabel} Game Plan`;

  const action = (
    <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
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
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          disabled={!hasOverrides}
          className="text-caption px-2 py-0.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={hasOverrides ? 'Reset all focus picks to MLBoss suggestions' : 'No overrides — already showing suggestions'}
        >
          Reset
        </button>
      )}
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

  // Helper text varies by side and projection state.
  const helper = (() => {
    if (!isCorrected) return 'YTD only — projection still loading. Reasons will sharpen as it resolves.';
    if (isPickingForNextWeek) {
      return 'Current matchup is closing out. The projection below describes this week — a pickup right now will land on next week\'s matchup, so treat the chase/hold split as a rough heading.';
    }
    if (side === 'pitching') {
      return 'Counting cats use projection · ratio cats (ERA, WHIP) stay YTD.';
    }
    return undefined;
  })();

  const isOverride = (statId: number): boolean => {
    if (!suggestedFocusMap) return false;
    const effective = focusMap[statId] ?? 'neutral';
    const suggested = suggestedFocusMap[statId] ?? 'neutral';
    return effective !== suggested;
  };

  return (
    <Panel title={title} action={action} helper={helper}>
      <div className="space-y-3">
        <Section
          label="Chase"
          tone="accent"
          icon={FiTarget}
          rows={grouped.chase}
          empty="No deficits to chase — your matchup is sitting comfortably."
          focusMap={focusMap}
          onToggle={onToggle}
          isOverride={isOverride}
        />
        <Section
          label="Hold"
          tone="success"
          icon={FiShield}
          rows={grouped.hold}
          empty="Nothing to defend — no leads to protect."
          focusMap={focusMap}
          onToggle={onToggle}
          isOverride={isOverride}
        />
        <Section
          label="Punt"
          tone="muted"
          icon={FiSlash}
          rows={grouped.punt}
          empty="No locked extremes — every cat is still in play."
          focusMap={focusMap}
          onToggle={onToggle}
          isOverride={isOverride}
        />
        <SlotPressureRow dailyBaselines={dailyBaselines} />
      </div>
    </Panel>
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
// Section — one focus group, with all its rows
// ---------------------------------------------------------------------------

interface SectionProps {
  label: string;
  tone: 'accent' | 'success' | 'muted';
  icon: typeof FiTarget;
  rows: AnalyzedMatchupRow[];
  empty: string;
  focusMap: Record<number, Focus>;
  onToggle: (statId: number) => void;
  isOverride: (statId: number) => boolean;
}

function Section({ label, tone, icon, rows, empty, focusMap, onToggle, isOverride }: SectionProps) {
  const labelTone =
    tone === 'accent' ? 'text-accent'
    : tone === 'success' ? 'text-success'
    : 'text-muted-foreground';

  if (rows.length === 0) {
    return (
      <div className="bg-surface-muted/30 rounded-md p-2.5">
        <SectionHeader label={label} count={0} icon={icon} tone={labelTone} />
        <p className="text-caption text-muted-foreground/60 mt-1.5">{empty}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-muted/30 rounded-md p-2.5">
      <SectionHeader label={label} count={rows.length} icon={icon} tone={labelTone} />
      <ul className="mt-2 space-y-1.5">
        {rows.map(row => (
          <Row
            key={row.statId}
            row={row}
            focus={focusMap[row.statId] ?? 'neutral'}
            onToggle={onToggle}
            isOverride={isOverride(row.statId)}
          />
        ))}
      </ul>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  icon,
  tone,
}: {
  label: string;
  count: number;
  icon: typeof FiTarget;
  tone: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${tone} text-caption font-semibold uppercase tracking-wide`}>
      <Icon icon={icon} size={11} />
      <span>{label}</span>
      <span className="text-muted-foreground/70">· {count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row — pill | cat | values | reason
// ---------------------------------------------------------------------------

function Row({
  row,
  focus,
  onToggle,
  isOverride,
}: {
  row: AnalyzedMatchupRow;
  focus: Focus;
  onToggle: (statId: number) => void;
  isOverride: boolean;
}) {
  const reason = getReason(row);
  const showSwing =
    row.rawMyVal !== undefined && row.rawOppVal !== undefined &&
    (row.rawMyVal !== row.myVal || row.rawOppVal !== row.oppVal);

  return (
    <li className="grid grid-cols-[auto_auto_1fr_auto] items-baseline gap-3 text-sm">
      <RowFocusPill statId={row.statId} focus={focus} onToggle={onToggle} isOverride={isOverride} />
      <span className="font-semibold text-foreground w-9">{row.label}</span>
      <span className="text-muted-foreground tabular-nums text-xs">
        {showSwing && row.rawMyVal !== undefined && row.rawOppVal !== undefined ? (
          <>
            <ValuePair myVal={row.rawMyVal} oppVal={row.rawOppVal} name={row.name} dim />
            <span className="mx-1.5 text-muted-foreground/60">→</span>
            <ValuePair myVal={row.myVal} oppVal={row.oppVal} name={row.name} winning={row.margin > 0} losing={row.margin < 0} />
          </>
        ) : (
          <ValuePair myVal={row.myVal} oppVal={row.oppVal} name={row.name} winning={row.margin > 0} losing={row.margin < 0} />
        )}
      </span>
      <span className="text-caption text-muted-foreground text-right">{reason}</span>
    </li>
  );
}

/**
 * Compact focus pill for the Game Plan row leftmost cell. Single-letter
 * label inside a small colored chip; click cycles neutral → chase →
 * punt → neutral. Override dot floats top-right when the user has
 * overridden MLBoss's suggestion.
 *
 * Distinct from `FocusPill` in `CategoryFocusBar.tsx` because the row
 * context is much more space-constrained — we want minimal width but
 * enough color to be readable at a glance.
 */
function RowFocusPill({
  statId,
  focus,
  onToggle,
  isOverride,
}: {
  statId: number;
  focus: Focus;
  onToggle: (statId: number) => void;
  isOverride: boolean;
}) {
  const styles: Record<Focus, { cls: string; label: string; title: string }> = {
    chase: { cls: 'bg-success/20 text-success ring-1 ring-success/40', label: 'C', title: 'Chase' },
    punt: { cls: 'bg-surface-muted text-muted-foreground/40 line-through', label: 'P', title: 'Punt' },
    neutral: { cls: 'bg-surface-muted text-foreground/70 hover:bg-surface-muted/80', label: '·', title: 'Hold (neutral)' },
  };
  const s = styles[focus];
  return (
    <button
      type="button"
      onClick={() => onToggle(statId)}
      className={`relative w-5 h-5 rounded-full text-caption font-bold cursor-pointer transition-all select-none flex items-center justify-center ${s.cls}`}
      title={isOverride ? `${s.title} (manual override — click to cycle)` : `${s.title} (click to cycle)`}
      aria-label={`Focus for stat ${statId}: ${s.title}`}
    >
      {s.label}
      {isOverride && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent ring-1 ring-background"
        />
      )}
    </button>
  );
}

function ValuePair({
  myVal,
  oppVal,
  name,
  dim = false,
  winning = false,
  losing = false,
}: {
  myVal: string;
  oppVal: string;
  name: string;
  dim?: boolean;
  winning?: boolean;
  losing?: boolean;
}) {
  const myTone = dim ? 'text-muted-foreground/60' : winning ? 'text-success' : losing ? 'text-error' : 'text-foreground';
  const oppTone = dim ? 'text-muted-foreground/40' : 'text-muted-foreground';
  return (
    <span className="tabular-nums">
      <span className={myTone}>{formatStatValue(myVal, name)}</span>
      <span className={`${oppTone} mx-0.5`}>/</span>
      <span className={oppTone}>{formatStatValue(oppVal, name)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reason text — derived from rawMargin / margin / swing
// ---------------------------------------------------------------------------

const LOCKED = 0.7;
const SWING_NOTABLE = 0.15;

function getReason(row: AnalyzedMatchupRow): string {
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

export type { SuggestedFocus };
