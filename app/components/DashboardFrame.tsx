'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Layout } from './layout';

export default function DashboardFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [teamData, setTeamData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataFetched, setDataFetched] = useState(false);

  useEffect(() => {
    if (typeof document !== 'undefined' && !document.cookie.includes('yahoo_client_access_token')) {
      router.push('/');
      return;
    }

    // Only fetch if we haven't fetched data yet
    if (!dataFetched) {
      const fetchData = async () => {
        try {
          // Fetch team data for the header
          const teamRes = await fetch('/api/yahoo/team');
          const data = await teamRes.json();
          
          if (data.error) {
            setError(data.error);
            setLoading(false);
            return;
          }

          setTeamData(data);
          setLoading(false);
          setDataFetched(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'An error occurred');
          setLoading(false);
        }
      };

      fetchData();
    }
  }, [router, dataFetched]);

  return (
    <>
      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      ) : null}
      
      {/* Using the new centralized Layout component */}
      <Layout teamData={teamData} loading={loading}>
        {children}
      </Layout>
    </>
  );
} 