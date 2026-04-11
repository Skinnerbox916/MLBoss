import { YahooFantasyAPI, StatCategory } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';
import { COMMON_MLB_STATS } from '@/constants/statCategories';

/**
 * Get stat categories for a game with caching.
 * Uses Static caching (48-hour TTL) - stat categories never change during a season.
 */
export async function getStatCategories(gameKey: string, userId?: string): Promise<StatCategory[]> {
  return withCache(
    `${CACHE_CATEGORIES.STATIC.prefix}:stat_categories:${gameKey}`,
    CACHE_CATEGORIES.STATIC.ttlLong,
    () => new YahooFantasyAPI(userId).getStatCategories(gameKey),
  );
}

/**
 * Get stat category map for quick lookups.
 * Uses Static caching (48-hour TTL) - stat categories never change during a season.
 */
export async function getStatCategoryMap(gameKey: string, userId?: string): Promise<Record<number, StatCategory>> {
  return withCache(
    `${CACHE_CATEGORIES.STATIC.prefix}:stat_category_map:${gameKey}`,
    CACHE_CATEGORIES.STATIC.ttlLong,
    async () => {
      const categories = await getStatCategories(gameKey, userId);
      return YahooFantasyAPI.buildStatCategoryMap(categories);
    },
  );
}

/** A raw stat as received from the Yahoo API. */
export interface RawStat {
  stat_id: string | number;
  value: string | number;
}

/** A stat enriched with category metadata. */
export interface EnrichedStat extends RawStat {
  stat_id: number;
  name: string;
  display_name: string;
  position_types: string[];
  is_pitcher_stat: boolean;
  is_batter_stat: boolean;
  sort_order?: string;
}

/**
 * Enrich player/team stats with category metadata.
 * @param gameKey - The game key (e.g., "458" for MLB 2025)
 * @param stats - Array of stat objects with stat_id and value
 * @param userId - Optional user ID for authentication (only needed if not cached)
 */
export async function enrichStats<T extends RawStat>(
  gameKey: string,
  stats: T[],
  userId?: string
): Promise<Array<T & Omit<EnrichedStat, keyof RawStat>>> {
  const categoryMap = await getStatCategoryMap(gameKey, userId);

  return stats.map(stat => {
    const statId = Number(stat.stat_id);
    const category = categoryMap[statId];

    return {
      ...stat,
      stat_id: statId,
      name: category?.name || 'Unknown',
      display_name: category?.display_name || '??',
      position_types: category?.position_types || [],
      is_pitcher_stat: (category?.position_types || []).includes('P'),
      is_batter_stat: (category?.position_types || []).includes('B'),
      sort_order: category?.sort_order,
    };
  });
}

export interface EnrichedLeagueStatCategory {
  stat_id: number;
  name: string;
  display_name: string;
  position_types: string[];
  is_pitcher_stat: boolean;
  is_batter_stat: boolean;
  sort_order: string;
  betterIs: 'higher' | 'lower';
}

/**
 * Get league-specific stat categories enriched with game-level metadata.
 * Combines league settings (which categories are scored) with game-level
 * stat metadata (position_types, sort_order) to produce a complete picture.
 * Uses Semi-dynamic caching (1-hour TTL) - league settings rarely change.
 */
export async function getEnrichedLeagueStatCategories(
  userId: string,
  leagueKey: string
): Promise<EnrichedLeagueStatCategory[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:enriched_league_cats:${leagueKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttlLong,
    async () => {
      const api = new YahooFantasyAPI(userId);
      const leagueCategories = await api.getLeagueStatCategories(leagueKey);

      const gameKey = leagueKey.split('.')[0];
      const gameMap = await getStatCategoryMap(gameKey, userId);

      return leagueCategories.map(cat => {
        const gameMeta = gameMap[cat.stat_id];
        // Prefer game-level position_types (normalised to string[]) over league-level,
        // then fall back to the hardcoded COMMON_MLB_STATS table so batter/pitcher
        // classification works even when the Yahoo JSON response omits the field.
        const rawPositionTypes: string[] =
          (Array.isArray(gameMeta?.position_types) && (gameMeta.position_types as string[]).length > 0
            ? gameMeta.position_types as string[]
            : null) ??
          (Array.isArray(cat.position_types) && cat.position_types.length > 0
            ? cat.position_types
            : null) ??
          (COMMON_MLB_STATS[cat.stat_id]?.positions ?? []);

        const positionTypes: string[] = Array.isArray(rawPositionTypes) ? rawPositionTypes : [];
        const betterIs: 'higher' | 'lower' =
          (cat.sort_order ?? gameMeta?.sort_order) === '0' ? 'lower' : 'higher';

        return {
          stat_id: cat.stat_id,
          name: cat.name,
          display_name: cat.display_name,
          position_types: positionTypes,
          is_pitcher_stat: positionTypes.includes('P'),
          is_batter_stat: positionTypes.includes('B'),
          sort_order: cat.sort_order ?? gameMeta?.sort_order ?? '1',
          betterIs,
        };
      });
    },
  );
}
