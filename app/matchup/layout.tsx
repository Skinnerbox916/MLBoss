'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import TeamHeader from '../components/TeamHeader';

export default function MatchupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [teamData, setTeamData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined' && !document.cookie.includes('yahoo_client_access_token')) {
      router.push('/');
      return;
    }

    const fetchData = async () => {
      try {
        // Fetch team data for the header
        const teamRes = await fetch('/api/yahoo/team');
        const teamData = await teamRes.json();
        
        if (teamData.error) {
          setError(teamData.error);
          setLoading(false);
          return;
        }

        setTeamData(teamData);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      }
    };

    fetchData();
  }, [router]);

  return (
    <>
      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      ) : null}
      
      {/* Team header displayed on all matchup pages */}
      <div className="mb-6">
        <TeamHeader teamData={teamData} loading={loading} />
      </div>
      
      {children}
    </>
  );
} 