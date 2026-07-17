'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * A JSON preference synced through /api/user/prefs, with localStorage as
 * the instant-read cache. Successor to the raw-localStorage persistence
 * in the concede/depth hooks — same synchronous first paint, but the
 * durable copy lives server-side so every device sees one state.
 *
 * Sync protocol:
 *   1. First render: state = clean(localStorage[key]) — no flash, works
 *      offline.
 *   2. On mount / key change: GET the server copy. Server value present →
 *      it wins (another device may have changed it). Absent but local
 *      non-empty → PUT the local value (one-time migration of pre-DB
 *      state).
 *   3. On change: write localStorage AND PUT the server copy. Empty
 *      values DELETE server-side instead. Failures degrade silently to
 *      localStorage-only behavior.
 *
 * `clean` must tolerate arbitrary JSON (bad shapes → empty) — it guards
 * both the localStorage parse and the server payload.
 */
export function useSyncedPref<T>(
  key: string | undefined,
  clean: (raw: unknown) => T,
  isEmpty: (value: T) => boolean,
): [T, Dispatch<SetStateAction<T>>] {
  const readLocal = (): T => {
    if (!key || typeof window === 'undefined') return clean(undefined);
    try {
      const raw = window.localStorage.getItem(key);
      return clean(raw ? JSON.parse(raw) : undefined);
    } catch {
      return clean(undefined);
    }
  };

  const [value, setValue] = useState<T>(readLocal);
  // Serialized form of the last value we've already persisted — suppresses
  // the write-back effect after hydration from server/localStorage.
  const persisted = useRef<string | null>(null);

  // Hydrate from the server (or migrate local → server) when key changes.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const local = readLocal();
    persisted.current = JSON.stringify(local);
    setValue(local);
    void (async () => {
      try {
        const res = await fetch(`/api/user/prefs?key=${encodeURIComponent(key)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { found: boolean; value?: unknown };
        if (cancelled) return;
        if (body.found) {
          const server = clean(body.value);
          persisted.current = JSON.stringify(server);
          setValue(server);
          try {
            window.localStorage.setItem(key, JSON.stringify(server));
          } catch { /* cache only */ }
        } else if (!isEmpty(local)) {
          await fetch('/api/user/prefs', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: local }),
          });
        }
      } catch { /* offline / logged out — localStorage behavior stands */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist changes (skip re-persisting what we just hydrated).
  useEffect(() => {
    if (!key || typeof window === 'undefined') return;
    const serialized = JSON.stringify(value);
    if (serialized === persisted.current) return;
    persisted.current = serialized;
    const empty = isEmpty(value);
    try {
      if (empty) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, serialized);
    } catch { /* cache only */ }
    void (async () => {
      try {
        if (empty) {
          await fetch(`/api/user/prefs?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
        } else {
          await fetch('/api/user/prefs', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value }),
          });
        }
      } catch { /* offline — next change retries */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}
