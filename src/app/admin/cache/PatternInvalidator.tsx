'use client';

import { useState, useTransition } from 'react';
import { invalidatePatternAction } from './actions';

/**
 * Power-user pattern invalidation. Lets you target a specific resource
 * family (e.g. `static:savant:`, `dynamic:roster:458.l.12345.t.4`) without
 * having to scroll the table.
 */
export default function PatternInvalidator() {
  const [pattern, setPattern] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: 'idle' }
    | { kind: 'ok'; count: number; pattern: string }
    | { kind: 'err'; error: string }
  >({ kind: 'idle' });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pattern.trim();
    if (!trimmed) return;
    if (!window.confirm(`Invalidate every key matching:\n\ncache:${trimmed}*`)) return;
    startTransition(async () => {
      const res = await invalidatePatternAction(trimmed);
      if (res.ok) {
        setResult({ kind: 'ok', count: res.count, pattern: trimmed });
        setPattern('');
      } else {
        setResult({ kind: 'err', error: res.error ?? 'Unknown error' });
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex items-stretch gap-2">
      <input
        type="text"
        value={pattern}
        onChange={e => setPattern(e.target.value)}
        placeholder="prefix to invalidate (e.g. static:savant:)"
        className="flex-1 px-3 py-1.5 text-xs font-mono rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
      />
      <button
        type="submit"
        disabled={pending || pattern.trim().length === 0}
        className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-surface-muted disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {pending ? 'Working…' : 'Invalidate'}
      </button>
      {result.kind === 'ok' && (
        <span className="text-xs text-muted-foreground self-center whitespace-nowrap">
          Cleared {result.count} {result.count === 1 ? 'key' : 'keys'}
        </span>
      )}
      {result.kind === 'err' && (
        <span className="text-xs text-error self-center whitespace-nowrap">
          {result.error}
        </span>
      )}
    </form>
  );
}
