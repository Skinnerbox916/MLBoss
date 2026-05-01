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

// ---------------------------------------------------------------------------
// In-process cache stats — read by /admin/cache to surface hit/miss/gate
// ratios. Counters live in module scope (one Node process per dev server),
// so a server restart wipes them; that's fine for a debug tool. We don't
// persist to Redis because the storage cost would exceed the value, and the
// counters are only ever read by the admin panel.
// ---------------------------------------------------------------------------

export type CacheTier = 'static' | 'semi-dynamic' | 'dynamic' | 'other';

interface TierCounters {
  hits: number;
  misses: number;
  gateRejects: number;
}

interface RecentReject {
  key: string;
  reason: string;
  ts: number;
}

const RECENT_REJECT_CAPACITY = 20;

const tierCounters: Record<CacheTier, TierCounters> = {
  static: { hits: 0, misses: 0, gateRejects: 0 },
  'semi-dynamic': { hits: 0, misses: 0, gateRejects: 0 },
  dynamic: { hits: 0, misses: 0, gateRejects: 0 },
  other: { hits: 0, misses: 0, gateRejects: 0 },
};

const recentRejects: RecentReject[] = [];

function tierOf(key: string): CacheTier {
  if (key.startsWith('static:')) return 'static';
  if (key.startsWith('semi-dynamic:')) return 'semi-dynamic';
  if (key.startsWith('dynamic:')) return 'dynamic';
  return 'other';
}

function recordHit(key: string): void {
  tierCounters[tierOf(key)].hits += 1;
}

function recordMiss(key: string): void {
  tierCounters[tierOf(key)].misses += 1;
}

function recordGateReject(key: string, reason: string): void {
  tierCounters[tierOf(key)].gateRejects += 1;
  recentRejects.unshift({ key, reason, ts: Date.now() });
  if (recentRejects.length > RECENT_REJECT_CAPACITY) {
    recentRejects.length = RECENT_REJECT_CAPACITY;
  }
}

export interface CacheStats {
  tiers: Record<CacheTier, TierCounters & { total: number; hitRatio: number | null }>;
  totals: TierCounters & { total: number; hitRatio: number | null };
  recentRejects: ReadonlyArray<RecentReject>;
}

function summarise(c: TierCounters) {
  const total = c.hits + c.misses;
  const hitRatio = total === 0 ? null : c.hits / total;
  return { ...c, total, hitRatio };
}

export function getCacheStats(): CacheStats {
  const tiers = {
    static: summarise(tierCounters.static),
    'semi-dynamic': summarise(tierCounters['semi-dynamic']),
    dynamic: summarise(tierCounters.dynamic),
    other: summarise(tierCounters.other),
  };
  const acc: TierCounters = { hits: 0, misses: 0, gateRejects: 0 };
  for (const t of Object.values(tierCounters)) {
    acc.hits += t.hits;
    acc.misses += t.misses;
    acc.gateRejects += t.gateRejects;
  }
  return {
    tiers,
    totals: summarise(acc),
    recentRejects: recentRejects.slice(),
  };
}

export function resetCacheStats(): void {
  for (const t of Object.values(tierCounters)) {
    t.hits = 0;
    t.misses = 0;
    t.gateRejects = 0;
  }
  recentRejects.length = 0;
}

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

const KNOWN_TIER_PREFIXES = ['static:', 'semi-dynamic:', 'dynamic:'] as const;

/**
 * Soft guard: every cache write must start with a recognized tier prefix
 * so the admin panel's tier-clear buttons, hit/miss stats, and
 * `invalidateCachePattern` calls all see a consistent keyspace. Logs a
 * warning rather than throwing so a misnamed key doesn't break a request
 * in production — but the warning is loud enough to surface in dev.
 */
function assertTieredKey(key: string): void {
  if (KNOWN_TIER_PREFIXES.some((p) => key.startsWith(p))) return;
  console.warn(
    `[cache] write to non-tier-prefixed key "${key}". ` +
    `Every cache write must start with one of: ${KNOWN_TIER_PREFIXES.join(', ')}. ` +
    `Use CACHE_CATEGORIES.{TIER}.prefix; see docs/data-architecture.md (Tier discipline).`,
  );
}

export async function cacheResult(key: string, result: unknown, ttl: number = 3600): Promise<void> {
  assertTieredKey(key);
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
  if (cached !== null) {
    recordHit(key);
    return cached;
  }
  recordMiss(key);

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
  if (cached !== null) {
    recordHit(key);
    return cached;
  }
  recordMiss(key);

  const result = await fetchFn();
  if (isAcceptable(result)) {
    await cacheResult(key, result, ttl);
  } else {
    const reason = 'coverage gate rejected';
    recordGateReject(key, reason);
    console.warn(`[cache] gate rejected result for key=${key}; skipping cache write`);
  }
  return result;
}
