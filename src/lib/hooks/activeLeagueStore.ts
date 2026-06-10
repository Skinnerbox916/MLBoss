import { useSyncExternalStore } from 'react';

/**
 * Persisted "active league" selection for multi-league users. Stored in
 * localStorage so the choice survives navigation (a URL param would reset on
 * every page change) and page reloads. `useSyncExternalStore` keeps every
 * consumer (account-menu switcher, page routers) in sync without a provider.
 *
 * Holds just the league_key; `useActiveLeague` resolves it against the
 * bootstrap league list and falls back to the primary league when unset or
 * stale.
 */
const KEY = 'mlboss.activeLeagueKey';
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(l => l());
}

export function setActiveLeagueKey(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, key);
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window !== 'undefined') window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    if (typeof window !== 'undefined') window.removeEventListener('storage', cb);
  };
}

function getSnapshot(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
}

function getServerSnapshot(): string | null {
  return null;
}

export function useActiveLeagueKey(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
