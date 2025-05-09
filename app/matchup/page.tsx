'use client';
import { useRouter } from 'next/navigation';
import MatchupDisplay from './components/MatchupDisplay';
import { useMatchupStats } from '@/app/utils/hooks';
import { CategoryStat } from '@/app/utils/stats';

// Helper to ensure CategoryStat has string-type myStat and opponentStat for MatchupDisplay
const convertCategories = (cats: CategoryStat[]): any[] => {
  return cats.map(cat => ({
    ...cat,
    myStat: String(cat.myStat),
    opponentStat: String(cat.opponentStat)
  }));
};

export default function MatchupPage() {
  const router = useRouter();
  
  // Use the shared hook to get matchup stats
  const { 
    categories, 
    opponentName, 
    week,
    myScore, 
    opponentScore,
    myTeamLogo,
    opponentLogo,
    loading,
    error
  } = useMatchupStats();

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
        <MatchupDisplay
          week={week || 'N/A'}
          opponentName={opponentName || 'No Current Matchup'}
          myScore={String(myScore || '0')}
          opponentScore={String(opponentScore || '0')}
          categories={convertCategories(categories || [])}
          opponentLogo={opponentLogo || undefined}
          myTeamLogo={myTeamLogo || undefined}
          isLoading={false}
        />
      )}
    </div>
  );
} 