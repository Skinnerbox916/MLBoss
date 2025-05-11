'use client';

import { useTeam } from '@/app/utils/TeamContext';
import Layout from './Layout';
import { ErrorBoundary } from '../ErrorBoundary';

export default function DashboardFrame({ children }: { children: React.ReactNode }) {
  const { teamData, loading, error } = useTeam();

  return (
    <ErrorBoundary>
      {error && (
        <div className="px-4 py-3 rounded mb-4 bg-yellow-50 border border-yellow-200 text-yellow-700">
          {error}
        </div>
      )}
      
      <Layout teamData={teamData} loading={loading}>
        {children}
      </Layout>
    </ErrorBoundary>
  );
} 