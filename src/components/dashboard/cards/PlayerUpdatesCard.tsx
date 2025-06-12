import { FiBell } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';

export default function PlayerUpdatesCard() {
  // TODO: Add usePlayerUpdates hook for data fetching
  const isLoading = false;

  return (
    <DashboardCard
      title="Player Updates"
      icon={FiBell}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <div className="space-y-3">
          <div className="border-l-4 border-error pl-3 py-1">
            <div className="flex justify-between items-start mb-1">
              <span className="font-medium text-sm">Mike Trout</span>
              <span className="text-xs text-foreground opacity-60">2h ago</span>
            </div>
            <p className="text-xs text-foreground opacity-80">
              Placed on 10-day IL with wrist injury. Expected return in 2-3 weeks.
            </p>
            <span className="inline-block mt-1 px-2 py-0.5 bg-error-100 text-error-800 text-xs rounded">
              Injury
            </span>
          </div>

          <div className="border-l-4 border-success pl-3 py-1">
            <div className="flex justify-between items-start mb-1">
              <span className="font-medium text-sm">Juan Soto</span>
              <span className="text-xs text-foreground opacity-60">4h ago</span>
            </div>
            <p className="text-xs text-foreground opacity-80">
              Activated from IL, expected to start tonight vs. Red Sox.
            </p>
            <span className="inline-block mt-1 px-2 py-0.5 bg-success-100 text-success-800 text-xs rounded">
              Activated
            </span>
          </div>

          <div className="border-l-4 border-primary pl-3 py-1">
            <div className="flex justify-between items-start mb-1">
              <span className="font-medium text-sm">Ronald Acuña Jr.</span>
              <span className="text-xs text-foreground opacity-60">6h ago</span>
            </div>
            <p className="text-xs text-foreground opacity-80">
              Manager confirms he&apos;ll bat leadoff in upcoming series.
            </p>
            <span className="inline-block mt-1 px-2 py-0.5 bg-primary-100 text-primary-800 text-xs rounded">
              Lineup
            </span>
          </div>
        </div>
        
        <div className="pt-2 border-t border-primary-200 dark:border-primary-700">
          <button className="text-xs text-primary hover:underline">
            View all updates →
          </button>
        </div>
      </div>
    </DashboardCard>
  );
} 