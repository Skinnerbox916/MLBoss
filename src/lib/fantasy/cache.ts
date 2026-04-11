import { redis, redisUtils } from '@/lib/redis';

// Caching Strategy:
// - Static: 24-48h TTL for data that never changes during season (game metadata, stat categories)
// - Semi-dynamic: 5-10min TTL for data that changes occasionally (leagues, teams, rosters)
// - Dynamic: No cache or very short TTL for real-time data (scoreboards, live stats, transactions)

export const CACHE_CATEGORIES = {
  STATIC: {
    ttl: 86400, // 24 hours
    ttlLong: 172800, // 48 hours
    prefix: 'static',
  },
  SEMI_DYNAMIC: {
    ttl: 300, // 5 minutes
    ttlMedium: 600, // 10 minutes
    ttlLong: 3600, // 1 hour
    prefix: 'semi-dynamic',
  },
  DYNAMIC: {
    ttl: 60, // 1 minute
    ttlShort: 30, // 30 seconds
    prefix: 'dynamic',
  }
} as const;

// ---------------------------------------------------------------------------
// Low-level cache primitives
// ---------------------------------------------------------------------------

export async function cacheResult(key: string, result: unknown, ttl: number = 3600): Promise<void> {
  const cacheKey = `cache:${key}`;
  await redisUtils.set(cacheKey, JSON.stringify(result), ttl);
}

export async function getCachedResult<T>(key: string): Promise<T | null> {
  const cacheKey = `cache:${key}`;
  const cached = await redisUtils.get(cacheKey);
  return cached ? JSON.parse(cached) : null;
}

export async function invalidateCache(key: string): Promise<void> {
  const cacheKey = `cache:${key}`;
  await redisUtils.del(cacheKey);
}

/**
 * Invalidate all cache keys matching a prefix.
 * Useful after mutations (e.g., roster moves) to bust stale data.
 *
 * Example: invalidateCachePattern('semi-dynamic:teams:458.l.12345')
 */
export async function invalidateCachePattern(prefix: string): Promise<number> {
  const keys = await redis.keys(`cache:${prefix}*`);
  if (keys.length === 0) return 0;
  return await redis.del(...keys);
}

// ---------------------------------------------------------------------------
// withCache — eliminates the check/fetch/store boilerplate
// ---------------------------------------------------------------------------

/**
 * Fetch data with transparent Redis caching.
 *
 * Usage:
 *   const leagues = await withCache(key, ttl, () => api.getUserLeagues());
 */
export async function withCache<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const cached = await getCachedResult<T>(key);
  if (cached !== null) return cached;

  const result = await fetchFn();
  await cacheResult(key, result, ttl);
  return result;
}
