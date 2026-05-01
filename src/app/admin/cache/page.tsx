import { redis } from '@/lib/redis';
import {
  getCacheStats,
  listCacheKeys,
  type CacheTier,
} from '@/lib/fantasy';
import AppLayout from '@/components/layout/AppLayout';
import CacheKeyTable, { type CacheRow } from './CacheKeyTable';
import ConfirmButton from './ConfirmButton';
import PatternInvalidator from './PatternInvalidator';
import {
  clearAllAction,
  clearStaticAction,
  clearSemiDynamicAction,
  clearDynamicAction,
  clearOtherAction,
  resetStatsAction,
} from './actions';

// ---------------------------------------------------------------------------
// Server-side data loading
// ---------------------------------------------------------------------------

interface PageData {
  rows: CacheRow[];
  counts: Record<CacheTier, number>;
  totalSizeBytes: number;
  memory: MemoryInfo | null;
  adjacent: AdjacentKeyspace;
}

interface MemoryInfo {
  usedMemoryHuman: string;
  maxMemoryHuman: string;
  maxMemoryPolicy: string;
  evictedKeys: number;
  expiredKeys: number;
  dbSize: number;
}

interface AdjacentKeyspace {
  user: number;
  token: number;
  oauthState: number;
  unknown: number;
}

const TIER_ORDER: CacheTier[] = ['static', 'semi-dynamic', 'dynamic', 'other'];

function tierOf(shortKey: string): CacheTier {
  if (shortKey.startsWith('static:')) return 'static';
  if (shortKey.startsWith('semi-dynamic:')) return 'semi-dynamic';
  if (shortKey.startsWith('dynamic:')) return 'dynamic';
  return 'other';
}

/**
 * Phase 4 — schema-version drift detection.
 *
 * Each cached payload-shape change bumps an inline `vN` segment. When two
 * generations of a family co-exist (e.g. `roster-stats-v6:…` and
 * `roster-stats-v7:…`) the older one is orphaned; nothing reads it, but it
 * still consumes RAM until its TTL expires. Mark those rows so they're easy
 * to clean up.
 */
function detectStaleVersions(shortKeys: string[]): Set<string> {
  // Group by "family stem" — the key with its -vN/`:vN` segment replaced
  // by a placeholder. Within a family, the highest version is current and
  // every lower version is stale.
  const families = new Map<string, { maxV: number; entries: Array<{ key: string; v: number }> }>();

  for (const key of shortKeys) {
    const m = /([-:])v(\d+)(?=:|$)/.exec(key);
    if (!m) continue;
    const version = parseInt(m[2], 10);
    const stem = key.slice(0, m.index) + m[1] + 'v*' + key.slice(m.index + m[0].length);
    const fam = families.get(stem) ?? { maxV: 0, entries: [] };
    fam.maxV = Math.max(fam.maxV, version);
    fam.entries.push({ key, v: version });
    families.set(stem, fam);
  }

  const stale = new Set<string>();
  for (const { maxV, entries } of families.values()) {
    if (entries.length < 2) continue;
    for (const e of entries) if (e.v < maxV) stale.add(e.key);
  }
  return stale;
}

async function loadPageData(): Promise<PageData> {
  const cacheKeys = await listCacheKeys('cache:*');

  // Pipeline TTL + STRLEN for every cache key (one round trip).
  const rows: CacheRow[] = [];
  const counts: Record<CacheTier, number> = {
    static: 0,
    'semi-dynamic': 0,
    dynamic: 0,
    other: 0,
  };
  let totalSizeBytes = 0;

  if (cacheKeys.length > 0) {
    const pipeline = redis.pipeline();
    for (const k of cacheKeys) {
      pipeline.ttl(k);
      pipeline.strlen(k);
    }
    const results = await pipeline.exec();
    const shortKeys = cacheKeys.map(k => k.replace(/^cache:/, ''));
    const staleVersions = detectStaleVersions(shortKeys);

    for (let i = 0; i < cacheKeys.length; i++) {
      const ttl = (results?.[i * 2]?.[1] as number) ?? -1;
      const sizeBytes = (results?.[i * 2 + 1]?.[1] as number) ?? 0;
      const shortKey = shortKeys[i];
      const tier = tierOf(shortKey);
      counts[tier] += 1;
      totalSizeBytes += sizeBytes;
      rows.push({
        shortKey,
        ttl,
        sizeBytes,
        tier,
        isStaleVersion: staleVersions.has(shortKey),
      });
    }
    rows.sort((a, b) => a.shortKey.localeCompare(b.shortKey));
  }

  // Phase 2 — memory + DB size.
  const memory = await loadMemoryInfo();

  // Phase 1 — adjacent keyspace peek.
  const [userKeys, tokenKeys, oauthStateKeys] = await Promise.all([
    listCacheKeys('user:*'),
    listCacheKeys('token:*'),
    listCacheKeys('oauth_state:*'),
  ]);
  const accountedFor = cacheKeys.length + userKeys.length + tokenKeys.length + oauthStateKeys.length;
  const adjacent: AdjacentKeyspace = {
    user: userKeys.length,
    token: tokenKeys.length,
    oauthState: oauthStateKeys.length,
    unknown: Math.max(0, (memory?.dbSize ?? accountedFor) - accountedFor),
  };

  return { rows, counts, totalSizeBytes, memory, adjacent };
}

async function loadMemoryInfo(): Promise<MemoryInfo | null> {
  try {
    const [memInfo, statsInfo, dbSize] = await Promise.all([
      redis.info('memory'),
      redis.info('stats'),
      redis.dbsize(),
    ]);
    const memMap = parseInfo(memInfo);
    const statsMap = parseInfo(statsInfo);
    return {
      usedMemoryHuman: memMap.get('used_memory_human') ?? '?',
      maxMemoryHuman: memMap.get('maxmemory_human') ?? '0B',
      maxMemoryPolicy: memMap.get('maxmemory_policy') ?? 'noeviction',
      evictedKeys: parseInt(statsMap.get('evicted_keys') ?? '0', 10),
      expiredKeys: parseInt(statsMap.get('expired_keys') ?? '0', 10),
      dbSize,
    };
  } catch {
    return null;
  }
}

function parseInfo(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    out.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRatio(r: number | null): string {
  if (r === null) return '—';
  return `${(r * 100).toFixed(1)}%`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const TIER_STYLE: Record<CacheTier, { dot: string; label: string; desc: string }> = {
  static: {
    dot: 'bg-blue-500',
    label: 'Static',
    desc: '24–48h — game key, stat categories, league limits & roster slots, MLB identity, Savant leaderboards',
  },
  'semi-dynamic': {
    dot: 'bg-amber-500',
    label: 'Semi-dynamic',
    desc: '5min–1h — leagues, teams, standings, market signals, roster talent, free-agent pools',
  },
  dynamic: {
    dot: 'bg-green-500',
    label: 'Dynamic',
    desc: '30s–1min — scoreboards, live team stats, rosters, transactions',
  },
  other: {
    dot: 'bg-gray-400',
    label: 'Other',
    desc: 'Keys under cache: that don\'t match a known tier prefix. Should be empty; if it isn\'t, something is bypassing CACHE_CATEGORIES.',
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CachePage() {
  const data = await loadPageData();
  const stats = getCacheStats();
  const totalRequests = stats.totals.total;

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto py-4 px-4 space-y-4">

          <Header rows={data.rows.length} totalSize={data.totalSizeBytes} />

          <MemoryAndKeyspace memory={data.memory} adjacent={data.adjacent} cacheCount={data.rows.length} />

          <TierGrid counts={data.counts} />

          <PatternSection />

          <StatsSection stats={stats} totalRequests={totalRequests} />

          <KeyListing rows={data.rows} />

        </div>
      </main>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Header({ rows, totalSize }: { rows: number; totalSize: number }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4 flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Cache</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {rows} keys · {formatSize(totalSize)} total
        </p>
      </div>
      <ConfirmButton
        action={clearAllAction}
        confirm="Clear ALL cache keys? This wipes every tier (static, semi-dynamic, dynamic, other). Auth keys (user:*, token:*) are NOT touched."
        disabled={rows === 0}
        className="px-3 py-1.5 bg-error text-white text-sm rounded hover:bg-error/90"
      >
        Clear all data cache
      </ConfirmButton>
    </div>
  );
}

function MemoryAndKeyspace({
  memory,
  adjacent,
  cacheCount,
}: {
  memory: MemoryInfo | null;
  adjacent: AdjacentKeyspace;
  cacheCount: number;
}) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Redis health</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Stat
          label="DB size"
          value={memory ? memory.dbSize.toLocaleString() : '?'}
          hint="all keys (cache + auth + state)"
        />
        <Stat
          label="Memory"
          value={memory ? `${memory.usedMemoryHuman} / ${memory.maxMemoryHuman === '0B' ? '∞' : memory.maxMemoryHuman}` : '?'}
          hint={memory?.maxMemoryPolicy ?? ''}
        />
        <Stat
          label="Evicted"
          value={memory ? memory.evictedKeys.toLocaleString() : '?'}
          hint={memory && memory.evictedKeys > 0 ? 'keys lost to maxmemory pressure' : 'no eviction pressure'}
          warn={!!memory && memory.evictedKeys > 0}
        />
        <Stat
          label="Expired"
          value={memory ? memory.expiredKeys.toLocaleString() : '?'}
          hint="keys aged out via TTL"
        />
      </div>

      <div className="mt-4 pt-3 border-t border-border-muted">
        <div className="text-[11px] text-muted-foreground mb-1.5">Keyspace breakdown</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <Stat label="cache:*" value={cacheCount.toLocaleString()} hint="this panel" />
          <Stat label="user:*" value={adjacent.user.toLocaleString()} hint="auth backup hashes" />
          <Stat label="token:*" value={adjacent.token.toLocaleString()} hint="access token lookups" />
          <Stat label="oauth_state:*" value={adjacent.oauthState.toLocaleString()} hint="CSRF state (10min TTL)" />
          <Stat
            label="other"
            value={adjacent.unknown.toLocaleString()}
            hint={adjacent.unknown > 0 ? 'unaccounted-for keys' : 'all keys accounted for'}
            warn={adjacent.unknown > 0}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold font-mono ${warn ? 'text-error' : 'text-foreground'}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function TierGrid({ counts }: { counts: Record<CacheTier, number> }) {
  const visibleTiers = TIER_ORDER.filter(t => t !== 'other' || counts.other > 0);
  // Tailwind needs literal class names — use the correct fixed grid for the tier count.
  const gridCols = visibleTiers.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3';
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Tiers</h3>
      <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
        {visibleTiers.map(tier => {
          const style = TIER_STYLE[tier];
          const count = counts[tier];
          const action = tier === 'static' ? clearStaticAction
            : tier === 'semi-dynamic' ? clearSemiDynamicAction
            : tier === 'dynamic' ? clearDynamicAction
            : clearOtherAction;
          const confirm = `Clear all ${count} ${style.label.toLowerCase()} cache ${count === 1 ? 'entry' : 'entries'}?`;
          return (
            <div key={tier} className="border border-border rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.dot}`} />
                  <span className="text-sm font-semibold text-foreground">{style.label}</span>
                </span>
                <span className="text-lg font-bold text-foreground">{count}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug min-h-[2.4rem]">{style.desc}</p>
              <ConfirmButton
                action={action}
                confirm={confirm}
                disabled={count === 0}
                className="w-full mt-auto px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-surface-muted"
              >
                Clear {style.label.toLowerCase()}
              </ConfirmButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PatternSection() {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground mb-1">Invalidate by pattern</h3>
      <p className="text-[11px] text-muted-foreground mb-3">
        Targeted invalidation for power users — e.g. <code className="font-mono">static:savant:</code> clears every Savant leaderboard, <code className="font-mono">dynamic:roster:458.l.12345.t.4</code> clears one team&apos;s roster cache. The leading <code className="font-mono">cache:</code> is added automatically.
      </p>
      <PatternInvalidator />
    </div>
  );
}

function StatsSection({
  stats,
  totalRequests,
}: {
  stats: ReturnType<typeof getCacheStats>;
  totalRequests: number;
}) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Hit / miss stats</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            In-process counters, reset on server restart. {totalRequests.toLocaleString()} requests since last reset.
          </p>
        </div>
        <ConfirmButton
          action={resetStatsAction}
          confirm="Reset all hit/miss counters?"
          disabled={totalRequests === 0}
          className="px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-surface-muted"
        >
          Reset
        </ConfirmButton>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-4 font-medium">Tier</th>
              <th className="py-1.5 pr-4 font-medium text-right w-20">Hits</th>
              <th className="py-1.5 pr-4 font-medium text-right w-20">Misses</th>
              <th className="py-1.5 pr-4 font-medium text-right w-20">Gate rejects</th>
              <th className="py-1.5 pr-4 font-medium text-right w-24">Hit ratio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-muted font-mono">
            {TIER_ORDER.map(tier => {
              const t = stats.tiers[tier];
              const style = TIER_STYLE[tier];
              return (
                <tr key={tier}>
                  <td className="py-1.5 pr-4">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot}`} />
                      {style.label}
                    </span>
                  </td>
                  <td className="py-1.5 pr-4 text-right text-foreground">{t.hits.toLocaleString()}</td>
                  <td className="py-1.5 pr-4 text-right text-foreground">{t.misses.toLocaleString()}</td>
                  <td className={`py-1.5 pr-4 text-right ${t.gateRejects > 0 ? 'text-error' : 'text-foreground'}`}>
                    {t.gateRejects.toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-foreground">{formatRatio(t.hitRatio)}</td>
                </tr>
              );
            })}
            <tr className="font-semibold border-t-2 border-border">
              <td className="py-1.5 pr-4 text-foreground">Total</td>
              <td className="py-1.5 pr-4 text-right text-foreground">{stats.totals.hits.toLocaleString()}</td>
              <td className="py-1.5 pr-4 text-right text-foreground">{stats.totals.misses.toLocaleString()}</td>
              <td className={`py-1.5 pr-4 text-right ${stats.totals.gateRejects > 0 ? 'text-error' : 'text-foreground'}`}>
                {stats.totals.gateRejects.toLocaleString()}
              </td>
              <td className="py-1.5 pr-4 text-right text-foreground">{formatRatio(stats.totals.hitRatio)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {stats.recentRejects.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border-muted">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Recent gate rejects ({stats.recentRejects.length})
          </div>
          <ul className="space-y-1">
            {stats.recentRejects.map((r, i) => (
              <li key={`${r.ts}-${i}`} className="text-[11px] font-mono flex items-baseline gap-2">
                <span className="text-muted-foreground whitespace-nowrap">{formatRelativeTime(r.ts)}</span>
                <span className="text-foreground break-all">{r.key}</span>
                <span className="text-muted-foreground italic whitespace-nowrap">— {r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function KeyListing({ rows }: { rows: CacheRow[] }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Cached keys</h3>
      <CacheKeyTable rows={rows} />
    </div>
  );
}
