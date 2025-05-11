'use client';

import { ReactNode } from 'react';
import { QueryProvider } from './query-provider';
import { FantasyDataProvider } from './fantasy-data-provider';

// Export all providers for individual use
export { QueryProvider } from './query-provider';
export { FantasyDataProvider, useFantasyData } from './fantasy-data-provider';

// Root providers wrapper component
interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <QueryProvider>
      <FantasyDataProvider>
        {children}
      </FantasyDataProvider>
    </QueryProvider>
  );
} 