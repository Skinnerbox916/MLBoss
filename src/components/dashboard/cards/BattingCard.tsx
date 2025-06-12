import { GiBaseballBat } from 'react-icons/gi';
import DashboardCard from '../DashboardCard';

export default function BattingCard() {
  // TODO: Add useBattingStats hook for data fetching
  const isLoading = false;

  return (
    <DashboardCard
      title="Batting"
      icon={GiBaseballBat}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-foreground opacity-60">AVG</p>
            <p className="text-lg font-semibold">.287</p>
          </div>
          <div>
            <p className="text-foreground opacity-60">HR</p>
            <p className="text-lg font-semibold">23</p>
          </div>
          <div>
            <p className="text-foreground opacity-60">RBI</p>
            <p className="text-lg font-semibold">67</p>
          </div>
          <div>
            <p className="text-foreground opacity-60">SB</p>
            <p className="text-lg font-semibold">12</p>
          </div>
        </div>
        
        <div className="pt-2 border-t border-primary-200 dark:border-primary-700">
          <p className="text-xs text-foreground opacity-60 mb-1">This Week</p>
          <div className="flex justify-between text-sm">
            <span>vs League Avg</span>
            <span className="text-success">+15%</span>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
} 