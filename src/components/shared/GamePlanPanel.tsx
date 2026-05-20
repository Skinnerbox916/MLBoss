'use client';

import { useMemo } from 'react';
import { FiCalendar } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import { formatStatValue } from '@/lib/formatStat';
import type {
  AnalyzedMatchupRow,
  MatchupAnalysis,
  SuggestedFocus,
} from '@/lib/matchup/analysis';
import { rowHasComparablePair } from '@/components/shared/matchupRows';
import type { DailyBaseline } from '@/lib/projection/slotAware';
import type { Focus } from '@/lib/rating/focus';
import type { WeekTarget } from '@/lib/dashboard/weekRange';
import {
  FocusSectionTrio,
  FocusSegmentedControl,
  FocusResetButton,
  deriveFocusSection,
  isFocusOverride,
} from '@/components/shared/focusPanel';

/**
 * Game Plan: per-cat tiles grouped by chase/hold/punt for **this week's
 * matchup**. Each tile reads at a glance via state-colored border
 * (winning / losing / tied), shows current → projected swing when
 * available, and carries a chase/hold/punt segmented control in its
 * top-right so the user can override MLBoss's suggestion without leaving
 * the panel. The reset-to-suggested affordance lives in the panel header.
 *
 * One component, two pages, two sides:
 *  - `side: 'batting'` filters to is_batter_stat rows
 *  - `side: 'pitching'` filters to is_pitcher_stat rows
 *
 * The tile-grid layout sits at the top of both the Today/Lineup page
 * (daily start/sit) and the Streaming page (rest-of-week pickups). The
 * visual idiom is identical across pages so users learn it once.
 *
 * **Chrome (sections, segmented control, reset button) is shared** with
 * `RosterFocusPanel` via `@/components/shared/focusPanel`. Section
 * placement uses the always-jump rule defined there: rows place by
 * `focusMap[statId]` (user's effective focus). Clicking the punt segment
 * on a tile moves the tile to PUNT immediately. The override dot still
 * surfaces "engine disagreed" for transparency, but layout reflects the
 * user's decision.
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
   *  matchup). `'next'` adds a header chip and is set by the Sunday
   *  streaming pivot. */
  targetWeek?: WeekTarget;
  /** Per-day slot baselines from the slot-aware engine (batter side
   *  only). When empty, the footer renders nothing. */
  dailyBaselines?: DailyBaseline[];

  /** User's effective focus per stat_id. */
  focusMap: Record<number, Focus>;
  /** Direct-select callback — set the stat's focus to a specific value. */
  onSetFocus: (statId: number, focus: Focus) => void;
  /** MLBoss's suggestion baseline. When provided, controls whose effective
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
  opponentName,
  actionableDays,
  targetWeek = 'current',
  dailyBaselines = [],
  focusMap,
  onSetFocus,
  suggestedFocusMap,
  onReset,
  hasOverrides = false,
}: GamePlanPanelProps) {
  const sideRows = useMemo(
    () => analysis.rows.filter(r => side === 'batting' ? r.isBatterStat : r.isPitcherStat),
    [analysis.rows, side],
  );

  const grouped = useMemo(() => {
    const chase: AnalyzedMatchupRow[] = [];
    const hold: AnalyzedMatchupRow[] = [];
    const punt: AnalyzedMatchupRow[] = [];
    for (const row of sideRows) {
      const section = deriveFocusSection(focusMap, row.statId);
      if (section === 'chase') chase.push(row);
      else if (section === 'punt') punt.push(row);
      else hold.push(row);
    }
    chase.sort((a, b) => a.margin - b.margin);
    hold.sort((a, b) => a.margin - b.margin);
    punt.sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin));
    return { chase, hold, punt };
  }, [sideRows, focusMap]);

  const projWins = sideRows.filter(r => r.margin > 0).length;
  const projLosses = sideRows.filter(r => r.margin < 0).length;

  const sideLabel = side === 'pitching' ? 'Pitching' : 'Batting';
  const title = `${sideLabel} Game Plan`;

  const action = (
    <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
      {targetWeek === 'next' && (
        <Badge color="accent">Next week</Badge>
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
        <FocusSectionTrio
          groups={grouped}
          emptyStates={{
            chase: 'No deficits to chase — your matchup is sitting comfortably.',
            hold: 'Nothing to defend — no leads to protect.',
            punt: 'No locked extremes — every cat is still in play.',
          }}
          renderTile={row => (
            <CategoryTile
              key={row.statId}
              row={row}
              focus={focusMap[row.statId] ?? 'neutral'}
              onSet={onSetFocus}
              isOverride={isFocusOverride(focusMap, suggestedFocusMap, row.statId)}
            />
          )}
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
// CategoryTile — pill-card with state-colored border, label, my/opp values, reason
// ---------------------------------------------------------------------------

function CategoryTile({
  row,
  focus,
  onSet,
  isOverride,
}: {
  row: AnalyzedMatchupRow;
  focus: Focus;
  onSet: (statId: number, focus: Focus) => void;
  isOverride: boolean;
}) {
  const showSwing =
    row.rawMyVal !== undefined && row.rawOppVal !== undefined &&
    (row.rawMyVal !== row.myVal || row.rawOppVal !== row.oppVal);

  const borderTone =
    row.margin > 0 ? 'border-success/30 bg-success/5'
    : row.margin < 0 ? 'border-error/30 bg-error/5'
    : 'border-border bg-background';

  const myTone =
    row.margin > 0 ? 'text-success font-bold'
    : row.margin < 0 ? 'text-error font-bold'
    : 'text-foreground font-bold';

  const reason = getReason(row);

  return (
    <div
      className={`flex flex-col px-3 py-2 rounded-lg border ${borderTone} min-w-[8rem]`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-base font-bold text-foreground tracking-wide leading-none">{row.label}</span>
        <FocusSegmentedControl
          statId={row.statId}
          focus={focus}
          onSet={onSet}
          isOverride={isOverride}
        />
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

export type { SuggestedFocus };
