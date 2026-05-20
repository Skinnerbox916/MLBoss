'use client';

/**
 * Shared building blocks for chase/hold/punt focus panels — used by the
 * Game Plan (Lineup / Streaming) and the Roster Focus (Roster page).
 *
 * Both pages display the same idiom — three sections (Chase / Hold / Punt),
 * a per-tile chase/hold/punt segmented control with an override dot, a
 * Reset button in the panel header — but the *content* of each tile and
 * the *suggestion source* differ:
 *
 *  - **Game Plan** (this-week matchup): per-cat matchup margin tiles,
 *    suggestion from `analyzeMatchup`.
 *  - **Roster Focus** (forward-looking): per-cat league-rank tiles,
 *    suggestion from the `forwardFocus` planner (v1 or v2).
 *
 * What's shared lives here. What differs (tile body, header chrome,
 * data-to-rows adapter) lives in the per-page wrapper.
 *
 * ## Section placement: always-jump
 *
 * Rows place by `focusMap[statId]` — the user's *effective* focus
 * (suggestion + override). When the user toggles a tile to PUNT, the
 * tile moves to the PUNT section immediately. The override dot on the
 * segmented control still surfaces "engine disagreed" for transparency,
 * but the layout reflects the user's decision.
 *
 * Previously the rule was hybrid — signal-bearing rows stayed where the
 * engine put them, no-signal rows placed by user focus — which preserved
 * a stable "MLBoss thinks X" reading anchor at the cost of leaving the
 * user's override visually disconnected from the row they clicked on.
 * The always-jump rule trades that reading anchor for direct UX (what
 * you click is where it goes), matching the project memory note about
 * leaning into the algorithm and minimising diagnostic UI.
 */

import { FiTarget, FiShield, FiSlash } from 'react-icons/fi';
import Icon from '@/components/Icon';
import type { Focus } from '@/lib/mlb/batterRating';
import type { SuggestedFocus } from '@/lib/matchup/analysis';

/**
 * Determine which section a row belongs in. Always-jump rule: the user's
 * effective focus drives placement. When the user hasn't overridden, the
 * effective focus equals the engine's suggestion (because `focusMap` is
 * `{ ...suggested, ...overrides }` in `useSuggestedFocus`), so the row
 * still appears in the engine-suggested section by default.
 */
export function deriveFocusSection(
  focusMap: Record<number, Focus>,
  statId: number,
): SuggestedFocus {
  return focusMap[statId] ?? 'neutral';
}

/**
 * Is the user's effective focus different from the engine's suggestion?
 * Drives the small accent dot on the segmented control. Returns false
 * when no suggestion baseline is available (pre-suggestion render).
 */
export function isFocusOverride(
  focusMap: Record<number, Focus>,
  suggestedFocusMap: Record<number, Focus> | undefined,
  statId: number,
): boolean {
  if (!suggestedFocusMap) return false;
  const effective = focusMap[statId] ?? 'neutral';
  const suggested = suggestedFocusMap[statId] ?? 'neutral';
  return effective !== suggested;
}

// ---------------------------------------------------------------------------
// Section — one focus group's chrome (header + flex-wrap container + empty)
// ---------------------------------------------------------------------------

export type FocusSectionTone = 'accent' | 'success' | 'muted';

export interface FocusSectionProps {
  label: string;
  tone: FocusSectionTone;
  /** Header icon. `FiTarget` for Chase, `FiShield` for Hold, `FiSlash` for Punt. */
  icon: typeof FiTarget;
  count: number;
  /** Helper text rendered when `count === 0`. */
  empty: string;
  children?: React.ReactNode;
}

export function FocusSection({ label, tone, icon, count, empty, children }: FocusSectionProps) {
  const labelTone =
    tone === 'accent' ? 'text-accent'
    : tone === 'success' ? 'text-success'
    : 'text-muted-foreground';

  if (count === 0) {
    return (
      <div className="bg-surface-muted/30 rounded-md p-2.5">
        <SectionHeader label={label} count={0} icon={icon} tone={labelTone} />
        <p className="text-caption text-muted-foreground/60 mt-1.5">{empty}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-muted/30 rounded-md p-2.5">
      <SectionHeader label={label} count={count} icon={icon} tone={labelTone} />
      <div className="mt-2 flex flex-wrap gap-2">
        {children}
      </div>
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
// Section trio — convenience helper for the standard Chase/Hold/Punt layout
// ---------------------------------------------------------------------------

export interface FocusSectionTrioProps<T> {
  groups: { chase: T[]; hold: T[]; punt: T[] };
  emptyStates?: { chase?: string; hold?: string; punt?: string };
  renderTile: (item: T) => React.ReactNode;
}

const DEFAULT_EMPTY: Required<NonNullable<FocusSectionTrioProps<unknown>['emptyStates']>> = {
  chase: 'Nothing to chase right now.',
  hold: 'Nothing to defend.',
  punt: 'No locked extremes — every cat is still in play.',
};

export function FocusSectionTrio<T>({
  groups,
  emptyStates,
  renderTile,
}: FocusSectionTrioProps<T>) {
  const empties = { ...DEFAULT_EMPTY, ...(emptyStates ?? {}) };
  return (
    <>
      <FocusSection label="Chase" tone="accent" icon={FiTarget} count={groups.chase.length} empty={empties.chase}>
        {groups.chase.map(renderTile)}
      </FocusSection>
      <FocusSection label="Hold" tone="success" icon={FiShield} count={groups.hold.length} empty={empties.hold}>
        {groups.hold.map(renderTile)}
      </FocusSection>
      <FocusSection label="Punt" tone="muted" icon={FiSlash} count={groups.punt.length} empty={empties.punt}>
        {groups.punt.map(renderTile)}
      </FocusSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// FocusSegmentedControl — three-button chase/hold/punt picker
// ---------------------------------------------------------------------------

export interface FocusSegmentedControlProps {
  statId: number;
  focus: Focus;
  onSet: (statId: number, focus: Focus) => void;
  /** Renders an accent dot when the user's effective focus differs from
   *  the engine's suggestion. */
  isOverride: boolean;
}

/**
 * Direct selection — click the icon for the state you want — replaces
 * the older single-letter cycle button which required users to remember
 * the cycle order. Icons mirror the section headers (Target / Shield /
 * Slash) so each tile's control reads as "this is the bucket this cat
 * would land in."
 */
export function FocusSegmentedControl({
  statId,
  focus,
  onSet,
  isOverride,
}: FocusSegmentedControlProps) {
  return (
    <div
      className="relative inline-flex items-center gap-px rounded-md bg-surface ring-1 ring-border-muted/60 p-0.5"
      role="radiogroup"
      aria-label={`Focus for stat ${statId}`}
    >
      <SegmentButton
        statId={statId}
        active={focus === 'chase'}
        onClick={() => onSet(statId, 'chase')}
        icon={FiTarget}
        title="Chase"
        activeCls="bg-success/20 text-success"
      />
      <SegmentButton
        statId={statId}
        active={focus === 'neutral'}
        onClick={() => onSet(statId, 'neutral')}
        icon={FiShield}
        title="Hold"
        activeCls="bg-surface-muted text-foreground"
      />
      <SegmentButton
        statId={statId}
        active={focus === 'punt'}
        onClick={() => onSet(statId, 'punt')}
        icon={FiSlash}
        title="Punt"
        activeCls="bg-error/15 text-error"
      />
      {isOverride && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent ring-1 ring-background"
        />
      )}
    </div>
  );
}

function SegmentButton({
  statId,
  active,
  onClick,
  icon,
  title,
  activeCls,
}: {
  statId: number;
  active: boolean;
  onClick: () => void;
  icon: typeof FiTarget;
  title: string;
  activeCls: string;
}) {
  const cls = active
    ? activeCls
    : 'text-muted-foreground/45 hover:text-muted-foreground hover:bg-surface-muted/60';
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      aria-label={`${title} ${statId}`}
      title={title}
      className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${cls}`}
    >
      <Icon icon={icon} size={11} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// FocusResetButton — reset-to-suggested affordance for the action slot
// ---------------------------------------------------------------------------

export interface FocusResetButtonProps {
  onReset: () => void;
  hasOverrides: boolean;
}

export function FocusResetButton({ onReset, hasOverrides }: FocusResetButtonProps) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={!hasOverrides}
      className="text-caption px-2 py-0.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      title={hasOverrides ? 'Reset all focus picks to MLBoss suggestions' : 'No overrides — already showing suggestions'}
    >
      Reset
    </button>
  );
}
