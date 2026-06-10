'use client';

import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import PointsComingSoon from '@/components/points/PointsComingSoon';
import LeagueManager from './LeagueManager';

/** Routes /league by active-league mode. Points view (points leaderboard) is
 *  follow-up. */
export default function LeagueModeRouter() {
  const { mode, isLoading, leagueKey } = useActiveLeague();
  if (isLoading && !leagueKey) return null;
  if (mode === 'points') return <PointsComingSoon page="League" />;
  return <LeagueManager />;
}
