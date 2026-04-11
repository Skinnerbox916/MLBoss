'use client';

import { FiCalendar } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';

export default function NextWeekCard() {
  const { leagueKey, teamKey, currentWeek } = useFantasy();
  const nextWeek = currentWeek ? Number(currentWeek) + 1 : undefined;
  const { matchups, isLoading } = useScoreboard(leagueKey, nextWeek);

  // Find the user's next-week matchup
  const userMatchup = matchups.find(m =>
    m.teams.some(t => t.team_key === teamKey),
  );
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  return (
    <DashboardCard
      title="Next Week Preview"
      icon={FiCalendar}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        {userMatchup ? (
          <>
            <div className="text-sm">
              <div className="flex justify-between items-center mb-2">
                <span className="text-muted-foreground">Week</span>
                <span className="font-medium">{nextWeek ?? '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Opponent</span>
                <span className="font-medium">{opponent?.name ?? 'TBD'}</span>
              </div>
            </div>

            {userMatchup.is_playoffs && (
              <div className="pt-2">
                <span className="px-2 py-1 bg-accent-100 text-accent-800 text-xs rounded font-medium">
                  Playoffs
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {nextWeek ? 'No matchup data for next week' : 'Season week info unavailable'}
          </p>
        )}
      </div>
    </DashboardCard>
  );
}
