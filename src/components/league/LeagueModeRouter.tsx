'use client';

import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import LeagueManager from './LeagueManager';
import PointsLeagueView from './PointsLeagueView';

/** Routes /league by active-league mode. Both views mount the shared
 *  StandingsTable; categories adds stat rankings, points gets a native
 *  rankings section as follow-up. */
export default function LeagueModeRouter() {
  const { mode, isLoading, leagueKey, teamKey } = useActiveLeague();
  if (isLoading && !leagueKey) return null;
  if (mode === 'points') return <PointsLeagueView leagueKey={leagueKey} teamKey={teamKey} />;
  return <LeagueManager />;
}
