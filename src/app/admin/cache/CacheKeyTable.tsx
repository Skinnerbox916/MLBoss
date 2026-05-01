'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { deleteKeyAction, readKeyValueAction } from './actions';

export interface CacheRow {
  shortKey: string;
  ttl: number;
  sizeBytes: number;
  tier: 'static' | 'semi-dynamic' | 'dynamic' | 'other';
  /** True when a higher-versioned key exists in the same resource family. */
  isStaleVersion: boolean;
}

interface Props {
  rows: CacheRow[];
}

const TIER_DOT: Record<CacheRow['tier'], string> = {
  static: 'bg-blue-500',
  'semi-dynamic': 'bg-amber-500',
  dynamic: 'bg-green-500',
  other: 'bg-gray-400',
};

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

type SortBy = 'key' | 'ttl' | 'size';

export default function CacheKeyTable({ rows }: Props) {
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('key');
  const [sortDesc, setSortDesc] = useState(false);
  const [viewing, setViewing] = useState<{ shortKey: string } | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out = q
      ? rows.filter(r => r.shortKey.toLowerCase().includes(q))
      : rows.slice();

    out.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'key') cmp = a.shortKey.localeCompare(b.shortKey);
      else if (sortBy === 'ttl') cmp = a.ttl - b.ttl;
      else if (sortBy === 'size') cmp = a.sizeBytes - b.sizeBytes;
      return sortDesc ? -cmp : cmp;
    });
    return out;
  }, [rows, filter, sortBy, sortDesc]);

  function toggleSort(by: SortBy) {
    if (sortBy === by) {
      setSortDesc(d => !d);
    } else {
      setSortBy(by);
      setSortDesc(by !== 'key'); // size/ttl default to descending
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter keys (e.g. roster, savant, 458.l.)"
          className="flex-1 px-3 py-1.5 text-xs font-mono rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {rows.length === 0 ? 'Cache is empty.' : 'No keys match the filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border text-left">
                <SortableHeader
                  label="Key"
                  active={sortBy === 'key'}
                  desc={sortDesc}
                  onClick={() => toggleSort('key')}
                />
                <SortableHeader
                  label="TTL"
                  active={sortBy === 'ttl'}
                  desc={sortDesc}
                  width="w-20"
                  onClick={() => toggleSort('ttl')}
                />
                <SortableHeader
                  label="Size"
                  active={sortBy === 'size'}
                  desc={sortDesc}
                  width="w-20"
                  onClick={() => toggleSort('size')}
                />
                <th className="py-1.5 font-medium text-muted-foreground w-32 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-muted">
              {filtered.map(row => (
                <Row
                  key={row.shortKey}
                  row={row}
                  onView={() => setViewing({ shortKey: row.shortKey })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <ValueModal
          shortKey={viewing.shortKey}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

function SortableHeader({
  label,
  active,
  desc,
  width,
  onClick,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  width?: string;
  onClick: () => void;
}) {
  return (
    <th className={`py-1.5 pr-4 font-medium text-left ${width ?? ''}`}>
      <button
        type="button"
        onClick={onClick}
        className={`hover:text-foreground transition-colors ${active ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        {label}
        {active && <span className="ml-1 opacity-70">{desc ? '↓' : '↑'}</span>}
      </button>
    </th>
  );
}

function Row({ row, onView }: { row: CacheRow; onView: () => void }) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function copyKey() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(row.shortKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  function deleteKey() {
    if (!window.confirm(`Delete cache key?\n\n${row.shortKey}`)) return;
    startTransition(async () => {
      await deleteKeyAction(row.shortKey);
    });
  }

  return (
    <tr className={pending ? 'opacity-40' : undefined}>
      <td className="py-1.5 pr-4">
        <span className="inline-flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT[row.tier]}`} />
          <span className="text-foreground break-all">{row.shortKey}</span>
          {row.isStaleVersion && (
            <span
              className="ml-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-semibold bg-error/15 text-error border border-error/30"
              title="A higher-versioned key exists for this resource — this one is orphaned."
            >
              stale
            </span>
          )}
        </span>
      </td>
      <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">
        {formatTTL(row.ttl)}
      </td>
      <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">
        {formatSize(row.sizeBytes)}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={onView}
          className="px-1.5 py-0.5 text-[11px] rounded border border-border text-foreground hover:bg-surface-muted"
        >
          view
        </button>
        <button
          type="button"
          onClick={copyKey}
          className="ml-1 px-1.5 py-0.5 text-[11px] rounded border border-border text-foreground hover:bg-surface-muted"
        >
          {copied ? 'copied' : 'copy'}
        </button>
        <button
          type="button"
          onClick={deleteKey}
          disabled={pending}
          className="ml-1 px-1.5 py-0.5 text-[11px] rounded border border-error/40 text-error hover:bg-error/10 disabled:opacity-30"
        >
          delete
        </button>
      </td>
    </tr>
  );
}

function ValueModal({ shortKey, onClose }: { shortKey: string; onClose: () => void }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'ok'; value: unknown; raw: string; ttl: number }
    | { phase: 'error'; error: string }
  >({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    readKeyValueAction(shortKey).then(res => {
      if (cancelled) return;
      if (res.ok) {
        setState({ phase: 'ok', value: res.value, raw: res.raw, ttl: res.ttl });
      } else {
        setState({ phase: 'error', error: res.error });
      }
    });
    return () => { cancelled = true; };
  }, [shortKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg border border-border w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Cached value</div>
            <div className="text-sm font-mono text-foreground break-all">{shortKey}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-surface-muted shrink-0 ml-3"
          >
            close
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {state.phase === 'loading' && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {state.phase === 'error' && (
            <p className="text-sm text-error">{state.error}</p>
          )}
          {state.phase === 'ok' && (
            <>
              <div className="text-[11px] text-muted-foreground mb-2">
                TTL: {formatTTL(state.ttl)} · {formatSize(state.raw.length)}
              </div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-background p-3 rounded border border-border-muted">
                {JSON.stringify(state.value, null, 2)}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
