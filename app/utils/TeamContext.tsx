'use client';

import React, { createContext, useState, useEffect, useContext } from 'react';
import { useRouter } from 'next/navigation';

// Define the shape of the context
interface TeamContextType {
  teamData: any;
  loading: boolean;
  error: string | null;
}

// Create context with default values
const TeamContext = createContext<TeamContextType>({
  teamData: null,
  loading: true,
  error: null,
});

// Provider component
export function TeamProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [teamData, setTeamData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(() => {
    // Initialize loading to false if we already have data in localStorage
    if (typeof window !== 'undefined') {
      const storedData = localStorage.getItem('teamData');
      if (storedData) {
        return false;
      }
    }
    return true;
  });
  const [error, setError] = useState<string | null>(null);
  const [dataFetched, setDataFetched] = useState<boolean>(() => {
    // Check if we already have data in localStorage
    if (typeof window !== 'undefined') {
      return localStorage.getItem('teamData') !== null;
    }
    return false;
  });

  // Try to initialize from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && !teamData) {
      const storedData = localStorage.getItem('teamData');
      if (storedData) {
        try {
          setTeamData(JSON.parse(storedData));
          setLoading(false);
        } catch (e) {
          // If parsing fails, we'll fetch again
          localStorage.removeItem('teamData');
          setDataFetched(false);
        }
      }
    }
  }, [teamData]);

  useEffect(() => {
    if (typeof document !== 'undefined' && !document.cookie.includes('yahoo_client_access_token')) {
      console.log('TeamProvider: No yahoo_client_access_token cookie, redirecting to /');
      router.push('/');
      return;
    }

    // Only fetch if we haven't fetched data yet
    if (!dataFetched) {
      const fetchData = async () => {
        try {
          console.log('TeamProvider: Fetching /api/yahoo/team...');
          // Fetch team data for the header
          const teamRes = await fetch('/api/yahoo/team');
          const data = await teamRes.json();
          console.log('TeamProvider: Fetched data:', data);
          
          if (data.error) {
            setError(data.error);
            setLoading(false);
            console.log('TeamProvider: Error from API:', data.error);
            return;
          }

          setTeamData(data);
          setLoading(false);
          setDataFetched(true);
          console.log('TeamProvider: Set teamData and loading=false');
          
          // Store in localStorage for future page loads
          if (typeof window !== 'undefined') {
            localStorage.setItem('teamData', JSON.stringify(data));
            console.log('TeamProvider: Saved teamData to localStorage');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'An error occurred');
          setLoading(false);
          console.log('TeamProvider: Fetch error:', err);
        }
      };

      fetchData();
    }
  }, [router, dataFetched]);

  return (
    <TeamContext.Provider value={{ teamData, loading, error }}>
      {children}
    </TeamContext.Provider>
  );
}

// Custom hook to use the team context
export function useTeam() {
  return useContext(TeamContext);
} 