'use client';

import { useState, useEffect } from 'react';
import DesktopSidebar from './DesktopSidebar';
import { MobileTopBar, MobileBottomNav } from './MobileChrome';

const SIDEBAR_OPEN_KEY = 'sidebarOpen';

// App shell. Owns layout state (sidebar collapse, account drawer, logout)
// and composes the desktop sidebar (md+) with the mobile chrome (<md).
// Page content is the middle child of the vertical flex column and keeps
// its own `<main>` with `overflow-y-auto`, so scroll stays inside content
// regardless of whether the mobile bars are present.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Default to `true` so SSR and the client's first render agree. The saved
  // value is restored in the effect below — reading localStorage during
  // render causes a hydration mismatch (server sees window=undefined → true,
  // client sees the actual saved value).
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Restore saved sidebar state on mount. The width transition is suppressed
  // until the next frame so the restoration is instant — otherwise users with
  // a collapsed sidebar would see a 300ms expand→collapse on every page load.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_OPEN_KEY);
      if (saved !== null) setIsSidebarOpen(JSON.parse(saved));
    } catch {
      /* localStorage unavailable or malformed — fall back to default */
    }
    const raf = requestAnimationFrame(() => setIsHydrated(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(SIDEBAR_OPEN_KEY, JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen, isHydrated]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isAccountOpen && !(event.target as Element).closest('.account-drawer')) {
        setIsAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAccountOpen]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        window.location.href = '/';
      } else {
        throw new Error('Logout failed');
      }
    } catch (error) {
      console.error('Logout error:', error);
      setIsLoggingOut(false);
    }
  };

  const toggleSidebar = () => setIsSidebarOpen((v: boolean) => !v);
  const toggleAccount = () => setIsAccountOpen((v) => !v);
  const closeAccount = () => setIsAccountOpen(false);

  return (
    <div className="flex h-dvh bg-background">
      <DesktopSidebar
        isSidebarOpen={isSidebarOpen}
        isHydrated={isHydrated}
        onToggle={toggleSidebar}
        isAccountOpen={isAccountOpen}
        onAccountToggle={toggleAccount}
        onAccountClose={closeAccount}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
      />

      {isAccountOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={closeAccount}
          aria-hidden="true"
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <MobileTopBar
          isAccountOpen={isAccountOpen}
          onAccountToggle={toggleAccount}
          onAccountClose={closeAccount}
          onLogout={handleLogout}
          isLoggingOut={isLoggingOut}
        />
        {children}
        <MobileBottomNav />
      </div>
    </div>
  );
}
