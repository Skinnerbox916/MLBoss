import { withCache, CACHE_CATEGORIES } from '@/lib/fantasy/cache';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

// ---------------------------------------------------------------------------
// Base fetcher — plain fetch, no auth required
// ---------------------------------------------------------------------------

export async function mlbFetch<T>(path: string): Promise<T> {
  const url = `${MLB_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 0 }, // disable Next.js fetch cache; we use Redis
  });

  if (!res.ok) {
    throw new Error(`MLB Stats API ${res.status}: ${url}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Cached fetcher wrappers — TTLs by data volatility
// ---------------------------------------------------------------------------

/** Schedule data: changes as probable pitchers are confirmed. Cache 5 min. */
export async function mlbFetchSchedule<T>(path: string, cacheKey: string): Promise<T> {
  return withCache(
    `mlb:schedule:${cacheKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,   // 5 min
    () => mlbFetch<T>(path),
  );
}

/** Player splits: updated daily at most. Cache 1 hour. */
export async function mlbFetchSplits<T>(path: string, cacheKey: string): Promise<T> {
  return withCache(
    `mlb:splits:${cacheKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttlLong, // 1 hour
    () => mlbFetch<T>(path),
  );
}

/** Player identity (name→MLB ID). Very stable. Cache 24 hours. */
export async function mlbFetchIdentity<T>(path: string, cacheKey: string): Promise<T> {
  return withCache(
    `mlb:identity:${cacheKey}`,
    CACHE_CATEGORIES.STATIC.ttl,          // 24 hours
    () => mlbFetch<T>(path),
  );
}

/** Team aggregate stats. Stable day-to-day. Cache 24 hours. */
export async function mlbFetchTeamStats<T>(path: string, cacheKey: string): Promise<T> {
  return withCache(
    `mlb:teamstats:${cacheKey}`,
    CACHE_CATEGORIES.STATIC.ttl,          // 24 hours
    () => mlbFetch<T>(path),
  );
}
