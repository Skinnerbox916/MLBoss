'use client';

import { useCallback } from 'react';
import { useSyncedPref } from './useSyncedPref';
import { cleanPreferredDepth, type PreferredDepthMap } from '@/lib/roster/preferredDepth';
import type { BatterPosition } from '@/lib/roster/depth';

const isEmpty = (v: PreferredDepthMap) => Object.keys(v).length === 0;

/** Server-synced target-depth steppers for a roster page. */
export function usePreferredDepth(storageKey: string): {
  preferredDepth: PreferredDepthMap;
  updatePreferredDepth: (pos: BatterPosition, next: number | null) => void;
} {
  const [preferredDepth, setPreferredDepth] = useSyncedPref<PreferredDepthMap>(
    storageKey,
    cleanPreferredDepth,
    isEmpty,
  );

  const updatePreferredDepth = useCallback(
    (pos: BatterPosition, next: number | null) => {
      setPreferredDepth(prev => {
        const updated = { ...prev };
        if (next === null) {
          delete updated[pos];
        } else {
          updated[pos] = next;
        }
        return updated;
      });
    },
    [setPreferredDepth],
  );

  return { preferredDepth, updatePreferredDepth };
}
