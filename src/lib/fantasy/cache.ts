import { redis, redisUtils } from '@/lib/redis';

// ---------------------------------------------------------------------------
// SCAN-based key matcher
// ---------------------------------------------------------------------------
// `redis.keys(pattern)` is O(N) over the full keyspace and blocks the
// server while it scans. Use scanStream so we walk the keyspace in chunks
// (cooperative; doesn't block the event loop on the Redis side).
async function scanKeys(match: string, count = 200): Promise<string[]> {
  const keys: string[] = [];
  const stream = redis.scanStream({ match, count });
  for await (const batch of stream as AsyncIterable<string[]>) {
    if (batch.length > 0) keys.push(...batch);
  }
  return keys;
}

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
 * Uses SCAN under the hood so it stays safe on a large keyspace (KEYS
 * blocks the server). Deletes in 500-key batches.
 *
 * Example: invalidateCachePattern('semi-dynamic:teams:458.l.12345')
 */
export async function invalidateCachePattern(prefix: string): Promise<number> {
  const keys = await scanKeys(`cache:${prefix}*`);
  if (keys.length === 0) return 0;

  let deleted = 0;
  const BATCH = 500;
  for (let i = 0; i < keys.length; i += BATCH) {
    deleted += await redis.del(...keys.slice(i, i + BATCH));
  }
  return deleted;
}

/**
 * Walk the keyspace by pattern (SCAN-backed). Exported for the admin
 * cache page; production cache invalidation should use
 * `invalidateCachePattern` instead.
 */
export async function listCacheKeys(match: string): Promise<string[]> {
  return scanKeys(match);
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

/**
 * Like `withCache`, but skips writing the result to Redis when it fails the
 * caller-supplied quality gate. Use for multi-fan-out fetchers (anything that
 * runs `Promise.all` over a list of IDs) so a partial outage isn't pinned in
 * the cache for the full TTL.
 *
 * The gate runs after `fetchFn`, before `cacheResult`. If it returns `false`,
 * the caller still gets the (degraded) result, but the next request will
 * retry instead of being served stale partial data.
 *
 * Usage:
 *   return withCacheGated(
 *     key,
 *     CACHE_CATEGORIES.SEMI_DYNAMIC.ttlMedium,
 *     fetchAllPlayers,
 *     result => Object.keys(result).length / players.length >= 0.7,
 *   );
 */
export async function withCacheGated<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
  isAcceptable: (result: T) => boolean,
): Promise<T> {
  const cached = await getCachedResult<T>(key);
  if (cached !== null) return cached;

  const result = await fetchFn();
  if (isAcceptable(result)) {
    await cacheResult(key, result, ttl);
  } else {
    console.warn(`[cache] gate rejected result for key=${key}; skipping cache write`);
  }
  return result;
}
