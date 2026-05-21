'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

// In Next.js App Router, `usePathname()` doesn't update until the destination
// page has resolved — without `loading.tsx` boundaries, that means the active
// nav state doesn't move until the new page is fully ready. On a slow page
// load (heavy data, dev mode, etc.) the tap looks ignored.
//
// This hook tracks an "optimistic" pending destination so nav components can
// show the tapped item as active immediately. The pending state clears when
// pathname catches up, or after a safety timeout in case the navigation was
// abandoned (redirect, error, etc.) and pathname never matches.
//
// This does NOT fix the case where the main thread is fully blocked — clicks
// can't fire there, regardless of state. That's a perf problem, not a UI one.
const PENDING_NAV_TIMEOUT_MS = 4000;

export function usePendingNav() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (pendingHref && pathname === pendingHref) {
      setPendingHref(null);
    }
  }, [pathname, pendingHref]);

  useEffect(() => {
    if (!pendingHref) return;
    const id = window.setTimeout(() => setPendingHref(null), PENDING_NAV_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [pendingHref]);

  const markPending = useCallback((href: string) => {
    setPendingHref(href);
  }, []);

  const isActiveOrPending = useCallback(
    (href: string) => pathname === href || pendingHref === href,
    [pathname, pendingHref]
  );

  return { pathname, markPending, isActiveOrPending };
}
