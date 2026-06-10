import { YahooFantasyAPI } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';
import {
  POINTS_SCORING_TYPES,
  HEAD_TO_HEAD_SCORING_TYPES,
  scoringModeForType,
  type ScoringMode,
} from './scoringMode';

// Pure, client-safe mode helpers live in `./scoringMode` (no server imports);
// re-exported here so existing `@/lib/fantasy/scoringProfile` consumers keep
// working. Client components should import from `./scoringMode` directly.
export { scoringModeForType };
export type { ScoringMode };

/**
 * Canonical description of how a Yahoo league is scored. One profile per
 * league, resolved once and cached static-tier (league rules rarely change
 * mid-season). Every points-mode engine takes a `ScoringProfile` and uses
 * `weights` as the per-stat dot-product vector.
 *
 * `mode === 'categories'` → categories/roto league; `weights` is empty.
 * `mode === 'points'`     → points league; `weights[stat_id]` is the point
 *                            value Yahoo awards per unit of that stat.
 */
export interface ScoringProfile {
  mode: ScoringMode;
  leagueKey: string;
  /** Raw Yahoo `scoring_type` value, kept for debugging / display. */
  scoringType: string;
  /**
   * True when competition is decided by weekly head-to-head matchups
   * ('head' / 'headpoint'); false for season-long standings ('roto' / 'point').
   * Points mode + headToHead → weekly "points to beat" framing.
   */
  headToHead: boolean;
  /** stat_id → points-per-unit (empty for categories mode). */
  weights: Record<number, number>;
  /** stat_ids with non-zero weight, sorted ascending (empty for categories). */
  scoredStatIds: number[];
}

/**
 * Resolve the scoring profile for a league. For points leagues, fetches
 * `stat_modifiers` from Yahoo settings and builds a stat_id → point-value
 * map. For categories leagues, returns a no-op profile.
 *
 * Cache key is league-scoped (not user-scoped) — every member of a league
 * sees the same scoring rules, so multiple users share one entry.
 */
export async function getScoringProfile(
  userId: string,
  leagueKey: string,
  scoringType: string,
): Promise<ScoringProfile> {
  return withCache(
    `${CACHE_CATEGORIES.STATIC.prefix}:scoring-profile:${leagueKey}`,
    CACHE_CATEGORIES.STATIC.ttl,
    async () => {
      const isPoints = POINTS_SCORING_TYPES.has(scoringType);
      const headToHead = HEAD_TO_HEAD_SCORING_TYPES.has(scoringType);

      if (!isPoints) {
        return {
          mode: 'categories' as const,
          leagueKey,
          scoringType,
          headToHead,
          weights: {},
          scoredStatIds: [],
        };
      }

      const api = new YahooFantasyAPI(userId);
      const modifiers = await api.getLeagueStatModifiers(leagueKey);

      const weights: Record<number, number> = {};
      for (const mod of modifiers) {
        weights[mod.stat_id] = mod.value;
      }
      const scoredStatIds = Object.entries(weights)
        .filter(([, v]) => v !== 0)
        .map(([k]) => Number(k))
        .sort((a, b) => a - b);

      return {
        mode: 'points' as const,
        leagueKey,
        scoringType,
        headToHead,
        weights,
        scoredStatIds,
      };
    },
  );
}
