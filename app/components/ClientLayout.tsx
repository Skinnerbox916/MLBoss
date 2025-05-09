'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect, ReactNode } from 'react';
import Navigation from './Navigation';

// Custom layout styles
const layoutStyles = `
  .app-layout {
    display: flex;
    min-height: 100vh;
    background-color: #f9fafb;
  }
  
  .sidebar-container {
    position: sticky;
    top: 0;
    z-index: 10;
  }
  
  .main-content {
    flex: 1;
    min-width: 0;
    padding: 1.5rem;
  }
  
  .content-container {
    max-width: 1280px;
    margin: 0 auto;
  }
`;

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

  return (
    <>
      <style jsx global>{layoutStyles}</style>
      <div className="app-layout">
        {/* Only show sidebar for authenticated pages */}
        {pathname !== '/' && (
          <div className="sidebar-container">
            <Navigation onLogout={handleLogout} />
          </div>
        )}
        
        {/* Main content */}
        <div className="main-content">
          <div className="content-container">
            {error ? (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
                {error}
              </div>
            ) : null}
            
            {children}
          </div>
        </div>
      </div>
    </>
  );
} 