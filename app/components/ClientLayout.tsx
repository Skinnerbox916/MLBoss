'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect, ReactNode } from 'react';
import DashboardFrame from './DashboardFrame';

type ClientLayoutProps = {
  children: ReactNode;
};

export default function ClientLayout({ children }: ClientLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined' && 
        !pathname?.includes('/auth') && 
        !pathname?.startsWith('/api') && 
        pathname !== '/' && 
        !document.cookie.includes('yahoo_client_access_token')) {
      router.push('/');
    }
  }, [router, pathname]);

  const handleLogout = () => {
    fetch('/api/auth/logout')
      .then(() => {
        router.push('/');
      });
  };

  // For login page, return just the children
  if (pathname === '/') {
    return <>{children}</>;
  }

  // Determine if this is a dashboard related path
  const isDashboardPath = pathname?.startsWith('/dashboard') || 
                          pathname?.startsWith('/lineup') || 
                          pathname?.startsWith('/matchup') || 
                          pathname?.startsWith('/roster') || 
                          pathname?.startsWith('/league');

  return (
    <>
      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-4 w-full">
          {error}
        </div>
      ) : null}
      
      {isDashboardPath ? (
        <DashboardFrame>{children}</DashboardFrame>
      ) : (
        children
      )}
    </>
  );
} 