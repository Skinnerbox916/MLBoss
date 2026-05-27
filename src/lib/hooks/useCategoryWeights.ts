'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { pivotality } from '@/lib/rating/pivotality';
import type { MatchupAnalysis } from '@/lib/matchup/analysis';

/**
 * Pivotality weight + concession state for a matchup side. The successor to
 * `useSuggestedFocus` — see docs/pivotality-migration.md. Drops chase/hold/punt
 * entirely: every category is **in-play** by default, weighted by how contested
 * it is (`pivotality(margin)`), and the only lever is **concede / contest**.
 *
 * Concession model:
 *  - **Auto**: a decided LOSS (`margin ≤ −DECIDED_LOSS_THRESHOLD`) is conceded.
 *    A winning cat is never auto-conceded — a locked lead stays in-play
 *    (deweighted by the bell), it just isn't worth chasing.
 *  - **Override**: the user can `concede` any cat or `contest` (un-concede) an
 *    auto-conceded one. Overrides persist to localStorage when `persistKey` is
 *    given (roster page), else they're ephemeral (weekly matchup).
 *
 *   weight(cat) = conceded ? 0 : pivotality(margin)
 */

export const DECIDED_LOSS_THRESHOLD = 0.7;

type ConcedeState = 'concede' | 'contest';

function isConcedeState(v: unknown): v is ConcedeState {
  return v === 'concede' || v === 'contest';
}

function loadOverrides(persistKey: string | undefined): Record<number, ConcedeState> {
  if (!persistKey || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(persistKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<number, ConcedeState> = {};
    for (const [statId, value] of Object.entries(parsed)) {
      const id = Number(statId);
      if (Number.isFinite(id) && isConcedeState(value)) clean[id] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

function persistOverrides(persistKey: string | undefined, overrides: Record<number, ConcedeState>) {
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

export interface CategoryWeights {
  /** statId → composite weight (0 = conceded). Pass to the rating engines. */
  categoryWeights: Record<number, number>;
  /** Is this category currently conceded (auto or by the user)? */
  isConceded: (statId: number) => boolean;
  /** Was a decided loss conceded purely by the auto rule (no user action)?
   *  Drives the "auto" hint on the concede shelf. */
  isAutoConceded: (statId: number) => boolean;
  /** Toggle a category between conceded and contested (writes an override). */
  toggleConcede: (statId: number) => void;
  /** Clear all overrides — back to the auto rule. */
  reset: () => void;
  hasOverrides: boolean;
}

export function useCategoryWeights(
  analysis: MatchupAnalysis,
  predicate: (statId: number) => boolean,
  persistKey?: string,
): CategoryWeights {
  const [overrides, setOverrides] = useState<Record<number, ConcedeState>>(() => loadOverrides(persistKey));

  useEffect(() => {
    setOverrides(loadOverrides(persistKey));
  }, [persistKey]);

  useEffect(() => {
    persistOverrides(persistKey, overrides);
  }, [persistKey, overrides]);

  // Margin per stat for this side, plus the auto-conceded set (decided losses).
  const { marginByStatId, autoConceded } = useMemo(() => {
    const margins: Record<number, number> = {};
    const auto = new Set<number>();
    for (const row of analysis.rows) {
      if (!predicate(row.statId)) continue;
      margins[row.statId] = row.margin;
      if (row.margin <= -DECIDED_LOSS_THRESHOLD) auto.add(row.statId);
    }
    return { marginByStatId: margins, autoConceded: auto };
  }, [analysis, predicate]);

  const concededSet = useMemo(() => {
    const set = new Set<number>();
    for (const statId of Object.keys(marginByStatId).map(Number)) {
      const ov = overrides[statId];
      const conceded = ov === 'concede' ? true : ov === 'contest' ? false : autoConceded.has(statId);
      if (conceded) set.add(statId);
    }
    return set;
  }, [marginByStatId, autoConceded, overrides]);

  const categoryWeights = useMemo(() => {
    const weights: Record<number, number> = {};
    for (const [idStr, margin] of Object.entries(marginByStatId)) {
      const statId = Number(idStr);
      weights[statId] = concededSet.has(statId) ? 0 : pivotality(margin);
    }
    return weights;
  }, [marginByStatId, concededSet]);

  const isConceded = useCallback((statId: number) => concededSet.has(statId), [concededSet]);
  const isAutoConceded = useCallback(
    (statId: number) => overrides[statId] === undefined && autoConceded.has(statId),
    [overrides, autoConceded],
  );

  const toggleConcede = useCallback(
    (statId: number) => {
      setOverrides(prev => {
        const currentlyConceded =
          prev[statId] === 'concede' ? true
          : prev[statId] === 'contest' ? false
          : autoConceded.has(statId);
        return { ...prev, [statId]: currentlyConceded ? 'contest' : 'concede' };
      });
    },
    [autoConceded],
  );

  const reset = useCallback(() => setOverrides({}), []);

  return {
    categoryWeights,
    isConceded,
    isAutoConceded,
    toggleConcede,
    reset,
    hasOverrides: Object.keys(overrides).length > 0,
  };
}
