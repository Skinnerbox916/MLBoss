'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Heading } from '@/components/typography';

interface AppHeaderProps {
  title: string;
  userName?: string;
}

export default function AppHeader({ title, userName }: AppHeaderProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        // The logout endpoint redirects, so if we reach here, 
        // it means we're handling the redirect client-side
        window.location.href = '/';
      } else {
        throw new Error('Logout failed');
      }
    } catch (error) {
      console.error('Logout error:', error);
      setIsLoggingOut(false);
      // Could show an error message here if needed
    }
  };
  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between">
          <Heading as="h1" size="h2">{title}</Heading>
          
          {userName && (
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground">
                {userName}
              </span>
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoggingOut ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
} 