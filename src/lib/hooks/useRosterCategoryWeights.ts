'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ForecastEntry } from '@/lib/league/forecast';
import {
  computeCategoryLeverage,
  type ConcedeState,
  type RosterLeverage,
} from '@/lib/league/rosterValue';

/**
 * L6 mirror of `useCategoryWeights` (the L5 matchup hook): per-category
 * leverage from the league forecast, with a concede/contest override
 * store in localStorage. Weight = conceded ? 0 : pivotality(distance) —
 * distance is the roster layer's own (RUPM moves for batters, z for
 * pitchers pending pitcher RUPM). See src/lib/league/rosterValue.ts and
 * docs/pivotality-migration.md#roster-side-l6.
 *
 * Deliberately a NEW persistence key shape (`mlboss-roster-concede:*`).
 * The old 3-state chase/hold/punt overrides (`mlboss-roster-focus:*`)
 * are orphaned, which doubles as a one-time reset — stale chase/punt
 * flips from the retired system (the SB/K incident that triggered this
 * rebuild) don't leak into the leverage era.
 */
export function rosterConcedePersistKey(leagueKey: string | undefined): string | undefined {
  return leagueKey ? `mlboss-roster-concede:${leagueKey}` : undefined;
}

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

export interface RosterCategoryWeights {
  /** Full leverage detail per stat (distance, weight, status). */
  leverage: RosterLeverage;
  /** statId → weight (0 = conceded) — the value engine's input. */
  categoryWeights: Record<number, number>;
  isConceded: (statId: number) => boolean;
  isAutoConceded: (statId: number) => boolean;
  toggleConcede: (statId: number) => void;
  reset: () => void;
  hasOverrides: boolean;
}

export function useRosterCategoryWeights(
  entries: ForecastEntry[],
  opts: { useZDistance?: boolean; persistKey?: string },
): RosterCategoryWeights {
  const { useZDistance, persistKey } = opts;
  const [overrides, setOverrides] = useState<Record<number, ConcedeState>>(() =>
    loadOverrides(persistKey),
  );

  useEffect(() => {
    setOverrides(loadOverrides(persistKey));
  }, [persistKey]);

  useEffect(() => {
    persistOverrides(persistKey, overrides);
  }, [persistKey, overrides]);

  const leverage = useMemo(
    () => computeCategoryLeverage(entries, overrides, { useZDistance }),
    [entries, overrides, useZDistance],
  );

  const categoryWeights = useMemo(() => {
    const weights: Record<number, number> = {};
    for (const [statId, lev] of leverage.byStatId) weights[statId] = lev.weight;
    return weights;
  }, [leverage]);

  const isConceded = useCallback(
    (statId: number) => leverage.byStatId.get(statId)?.status === 'conceded',
    [leverage],
  );
  const isAutoConceded = useCallback(
    (statId: number) => Boolean(leverage.byStatId.get(statId)?.autoConceded),
    [leverage],
  );

  const toggleConcede = useCallback(
    (statId: number) => {
      setOverrides(prev => {
        const lev = leverage.byStatId.get(statId);
        const currentlyConceded =
          prev[statId] === 'concede' ? true
          : prev[statId] === 'contest' ? false
          : Boolean(lev?.autoConceded);
        return { ...prev, [statId]: currentlyConceded ? 'contest' : 'concede' };
      });
    },
    [leverage],
  );

  const reset = useCallback(() => setOverrides({}), []);

  return {
    leverage,
    categoryWeights,
    isConceded,
    isAutoConceded,
    toggleConcede,
    reset,
    hasOverrides: Object.keys(overrides).length > 0,
  };
}
