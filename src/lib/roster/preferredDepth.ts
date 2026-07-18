/**
 * Preferred-depth persistence — the user's per-position target-depth
 * overrides for the roster pages' depth charts and swap engines. Shared
 * by the categories and points roster pages (each under its own pref key
 * so the two league modes don't cross-pollinate). Stored server-side per
 * user via `useSyncedPref` (see src/lib/hooks/usePreferredDepth.ts).
 */

import { BATTER_POSITIONS, type BatterPosition } from './depth';

export type PreferredDepthMap = Partial<Record<BatterPosition, number>>;

/** Categories roster page key (pre-existing — kept for continuity). */
export const CATEGORIES_PREFERRED_DEPTH_KEY = 'roster.preferredDepth';
/** Points roster page key. */
export const POINTS_PREFERRED_DEPTH_KEY = 'roster.preferredDepth.points';

/** Validate arbitrary JSON into a PreferredDepthMap (bad shapes → {}). */
export function cleanPreferredDepth(raw: unknown): PreferredDepthMap {
  if (!raw || typeof raw !== 'object') return {};
  const parsed = raw as PreferredDepthMap;
  const clean: PreferredDepthMap = {};
  for (const pos of BATTER_POSITIONS) {
    const v = parsed[pos];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      clean[pos] = Math.floor(v);
    }
  }
  return clean;
}
