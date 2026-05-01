'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Focus } from '@/lib/mlb/batterRating';
import type { MatchupAnalysis } from '@/lib/matchup/analysis';
import { nextFocus } from '@/components/shared/CategoryFocusBar';

/**
 * Per-category focus state with a suggestion layer underneath.
 *
 * The matchup engine produces a `suggestedFocus` per category (chase the
 * close ones, punt the locked ones). We expose those suggestions as the
 * default and keep a separate `overrides` map so the user's clicks survive
 * data refreshes without us having to clobber them on every revalidate.
 *
 * `effective = suggested + overrides` — toggle writes into overrides only,
 * reset clears overrides, and `hasOverrides` drives the reset affordance.
 *
 * Filter the analysis rows on the consumer side (e.g. `is_batter_stat` for
 * the lineup page) before passing them in so suggestions are scoped to the
 * categories the consumer cares about.
 */
export function useSuggestedFocus(analysis: MatchupAnalysis, predicate: (statId: number) => boolean) {
  const [overrides, setOverrides] = useState<Record<number, Focus>>({});

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

  const reset = useCallback(() => setOverrides({}), []);

  return {
    /** Effective `suggested + overrides` map for `CategoryFocusBar` and the rating engines. */
    focusMap,
    /** Suggestion-only map. Useful for diffing against `focusMap` to spot user overrides. */
    suggestedFocusMap: suggested,
    toggle,
    reset,
    hasOverrides: Object.keys(overrides).length > 0,
  };
}
