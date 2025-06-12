import { FiActivity } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';

export default function RecentActivityCard() {
  // TODO: Add useRecentActivity hook for data fetching
  const isLoading = false;

  return (
    <DashboardCard
      title="Recent Activity"
      icon={FiActivity}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 bg-success rounded-full"></span>
            <span className="text-foreground opacity-60">2h ago</span>
          </div>
          <div className="text-sm">
            <span className="font-medium">Added</span> K. Schwarber
            <span className="text-foreground opacity-60 ml-1">from waivers</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 bg-error rounded-full"></span>
            <span className="text-foreground opacity-60">1d ago</span>
          </div>
          <div className="text-sm">
            <span className="font-medium">Dropped</span> T. Anderson
            <span className="text-foreground opacity-60 ml-1">to waivers</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 bg-primary rounded-full"></span>
            <span className="text-foreground opacity-60">2d ago</span>
          </div>
          <div className="text-sm">
            <span className="font-medium">Traded</span> J. Altuve
            <span className="text-foreground opacity-60 ml-1">+ pick for N. Arenado</span>
          </div>
        </div>

        <div className="pt-2 border-t border-primary-200 dark:border-primary-700">
          <div className="flex justify-between items-center text-xs">
            <span className="text-foreground opacity-60">Moves this week</span>
            <span className="font-medium">3 of 7</span>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
} 