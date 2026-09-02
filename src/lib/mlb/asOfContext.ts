/**
 * As-of context — the one seam the retro (historical) forecast pipeline uses
 * to run the UNCHANGED engines against inputs as they stood on a past date.
 *
 * When a context is active (AsyncLocalStorage, set by src/lib/retro/):
 *   - `withCache` / `withCacheGated` bypass Redis entirely (no reads, no
 *     writes) so retro inputs never leak into, or out of, the live caches;
 *   - `fetchStatcastPitchers/Batters(season)` return the as-of aggregates for
 *     the context's season instead of Savant's season-to-date leaderboards;
 *   - `mlbFetch` offers every MLB Stats API URL to `interceptMlbStats`, which
 *     rewrites season totals to date ranges, slices game logs, and synthesizes
 *     the split types the API can't serve as-of (see src/lib/retro/mlbAsOf.ts).
 *
 * This module is deliberately tiny and dependency-free so engine-side code
 * can import it without pulling anything from src/lib/retro/. Outside a retro
 * run `getAsOfContext()` is undefined and every hook is a no-op.
 * docs/forecast-verification.md#retro
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { StatcastBatter, StatcastPitcher } from './types';

export interface AsOfContext {
  /** Forecast date (YYYY-MM-DD). Only games strictly before it are visible. */
  asOf: string;
  season: number;
  /** First regular-season game date of `season` (date-range lower bound). */
  seasonStart: string;
  savantPitchers: () => Promise<Map<number, StatcastPitcher>>;
  savantBatters: () => Promise<Map<number, StatcastBatter>>;
  /**
   * Offered every MLB Stats API request. Return `undefined` to let the request
   * proceed unchanged (pass-through), or the response object to use instead.
   * `fetchJson` performs a normal (retrying) fetch of any URL the interceptor
   * wants to issue itself.
   */
  interceptMlbStats: (url: URL, fetchJson: (u: URL) => Promise<unknown>) => Promise<unknown | undefined>;
}

const storage = new AsyncLocalStorage<AsOfContext>();

export function getAsOfContext(): AsOfContext | undefined {
  return storage.getStore();
}

export function runWithAsOfContext<T>(ctx: AsOfContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}
