'use client';

import { useCallback, useMemo } from 'react';
import { useSyncedPref } from './useSyncedPref';
import type { ForecastEntry } from '@/lib/league/forecast';
import {
  computeCategoryLeverage,
  type ConcedeState,
  type RosterLeverage,
} from '@/lib/league/rosterValue';

/**
 * L6 mirror of `useCategoryWeights` (the L5 matchup hook): per-category
 * leverage from the league forecast, with a concede/contest override
 * store synced server-side per user (`useSyncedPref`).
 * Weight = conceded ? 0 : pivotality(distance) —
 * distance is the roster layer's own, side-aware per entry (RUPM moves
 * where priced, z otherwise). Pass BOTH sides' entries in ONE call: the
 * chase-coalition auto-concede reasons over the whole matchup's scored
 * cats. See src/lib/league/rosterValue.ts and
 * docs/pivotality-migration.md#roster-side-l6.
 *
 * Deliberately a NEW persistence key shape (`mlboss-roster-concede:v2:*`).
 * The old 3-state chase/hold/punt overrides (`mlboss-roster-focus:*`)
 * and the v1 per-side concede keys (`mlboss-roster-concede:<league>:bat|pit`)
 * are orphaned, which doubles as a one-time reset — stale flips from
 * the retired systems (the SB/K incident; the SV 'contest' pinned during
 * the all-zeros-SV era) don't leak into the coalition era.
 */
export function rosterConcedePersistKey(leagueKey: string | undefined): string | undefined {
  return leagueKey ? `mlboss-roster-concede:v2:${leagueKey}` : undefined;
}

function isConcedeState(v: unknown): v is ConcedeState {
  return v === 'concede' || v === 'contest';
}

function cleanOverrides(raw: unknown): Record<number, ConcedeState> {
  if (!raw || typeof raw !== 'object') return {};
  const clean: Record<number, ConcedeState> = {};
  for (const [statId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(statId);
    if (Number.isFinite(id) && isConcedeState(value)) clean[id] = value;
  }
  return clean;
}

const noOverrides = (v: Record<number, ConcedeState>) => Object.keys(v).length === 0;

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
  opts: { persistKey?: string },
): RosterCategoryWeights {
  const { persistKey } = opts;
  const [overrides, setOverrides] = useSyncedPref<Record<number, ConcedeState>>(
    persistKey,
    cleanOverrides,
    noOverrides,
  );

  const leverage = useMemo(
    () => computeCategoryLeverage(entries, overrides),
    [entries, overrides],
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
    [leverage, setOverrides],
  );

  const reset = useCallback(() => setOverrides({}), [setOverrides]);

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
