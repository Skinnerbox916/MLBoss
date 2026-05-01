import { withCache, CACHE_CATEGORIES } from '@/lib/fantasy/cache';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

// ---------------------------------------------------------------------------
// Per-host concurrency limiter
// ---------------------------------------------------------------------------
// Multiple pages fan out `Promise.all` over hundreds of player IDs. Without
// a limiter, Node opens that many sockets at once and the upstream API drops
// connections (`UND_ERR_CONNECT_TIMEOUT`). The limiter caps the in-flight
// request count per host so bursts queue instead of timing out.

const HOST_CONCURRENCY: Record<string, number> = {
  'statsapi.mlb.com': 8,
  'baseballsavant.mlb.com': 4,
};

const DEFAULT_CONCURRENCY = 6;

interface HostState {
  inFlight: number;
  queue: Array<() => void>;
}

const hostStates = new Map<string, HostState>();

function getHostState(host: string): HostState {
  let state = hostStates.get(host);
  if (!state) {
    state = { inFlight: 0, queue: [] };
    hostStates.set(host, state);
  }
  return state;
}

async function acquireSlot(host: string): Promise<() => void> {
  const limit = HOST_CONCURRENCY[host] ?? DEFAULT_CONCURRENCY;
  const state = getHostState(host);

  if (state.inFlight < limit) {
    state.inFlight += 1;
    return () => releaseSlot(host);
  }

  return new Promise<() => void>((resolve) => {
    state.queue.push(() => {
      state.inFlight += 1;
      resolve(() => releaseSlot(host));
    });
  });
}

function releaseSlot(host: string): void {
  const state = getHostState(host);
  state.inFlight = Math.max(0, state.inFlight - 1);
  const next = state.queue.shift();
  if (next) next();
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof MlbFetchError) return err.transient;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('etimedout') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound') ||
      msg.includes('fetch failed')
    );
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Normalized fetch error
// ---------------------------------------------------------------------------

export class MlbFetchError extends Error {
  readonly host: string;
  readonly path: string;
  readonly status?: number;
  readonly transient: boolean;

  constructor(opts: { host: string; path: string; message: string; status?: number; transient: boolean }) {
    super(`${opts.host} ${opts.path}: ${opts.message}`);
    this.name = 'MlbFetchError';
    this.host = opts.host;
    this.path = opts.path;
    this.status = opts.status;
    this.transient = opts.transient;
  }
}

// ---------------------------------------------------------------------------
// Core fetch primitive (uncached) — concurrency-bounded + retried
// ---------------------------------------------------------------------------

interface FetchOptions {
  /** Number of retry attempts on transient errors. Default 2. */
  retries?: number;
  /** Initial backoff in ms; doubles each attempt. Default 250. */
  backoffMs?: number;
  /** Override Accept header. Default 'application/json'. */
  accept?: string;
  /** Parse the body as text instead of JSON (used by Savant CSV). */
  responseType?: 'json' | 'text';
}

async function executeRequest(
  url: URL,
  opts: FetchOptions,
): Promise<unknown> {
  const host = url.host;
  const path = url.pathname + url.search;
  const release = await acquireSlot(host);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: opts.accept ?? 'application/json' },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const transient = TRANSIENT_STATUS_CODES.has(res.status);
      throw new MlbFetchError({
        host,
        path,
        message: `HTTP ${res.status}`,
        status: res.status,
        transient,
      });
    }

    return opts.responseType === 'text' ? await res.text() : await res.json();
  } finally {
    release();
  }
}

async function fetchWithRetry(
  url: URL,
  opts: FetchOptions,
): Promise<unknown> {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? 250;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await executeRequest(url, opts);
    } catch (err) {
      lastErr = err;
      const transient = isTransientError(err);
      if (!transient || attempt === retries) {
        if (transient || err instanceof MlbFetchError) {
          console.warn(
            `[mlb-fetch] ${url.host}${url.pathname} failed (attempt ${attempt + 1}/${retries + 1}):`,
            err instanceof Error ? err.message : err,
          );
        }
        throw err;
      }
      const delay = backoff * 2 ** attempt;
      await sleep(delay);
    }
  }

  throw lastErr;
}

// ---------------------------------------------------------------------------
// Public surfaces
// ---------------------------------------------------------------------------

/**
 * Plain MLB Stats API fetch (no caching). Concurrency-bounded and retried.
 * Use this when you don't need caching or are wrapping with `withCacheGated`
 * yourself. Most callers should prefer one of the cached helpers below.
 */
export async function mlbFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const url = new URL(`${MLB_API_BASE}${path}`);
  return (await fetchWithRetry(url, opts)) as T;
}

/**
 * Cached MLB Stats API fetch. Wraps `withCache` and applies the standard
 * retry + concurrency policy. Prefer this for any single-resource fetch.
 *
 * `cacheKey` is namespaced under `cache:{tier}:mlb:{group}:` by the four
 * wrapper helpers; if you call `mlbFetchCached` directly, supply a fully
 * scoped key so cache buckets don't collide.
 */
export async function mlbFetchCached<T>(
  path: string,
  opts: { cacheKey: string; ttl: number } & FetchOptions,
): Promise<T> {
  return withCache(opts.cacheKey, opts.ttl, () => mlbFetch<T>(path, opts));
}

// ---------------------------------------------------------------------------
// Group-flavoured wrappers — kept as 1-line aliases for back-compat.
// New callers should generally prefer mlbFetchCached + an explicit cacheKey,
// but the wrappers are convenient and worth keeping.
// ---------------------------------------------------------------------------

/** Schedule data: changes as probable pitchers are confirmed. Cache 5 min. */
export async function mlbFetchSchedule<T>(path: string, cacheKey: string): Promise<T> {
  return mlbFetchCached<T>(path, {
    cacheKey: `mlb:schedule:${cacheKey}`,
    ttl: CACHE_CATEGORIES.SEMI_DYNAMIC.ttl, // 5 min
  });
}

/** Player splits: updated daily at most. Cache 1 hour. */
export async function mlbFetchSplits<T>(path: string, cacheKey: string): Promise<T> {
  return mlbFetchCached<T>(path, {
    cacheKey: `mlb:splits:${cacheKey}`,
    ttl: CACHE_CATEGORIES.SEMI_DYNAMIC.ttlLong, // 1 hour
  });
}

/** Player identity (name->MLB ID). Very stable. Cache 24 hours. */
export async function mlbFetchIdentity<T>(path: string, cacheKey: string): Promise<T> {
  return mlbFetchCached<T>(path, {
    cacheKey: `mlb:identity:${cacheKey}`,
    ttl: CACHE_CATEGORIES.STATIC.ttl, // 24 hours
  });
}

/** Team aggregate stats. Stable day-to-day. Cache 24 hours. */
export async function mlbFetchTeamStats<T>(path: string, cacheKey: string): Promise<T> {
  return mlbFetchCached<T>(path, {
    cacheKey: `mlb:teamstats:${cacheKey}`,
    ttl: CACHE_CATEGORIES.STATIC.ttl, // 24 hours
  });
}

// ---------------------------------------------------------------------------
// Cross-host fetch for Baseball Savant
// ---------------------------------------------------------------------------
// Savant is a different host (different concurrency budget), and the body is
// CSV. The savant module owns its caching; this primitive only handles the
// HTTP + concurrency + retry concerns.

const SAVANT_BASE = 'https://baseballsavant.mlb.com';

export async function externalFetchText(
  fullUrl: string,
  opts: FetchOptions = {},
): Promise<string> {
  const url = new URL(fullUrl);
  return (await fetchWithRetry(url, { ...opts, responseType: 'text' })) as string;
}

/** @internal exported for tests/diagnostics. */
export const __SAVANT_BASE = SAVANT_BASE;
