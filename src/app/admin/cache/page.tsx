import { revalidatePath } from 'next/cache';
import { redis } from '@/lib/redis';
import { listCacheKeys } from '@/lib/fantasy/cache';
import AppLayout from '@/components/layout/AppLayout';

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

async function clearTier(pattern: string) {
  'use server';
  const keys = await listCacheKeys(pattern);
  if (keys.length === 0) {
    revalidatePath('/admin/cache');
    return;
  }
  const BATCH = 500;
  for (let i = 0; i < keys.length; i += BATCH) {
    await redis.del(...keys.slice(i, i + BATCH));
  }
  revalidatePath('/admin/cache');
}

async function clearAll() {
  'use server';
  await clearTier('cache:*');
}
async function clearStatic() {
  'use server';
  await clearTier('cache:static:*');
}
async function clearSemiDynamic() {
  'use server';
  await clearTier('cache:semi-dynamic:*');
}
async function clearDynamic() {
  'use server';
  await clearTier('cache:dynamic:*');
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface CacheEntry {
  key: string;
  shortKey: string;
  ttl: number;
  tier: string;
  sizeBytes: number;
}

async function getCacheEntries(): Promise<CacheEntry[]> {
  const keys = await listCacheKeys('cache:*');
  if (keys.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.ttl(key);
    pipeline.strlen(key);
  }
  const results = await pipeline.exec();
  if (!results) return [];

  return keys.map((key, i) => {
    const ttl = (results[i * 2]?.[1] as number) ?? -1;
    const sizeBytes = (results[i * 2 + 1]?.[1] as number) ?? 0;
    const shortKey = key.replace(/^cache:/, '');
    const tier = shortKey.startsWith('static:') ? 'static'
      : shortKey.startsWith('semi-dynamic:') ? 'semi-dynamic'
      : shortKey.startsWith('dynamic:') ? 'dynamic'
      : 'other';
    return { key, shortKey, ttl, tier, sizeBytes };
  }).sort((a, b) => a.shortKey.localeCompare(b.shortKey));
}

function formatTTL(seconds: number): string {
  if (seconds < 0) return 'no expiry';
  if (seconds === 0) return 'expiring';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TIER_STYLE: Record<string, { dot: string; label: string; desc: string }> = {
  static:        { dot: 'bg-blue-500',   label: 'Static',       desc: '24h — player IDs, park data, Savant leaderboards' },
  'semi-dynamic': { dot: 'bg-amber-500', label: 'Semi-dynamic', desc: '5–60 min — rosters, standings, roster stats' },
  dynamic:       { dot: 'bg-green-500',  label: 'Dynamic',      desc: '30s–1 min — scoreboards, live matchups' },
  other:         { dot: 'bg-gray-400',   label: 'Other',        desc: '' },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CachePage() {
  const entries = await getCacheEntries();

  const counts = { static: 0, 'semi-dynamic': 0, dynamic: 0, other: 0 };
  let totalSize = 0;
  for (const e of entries) {
    counts[e.tier as keyof typeof counts] = (counts[e.tier as keyof typeof counts] ?? 0) + 1;
    totalSize += e.sizeBytes;
  }

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto py-4 px-4 space-y-4">

          {/* ── Summary + Actions ──────────────────────────────── */}
          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Cache</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {entries.length} keys &middot; {formatSize(totalSize)} total
                </p>
              </div>
              <form action={clearAll}>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-error text-white text-sm rounded hover:bg-error/90"
                >
                  Clear all data cache
                </button>
              </form>
            </div>

            {/* Tier cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['static', 'semi-dynamic', 'dynamic'] as const).map(tier => {
                const style = TIER_STYLE[tier];
                const count = counts[tier];
                const action = tier === 'static' ? clearStatic
                  : tier === 'semi-dynamic' ? clearSemiDynamic
                  : clearDynamic;
                return (
                  <div key={tier} className="border border-border rounded-lg p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.dot}`} />
                        <span className="text-sm font-semibold text-foreground">{style.label}</span>
                      </span>
                      <span className="text-lg font-bold text-foreground">{count}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug">{style.desc}</p>
                    <form action={action} className="mt-auto">
                      <button
                        type="submit"
                        disabled={count === 0}
                        className="w-full mt-1 px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-surface-muted disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Clear {style.label.toLowerCase()}
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Key listing ─────────────────────────────────────── */}
          <div className="bg-surface rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Cached keys</h3>

            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Cache is empty.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-1.5 pr-4 font-medium text-muted-foreground">Key</th>
                      <th className="py-1.5 pr-4 font-medium text-muted-foreground w-16">TTL</th>
                      <th className="py-1.5 font-medium text-muted-foreground w-16">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-muted">
                    {entries.map(e => {
                      const style = TIER_STYLE[e.tier] ?? TIER_STYLE.other;
                      return (
                        <tr key={e.key}>
                          <td className="py-1.5 pr-4">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                              <span className="text-foreground break-all">{e.shortKey}</span>
                            </span>
                          </td>
                          <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">
                            {formatTTL(e.ttl)}
                          </td>
                          <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                            {formatSize(e.sizeBytes)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </main>
    </AppLayout>
  );
}
