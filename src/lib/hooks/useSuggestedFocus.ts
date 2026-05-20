'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Focus } from '@/lib/mlb/batterRating';
import type { MatchupAnalysis } from '@/lib/matchup/analysis';

function isFocus(v: unknown): v is Focus {
  return v === 'chase' || v === 'punt' || v === 'neutral';
}

/**
 * Cycle through the three focus states on each call:
 *   neutral → chase → punt → neutral
 * Used by the `toggle` callback below; surfaces of `useSuggestedFocus`
 * that want cycle-style interaction (vs. direct-select via `set`).
 */
function nextFocus(current: Focus): Focus {
  if (current === 'neutral') return 'chase';
  if (current === 'chase') return 'punt';
  return 'neutral';
}

function loadOverrides(persistKey: string | undefined): Record<number, Focus> {
  if (!persistKey || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(persistKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<number, Focus> = {};
    for (const [statId, value] of Object.entries(parsed)) {
      const id = Number(statId);
      if (Number.isFinite(id) && isFocus(value)) clean[id] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

function persistOverrides(persistKey: string | undefined, overrides: Record<number, Focus>) {
  if (!persistKey || typeof window === 'undefined') return;
  try {
    if (Object.keys(overrides).length === 0) {
      window.localStorage.removeItem(persistKey);
    } else {
      window.localStorage.setItem(persistKey, JSON.stringify(overrides));
    }
  } catch {
    // ignore quota / serialization errors — overrides just won't persist
  }
}

/**
 * Per-category focus state with a suggestion layer underneath.
 *
 * The matchup engine (or any other suggestion source) produces a
 * `suggestedFocus` per category. We expose those suggestions as the
 * default and keep a separate `overrides` map so the user's clicks
 * survive data refreshes without us having to clobber them on every
 * revalidate.
 *
 * `effective = suggested + overrides` — toggle writes into overrides only,
 * reset clears overrides, and `hasOverrides` drives the reset affordance.
 *
 * When `persistKey` is provided, overrides are hydrated from `localStorage`
 * on mount and re-persisted after every change. Use this for surfaces
 * (like the roster page) where the user's strategic picks should survive
 * a page refresh; omit it for ephemeral surfaces (like a weekly matchup
 * where suggestions update naturally).
 */
export function useSuggestedFocus(
  analysis: MatchupAnalysis,
  predicate: (statId: number) => boolean,
  persistKey?: string,
) {
  const [overrides, setOverrides] = useState<Record<number, Focus>>(() => loadOverrides(persistKey));

  // Re-hydrate when the persistence key changes (e.g. user switches league).
  useEffect(() => {
    setOverrides(loadOverrides(persistKey));
  }, [persistKey]);

  // Persist after every override change.
  useEffect(() => {
    persistOverrides(persistKey, overrides);
  }, [persistKey, overrides]);

  const suggested = useMemo(() => {
    const map: Record<number, Focus> = {};
    for (const row of analysis.rows) {
      if (!predicate(row.statId)) continue;
      map[row.statId] = row.suggestedFocus;
    }
    return map;
  }, [analysis, predicate]);

  const focusMap = useMemo<Record<number, Focus>>(
    () => ({ ...suggested, ...overrides }),
    [suggested, overrides],
  );

  const toggle = useCallback(
    (statId: number) => {
      setOverrides(prev => {
        const current = prev[statId] ?? suggested[statId] ?? 'neutral';
        return { ...prev, [statId]: nextFocus(current) };
      });
    },
    [suggested],
  );

  const set = useCallback(
    (statId: number, focus: Focus) => {
      setOverrides(prev => ({ ...prev, [statId]: focus }));
    },
    [],
  );

  const reset = useCallback(() => setOverrides({}), []);

  return {
    /** Effective `suggested + overrides` map consumed by the focus
     *  panels (`GamePlanPanel`, `RosterFocusPanel`) and the rating engines. */
    focusMap,
    /** Suggestion-only map. Useful for diffing against `focusMap` to spot user overrides. */
    suggestedFocusMap: suggested,
    /** Cycle through neutral → chase → punt → neutral. Retained for
     *  callers that want cycle-style interaction; the panel segmented
     *  controls use `set` for direct selection instead. */
    toggle,
    /** Direct selection — set this stat to a specific focus. Used by the
     *  `GamePlanPanel` segmented control. */
    set,
    reset,
    hasOverrides: Object.keys(overrides).length > 0,
  };
}
