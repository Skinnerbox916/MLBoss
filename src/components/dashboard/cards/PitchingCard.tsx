import { FiTarget } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';

export default function PitchingCard() {
  // TODO: Add usePitchingStats hook for data fetching
  const isLoading = false;

  return (
    <DashboardCard
      title="Pitching"
      icon={FiTarget}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-foreground opacity-60">ERA</p>
            <p className="text-lg font-semibold">3.45</p>
          </div>
          <div>
            <p className="text-foreground opacity-60">WHIP</p>
            <p className="text-lg font-semibold">1.23</p>
          </div>
          <div>
            <p className="text-foreground opacity-60">K</p>
            <p className="text-lg font-semibold">178</p>
          </div>
          <div>
            <p className="text-foreground opacity-60">SV</p>
            <p className="text-lg font-semibold">8</p>
          </div>
        </div>
        
        <div className="pt-2 border-t border-primary-200 dark:border-primary-700">
          <p className="text-xs text-foreground opacity-60 mb-1">This Week</p>
          <div className="flex justify-between text-sm">
            <span>vs League Avg</span>
            <span className="text-error">-8%</span>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
} 