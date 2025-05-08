'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Navigation from './components/Navigation';
import TeamHeader from './components/TeamHeader';

// Custom layout styles
const layoutStyles = `
  .dashboard-layout {
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

export default function DashboardLayout({
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

  const handleLogout = () => {
    fetch('/api/auth/logout')
      .then(() => {
        router.push('/');
      });
  };

  return (
    <>
      <style jsx>{layoutStyles}</style>
      <div className="dashboard-layout">
        {/* Sidebar */}
        <div className="sidebar-container">
          <Navigation onLogout={handleLogout} />
        </div>
        
        {/* Main content */}
        <div className="main-content">
          <div className="content-container">
            {error ? (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
                {error}
              </div>
            ) : null}
            
            {/* Team header displayed on all dashboard pages */}
            <div className="mb-6">
              <TeamHeader teamData={teamData} loading={loading} />
            </div>
            
            {children}
          </div>
        </div>
      </div>
    </>
  );
} 