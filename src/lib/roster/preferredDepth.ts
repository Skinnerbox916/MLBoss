/**
 * Preferred-depth persistence — the user's per-position target-depth
 * overrides for the roster pages' depth charts and swap engines. Shared
 * by the categories and points roster pages (each under its own
 * localStorage key so the two league modes don't cross-pollinate).
 */

import { BATTER_POSITIONS, type BatterPosition } from './depth';

export type PreferredDepthMap = Partial<Record<BatterPosition, number>>;

/** Categories roster page key (pre-existing — kept for continuity). */
export const CATEGORIES_PREFERRED_DEPTH_KEY = 'roster.preferredDepth';
/** Points roster page key. */
export const POINTS_PREFERRED_DEPTH_KEY = 'roster.preferredDepth.points';

export function loadPreferredDepth(storageKey: string): PreferredDepthMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PreferredDepthMap;
    const clean: PreferredDepthMap = {};
    for (const pos of BATTER_POSITIONS) {
      const v = parsed[pos];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        clean[pos] = Math.floor(v);
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function savePreferredDepth(storageKey: string, value: PreferredDepthMap): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore quota/serialization errors — preference just won't persist
  }
}

/**
 * Compact wire encoding for the points API (`depth=C:1|OF:5`). Sorted so
 * the same map always serializes identically — it rides in a cache key.
 */
export function encodePreferredDepth(value: PreferredDepthMap): string {
  return Object.entries(value)
    .filter(([, v]) => typeof v === 'number')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pos, v]) => `${pos}:${v}`)
    .join('|');
}

export function decodePreferredDepth(encoded: string | null | undefined): PreferredDepthMap {
  if (!encoded) return {};
  const out: PreferredDepthMap = {};
  for (const part of encoded.split('|')) {
    const [pos, vStr] = part.split(':');
    const v = Number(vStr);
    if ((BATTER_POSITIONS as readonly string[]).includes(pos) && Number.isFinite(v) && v >= 0) {
      out[pos as BatterPosition] = Math.floor(v);
    }
  }
  return out;
}
