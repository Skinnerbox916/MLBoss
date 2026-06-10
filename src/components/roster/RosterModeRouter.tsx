'use client';

import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import Skeleton from '@/components/ui/Skeleton';
import RosterManager from './RosterManager';
import PointsRosterView from './PointsRosterView';

/**
 * Picks the /roster experience by the ACTIVE league's scoring mode (the
 * primary league, or whatever the account-menu LeagueSwitcher selected).
 * Points → value/VOR/moves view; categories → the existing chase/hold/punt
 * depth-chart manager. Routing here (not inside a component) keeps each view's
 * hooks from running in the other's mode. All share the cached
 * `/api/fantasy/context` SWR response, so this adds no extra fetch.
 *
 * NOTE: `RosterManager` still reads the PRIMARY league from context directly,
 * so switching to a non-primary CATEGORIES league won't retarget it yet — the
 * switcher is wired for the points path first. Full categories retargeting is
 * follow-up.
 */
export default function RosterModeRouter() {
  const { leagueKey, teamKey, scoringType, mode, isLoading } = useActiveLeague();

  if (isLoading && !leagueKey) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (mode === 'points') {
    return (
      <div className="p-6">
        <PointsRosterView leagueKey={leagueKey} teamKey={teamKey} scoringType={scoringType} />
      </div>
    );
  }

  return <RosterManager />;
}
