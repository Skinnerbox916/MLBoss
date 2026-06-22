'use client';

import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import PointsStreamingManager from './PointsStreamingManager';
import StreamingManager from './StreamingManager';

/** Routes /streaming by active-league mode. */
export default function StreamingModeRouter() {
  const { mode, isLoading, leagueKey } = useActiveLeague();
  if (isLoading && !leagueKey) return null;
  if (mode === 'points') return <PointsStreamingManager />;
  return <StreamingManager />;
}
