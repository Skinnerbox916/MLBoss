import { FiCalendar } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';

export default function NextWeekCard() {
  // TODO: Add useNextWeekPreview hook for data fetching
  const isLoading = false;

  return (
    <DashboardCard
      title="Next Week Preview"
      icon={FiCalendar}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <div className="text-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="text-foreground opacity-80">Matchup Period</span>
            <span className="font-medium">Jun 17-23</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-foreground opacity-80">Opponent</span>
            <span className="font-medium">The Sluggers</span>
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-primary-200 dark:border-primary-700">
          <div className="text-xs text-foreground opacity-60 mb-1">Game Counts</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-primary-50 p-2 rounded">
              <div className="font-medium">Your Team</div>
              <div className="text-lg font-bold text-success">42 games</div>
            </div>
            <div className="bg-primary-50 p-2 rounded">
              <div className="font-medium">Opponent</div>
              <div className="text-lg font-bold text-error">38 games</div>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-foreground opacity-60">Key Focuses</div>
          <div className="flex flex-wrap gap-1">
            <span className="px-2 py-1 bg-accent-100 text-accent-800 text-xs rounded">
              SP Starts
            </span>
            <span className="px-2 py-1 bg-primary-100 text-primary-800 text-xs rounded">
              SB Opps
            </span>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
} 