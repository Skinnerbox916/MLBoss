'use client';

/**
 * Category focus bar — shared between the roster page and the lineup
 * page. Lets the user mark each scored category as `chase` (prioritise),
 * `punt` (ignore), or `neutral` (default). The state itself is owned by
 * the parent so each page can decide whether the selection is shared or
 * local; this component is purely presentational.
 */

import Panel from '@/components/ui/Panel';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';

export type { Focus };
/** Back-compat alias. Older call sites use `FocusState`; new ones use `Focus`. */
export type FocusState = Focus;

/**
 * Cycle through the three focus states on each click.
 *   neutral → chase → punt → neutral ...
 */
export function nextFocus(current: Focus): Focus {
  if (current === 'neutral') return 'chase';
  if (current === 'chase') return 'punt';
  return 'neutral';
}

export function FocusPill({
  label,
  state,
  onClick,
  isOverride = false,
}: {
  label: string;
  state: Focus;
  onClick: () => void;
  /** True when the user has overridden a suggestion for this pill. Renders
   *  a small dot to make the manual choice legible at a glance. */
  isOverride?: boolean;
}) {
  const base = 'relative px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-all select-none';
  const styles: Record<Focus, string> = {
    chase: 'bg-success/20 text-success ring-1 ring-success/40',
    punt: 'bg-surface-muted text-muted-foreground/40 line-through',
    neutral: 'bg-surface-muted text-foreground hover:bg-surface-muted/80',
  };
  return (
    <button
      className={`${base} ${styles[state]}`}
      onClick={onClick}
      title={isOverride ? `${label} (manual override)` : label}
    >
      {label}
      {isOverride && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent ring-1 ring-background"
        />
      )}
    </button>
  );
}

interface CategoryFocusBarProps {
  categories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, Focus>;
  onToggle: (statId: number) => void;
  /** When true, render only batter-side categories. Default: render
   *  both batting + pitching groups (matches the roster page layout). */
  batterOnly?: boolean;
  /** Optional heading override (defaults to "Category Focus"). */
  title?: string;
  /** Optional helper text to show on the right side of the header. */
  helper?: string;
  /**
   * When provided, displays a "Reset to suggested" affordance in the header.
   * Only enabled when `hasOverrides` is true.
   */
  onReset?: () => void;
  hasOverrides?: boolean;
  /**
   * Suggestion-only baseline. When provided, pills whose effective focus
   * differs from the suggestion render a small override dot.
   */
  suggestedFocusMap?: Record<number, Focus>;
}

export default function CategoryFocusBar({
  categories,
  focusMap,
  onToggle,
  batterOnly = false,
  title = 'Category Focus',
  helper = 'Click: chase (green) / punt (dim) / neutral',
  onReset,
  hasOverrides = false,
  suggestedFocusMap,
}: CategoryFocusBarProps) {
  const batting = categories.filter(c => c.is_batter_stat);
  const pitching = batterOnly ? [] : categories.filter(c => c.is_pitcher_stat);

  if (batting.length === 0 && pitching.length === 0) return null;

  const isOverride = (statId: number): boolean => {
    if (!suggestedFocusMap) return false;
    const effective = focusMap[statId] ?? 'neutral';
    const suggested = suggestedFocusMap[statId] ?? 'neutral';
    return effective !== suggested;
  };

  return (
    <Panel
      title={title}
      action={
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">{helper}</span>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={!hasOverrides}
              className="text-caption px-2 py-0.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={hasOverrides ? 'Reset all focus picks to MLBoss suggestions' : 'No overrides — already showing suggestions'}
            >
              Reset to suggested
            </button>
          )}
        </div>
      }
    >
      {batting.length > 0 && (
        <div className={pitching.length > 0 ? 'mb-2' : undefined}>
          {!batterOnly && (
            <span className="text-caption text-muted-foreground uppercase tracking-wider">
              Batting
            </span>
          )}
          <div className={`flex flex-wrap gap-1.5 ${batterOnly ? '' : 'mt-1'}`}>
            {batting.map(cat => (
              <FocusPill
                key={cat.stat_id}
                label={cat.display_name}
                state={focusMap[cat.stat_id] ?? 'neutral'}
                onClick={() => onToggle(cat.stat_id)}
                isOverride={isOverride(cat.stat_id)}
              />
            ))}
          </div>
        </div>
      )}
      {pitching.length > 0 && (
        <div>
          <span className="text-caption text-muted-foreground uppercase tracking-wider">
            Pitching
          </span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {pitching.map(cat => (
              <FocusPill
                key={cat.stat_id}
                label={cat.display_name}
                state={focusMap[cat.stat_id] ?? 'neutral'}
                onClick={() => onToggle(cat.stat_id)}
                isOverride={isOverride(cat.stat_id)}
              />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
