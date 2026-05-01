'use server';

import { revalidatePath } from 'next/cache';
import { redis } from '@/lib/redis';
import {
  invalidateCache,
  invalidateCachePattern,
  listCacheKeys,
  resetCacheStats,
} from '@/lib/fantasy';

const PATH = '/admin/cache';
const BATCH = 500;

// ---------------------------------------------------------------------------
// Tier-level clears
// ---------------------------------------------------------------------------

async function clearByPattern(pattern: string): Promise<number> {
  const keys = await listCacheKeys(pattern);
  if (keys.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += BATCH) {
    deleted += await redis.del(...keys.slice(i, i + BATCH));
  }
  return deleted;
}

export async function clearAllAction(): Promise<void> {
  await clearByPattern('cache:*');
  revalidatePath(PATH);
}

export async function clearStaticAction(): Promise<void> {
  await clearByPattern('cache:static:*');
  revalidatePath(PATH);
}

export async function clearSemiDynamicAction(): Promise<void> {
  await clearByPattern('cache:semi-dynamic:*');
  revalidatePath(PATH);
}

export async function clearDynamicAction(): Promise<void> {
  await clearByPattern('cache:dynamic:*');
  revalidatePath(PATH);
}

/**
 * Clear keys that fell into the `other` bucket — anything under `cache:`
 * that doesn't match one of the three named tier prefixes. These shouldn't
 * normally exist; if they do they're either a bug or a leftover from a
 * deprecated subsystem.
 */
export async function clearOtherAction(): Promise<void> {
  const allKeys = await listCacheKeys('cache:*');
  const orphans = allKeys.filter(k => {
    const stripped = k.replace(/^cache:/, '');
    return !stripped.startsWith('static:')
      && !stripped.startsWith('semi-dynamic:')
      && !stripped.startsWith('dynamic:');
  });
  if (orphans.length === 0) {
    revalidatePath(PATH);
    return;
  }
  for (let i = 0; i < orphans.length; i += BATCH) {
    await redis.del(...orphans.slice(i, i + BATCH));
  }
  revalidatePath(PATH);
}

// ---------------------------------------------------------------------------
// Per-key actions
// ---------------------------------------------------------------------------

/**
 * Delete a single cache key. `shortKey` is the form shown in the UI (e.g.
 * `dynamic:roster:458.l.12345.t.4`), without the leading `cache:` segment.
 */
export async function deleteKeyAction(shortKey: string): Promise<void> {
  await invalidateCache(shortKey);
  revalidatePath(PATH);
}

/**
 * Read a cached value by its short key. Returns the raw JSON string so the
 * client can render it without re-serialising. Used by the row "view" UI.
 */
export async function readKeyValueAction(shortKey: string): Promise<{
  ok: true;
  value: unknown;
  raw: string;
  ttl: number;
} | { ok: false; error: string }> {
  try {
    const fullKey = `cache:${shortKey}`;
    const [raw, ttl] = await Promise.all([
      redis.get(fullKey),
      redis.ttl(fullKey),
    ]);
    if (raw === null) return { ok: false, error: 'Key not found' };
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    return { ok: true, value, raw, ttl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Pattern-level invalidation (for power users)
// ---------------------------------------------------------------------------

/**
 * Invalidate every cache key matching the supplied prefix. The prefix is
 * tier-relative — the leading `cache:` is added for you.
 *
 * Example: `static:savant:` clears all Savant leaderboards.
 */
export async function invalidatePatternAction(prefix: string): Promise<{
  ok: boolean;
  count: number;
  error?: string;
}> {
  const trimmed = prefix.trim();
  if (!trimmed) return { ok: false, count: 0, error: 'Pattern is empty' };
  if (trimmed === '*' || trimmed === '') {
    return { ok: false, count: 0, error: 'Refusing to clear all keys via pattern; use the Clear All button.' };
  }
  try {
    const count = await invalidateCachePattern(trimmed);
    revalidatePath(PATH);
    return { ok: true, count };
  } catch (err) {
    return {
      ok: false,
      count: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Stats actions (Phase 3)
// ---------------------------------------------------------------------------

export async function resetStatsAction(): Promise<void> {
  resetCacheStats();
  revalidatePath(PATH);
}
