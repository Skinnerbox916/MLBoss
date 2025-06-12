import { FiUsers } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';

export default function MatchupCard() {
  // TODO: Add useCurrentMatchup hook for data fetching
  const isLoading = false;

  return (
    <DashboardCard
      title="This Week's Matchup"
      icon={FiUsers}
      size="lg"
      isLoading={isLoading}
    >
      <div className="space-y-4">
        <div className="text-sm text-foreground opacity-80">
          <p className="font-medium">This Week&apos;s Opponent</p>
          <p className="text-lg font-semibold text-foreground">
            Team Name
          </p>
        </div>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-foreground opacity-60">Record</p>
            <p className="font-medium">7-3</p>
          </div>
          <div>
            <p className="text-foreground opacity-60">Points</p>
            <p className="font-medium">1,247</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm text-foreground opacity-80 mb-2">
            Key Matchup Categories
          </p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Home Runs</span>
              <span className="text-success">+2</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>ERA</span>
              <span className="text-error">-0.15</span>
            </div>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
} 