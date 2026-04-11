'use client';

import { FiAlertTriangle } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useRoster } from '@/lib/hooks/useRoster';

interface LineupIssue {
  type: 'injured_active' | 'bench_could_start';
  label: string;
  detail: string;
  severity: 'error' | 'warning';
}

export default function LineupIssuesCard() {
  const { teamKey } = useFantasy();
  const { roster, isLoading } = useRoster(teamKey);

  // Detect lineup issues from real roster data
  const issues: LineupIssue[] = [];

  for (const player of roster) {
    // Injured player in active lineup (not on bench/IL slot)
    if (player.status && player.selected_position !== 'BN' && player.selected_position !== 'IL' && player.selected_position !== 'IL+' && player.selected_position !== 'NA') {
      issues.push({
        type: 'injured_active',
        label: 'Injured Player Active',
        detail: `${player.name} (${player.status}) in starting lineup`,
        severity: 'error',
      });
    }
  }

  return (
    <DashboardCard
      title="Lineup Issues"
      icon={FiAlertTriangle}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        {issues.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-error-100 text-error-800">
                {issues.length} {issues.length === 1 ? 'Issue' : 'Issues'}
              </span>
            </div>

            <div className="space-y-2">
              {issues.map((issue, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 p-2 ${issue.severity === 'error' ? 'bg-error-50' : 'bg-accent-50'} rounded`}
                >
                  <span className={`text-sm ${issue.severity === 'error' ? 'text-error' : 'text-accent'}`}>
                    {issue.severity === 'error' ? '\u274C' : '\u26A0\uFE0F'}
                  </span>
                  <div className="text-xs">
                    <p className="font-medium">{issue.label}</p>
                    <p className="text-muted-foreground">{issue.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <span className="text-success text-2xl">{'\u2705'}</span>
            <p className="text-sm text-muted-foreground mt-2">
              {roster.length > 0 ? 'No lineup issues' : 'No roster data available'}
            </p>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
