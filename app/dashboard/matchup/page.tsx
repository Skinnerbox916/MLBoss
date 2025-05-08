'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MatchupDisplay from '../components/MatchupDisplay';

// Create default categories if none are provided
function createDefaultCategories() {
  const defaultCategories = [
    { name: 'R', displayName: 'Runs', id: '1', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'HR', displayName: 'Home Runs', id: '2', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'RBI', displayName: 'RBIs', id: '3', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'SB', displayName: 'Stolen Bases', id: '4', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'AVG', displayName: 'Batting Avg', id: '5', myStat: '.000', opponentStat: '.000', winning: null, isHigherBetter: true },
    { name: 'OPS', displayName: 'OPS', id: '6', myStat: '.000', opponentStat: '.000', winning: null, isHigherBetter: true },
    { name: 'K', displayName: 'Batter Ks', id: '7', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: false },
    { name: 'W', displayName: 'Wins', id: '8', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'SV', displayName: 'Saves', id: '9', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'SO', displayName: 'Pitcher Ks', id: '10', myStat: '0', opponentStat: '0', winning: null, isHigherBetter: true },
    { name: 'ERA', displayName: 'ERA', id: '11', myStat: '0.00', opponentStat: '0.00', winning: null, isHigherBetter: false },
    { name: 'WHIP', displayName: 'WHIP', id: '12', myStat: '0.00', opponentStat: '0.00', winning: null, isHigherBetter: false }
  ];
  return defaultCategories;
}

export default function MatchupPage() {
  const router = useRouter();
  const [teamData, setTeamData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('Matchup Page: Checking authentication');
    if (typeof document !== 'undefined' && !document.cookie.includes('yahoo_client_access_token')) {
      console.log('Matchup Page: No authentication token found, redirecting to login page');
      router.push('/');
      return;
    }

    const fetchData = async () => {
      console.log('Matchup Page: Starting to fetch data');
      setLoading(true);
      try {
        // Fetch team data
        console.log('Matchup Page: Fetching team data from API');
        const teamRes = await fetch('/api/yahoo/team');
        console.log('Matchup Page: Team API response status:', teamRes.status);
        
        if (!teamRes.ok) {
          console.error('Matchup Page: Error response from team API:', teamRes.status);
          throw new Error(`API error: ${teamRes.status}`);
        }
        
        const teamData = await teamRes.json();
        console.log('Matchup Page: Team data structure:', Object.keys(teamData));
        console.log('Matchup Page: Has team property:', 'team' in teamData);
        
        if (teamData.error) {
          console.error('Matchup Page: Error in team data response:', teamData.error);
          setError(teamData.error);
          setLoading(false);
          return;
        }

        // Check if matchup data exists
        if (teamData.team && teamData.team.matchup) {
          console.log('Matchup Page: Found matchup data:', {
            week: teamData.team.matchup.week,
            opponent: teamData.team.matchup.opponentName,
            categories: teamData.team.matchup.categories?.length
          });
        } else {
          console.log('Matchup Page: No matchup data found in the response');
        }

        setTeamData(teamData);
        setLoading(false);
      } catch (err) {
        console.error('Matchup Page: Error fetching data:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      }
    };

    // Fetch data
    fetchData();
  }, [router]);

  // Get safe access to team properties
  const getTeamProperty = (property: string, fallback: any = null) => {
    if (!teamData?.team) {
      console.log(`Matchup Page: teamData.team is missing when accessing ${property}`);
      return fallback;
    }
    return teamData.team[property] !== undefined ? teamData.team[property] : fallback;
  };

  return (
    <div className="w-full">
      {loading ? (
        <MatchupDisplay
          week=""
          opponentName=""
          isLoading={true}
        />
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded">
          {error}
        </div>
      ) : (
        (() => {
          // Always show matchup information, even if there's no matchup data
          const matchupData = getTeamProperty('matchup', {
            week: 'N/A',
            opponentName: 'No Current Matchup',
            opponentLogo: null,
            myScore: '0',
            opponentScore: '0',
            categories: createDefaultCategories()
          });
          
          console.log('Matchup Page: Rendering with matchup data:', {
            week: matchupData.week,
            opponent: matchupData.opponentName,
            categories: matchupData.categories?.length
          });
          
          return (
            <MatchupDisplay
              week={matchupData.week || 'N/A'}
              opponentName={matchupData.opponentName || 'No Current Matchup'}
              opponentLogo={matchupData.opponentLogo || null}
              myScore={matchupData.myScore || '0'}
              opponentScore={matchupData.opponentScore || '0'}
              categories={matchupData.categories || createDefaultCategories()}
              isLoading={false}
            />
          );
        })()
      )}
    </div>
  );
} 