'use client';

import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import PointsComingSoon from '@/components/points/PointsComingSoon';
import StreamingManager from './StreamingManager';

/** Routes /streaming by active-league mode. Points view is follow-up. */
export default function StreamingModeRouter() {
  const { mode, isLoading, leagueKey } = useActiveLeague();
  if (isLoading && !leagueKey) return null;
  if (mode === 'points') return <PointsComingSoon page="Streaming" />;
  return <StreamingManager />;
}
