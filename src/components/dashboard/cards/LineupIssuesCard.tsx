import { FiAlertTriangle } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';

export default function LineupIssuesCard() {
  // TODO: Add useLineupIssues hook for data fetching
  const isLoading = false;
  const issueCount = 3;

  return (
    <DashboardCard
      title="Lineup Issues"
      icon={FiAlertTriangle}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        {issueCount > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-error-100 text-error-800">
                {issueCount} Issues
              </span>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-2 bg-accent-50 rounded">
                <span className="text-accent text-sm">⚠️</span>
                <div className="text-xs">
                  <p className="font-medium">Bench Player Starting</p>
                  <p className="text-foreground opacity-80">J. Rodriguez is on bench but playing today</p>
                </div>
              </div>
              
              <div className="flex items-start gap-2 p-2 bg-error-50 rounded">
                <span className="text-error text-sm">❌</span>
                <div className="text-xs">
                  <p className="font-medium">Injured Player Active</p>
                  <p className="text-foreground opacity-80">M. Trout (DTD) in starting lineup</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <span className="text-success text-2xl">✅</span>
            <p className="text-sm text-foreground opacity-80 mt-2">
              No lineup issues
            </p>
          </div>
        )}
      </div>
    </DashboardCard>
  );
} 