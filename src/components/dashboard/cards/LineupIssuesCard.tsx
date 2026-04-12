'use client';

import { FiAlertTriangle } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useRoster } from '@/lib/hooks/useRoster';

interface LineupIssue {
  type: 'injured_active' | 'il_eligible_on_bench' | 'open_slot';
  label: string;
  detail: string;
  severity: 'error' | 'warning';
}

const IL_STATUSES = new Set(['IL', 'IL10', 'IL15', 'IL60', 'DL', 'DL10', 'DL60', 'NA', 'SUSP']);
const IL_SLOTS = new Set(['IL', 'IL+', 'NA']);
const BENCH_OR_INACTIVE = new Set(['BN', 'IL', 'IL+', 'NA']);

export default function LineupIssuesCard() {
  const { teamKey } = useFantasy();
  const { roster, isLoading } = useRoster(teamKey);

  const issues: LineupIssue[] = [];

  for (const player of roster) {
    const pos = player.selected_position;

    // Injured player starting in an active (non-bench, non-IL) slot
    if (player.status && !BENCH_OR_INACTIVE.has(pos)) {
      issues.push({
        type: 'injured_active',
        label: 'Injured Player Starting',
        detail: `${player.name} (${player.status}) is in your active lineup`,
        severity: 'error',
      });
      continue;
    }

    // IL-eligible player sitting on bench instead of an IL slot
    // Only flag if they actually have an IL slot they can move to
    if (
      IL_STATUSES.has(player.status ?? '') &&
      pos === 'BN' &&
      player.eligible_positions.some(p => IL_SLOTS.has(p))
    ) {
      issues.push({
        type: 'il_eligible_on_bench',
        label: 'Move to IL Slot',
        detail: `${player.name} (${player.status}) is on bench — free up a roster spot`,
        severity: 'warning',
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
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-error-100 text-error-800">
                {issues.length} {issues.length === 1 ? 'Issue' : 'Issues'}
              </span>
            </div>
            <div className="space-y-1.5">
              {issues.map((issue, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 p-2 rounded ${issue.severity === 'error' ? 'bg-error-50' : 'bg-accent-50'}`}
                >
                  <span className={`text-sm mt-0.5 shrink-0 ${issue.severity === 'error' ? 'text-error' : 'text-accent'}`}>
                    {issue.severity === 'error' ? '✕' : '!'}
                  </span>
                  <div className="text-xs min-w-0">
                    <p className="font-semibold">{issue.label}</p>
                    <p className="text-muted-foreground mt-0.5">{issue.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <span className="text-success text-2xl">✓</span>
            <p className="text-sm text-muted-foreground mt-2">
              {roster.length > 0 ? 'No lineup issues' : 'No roster data available'}
            </p>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
