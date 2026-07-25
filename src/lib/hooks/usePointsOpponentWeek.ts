import useSWR from 'swr';
import { fetcher } from './fetcher';
import { useActiveLeague } from './useActiveLeague';
import { useLeagueStreamRates } from './useLeagueStreamRates';
import { usePointsStreaming } from './usePointsStreaming';
import { expectedStreamPoints } from '@/lib/points/streamVolume';
import type { WeekTarget } from '@/lib/dashboard/weekRange';
import type { PointsTeamResponse } from './usePointsTeam';

/** Inclusive day count between two YYYY-MM-DD stamps; 0 when either is absent. */
function windowLength(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * The OPPONENT's projected remaining points — the same points team analysis,
 * roster-only (`includeFA=0`, a fraction of the full pipeline), PLUS what
 * their **expected streamed starts** are worth.
 *
 * That second term is the points twin of the categories opponent-stream
 * model, and it exists for the same reason: `includeFA=0` literally means
 * "assume they stand pat", which for a manager who adds a starter every
 * other day understates their week badly. The rate comes from the shared
 * demonstrated-SP-add estimator (`useLeagueStreamRates`), pro-rated over the
 * window's remaining days by the shared `proRateStreamStarts`; the per-start
 * value is this league's own FA-pool mean (`faStartPointsAvg`) rather than a
 * constant, because points scoring profiles differ too much for one number.
 * By-side rule and rationale: [streamVolume.ts](../projection/streamVolume.ts)
 * and docs/points-leagues.md#opponent-stream-volume.
 *
 * The streaming fetch this reads is already warm on the points dashboard (the
 * top-move tile drives it) and never blocks here: until it lands,
 * `streamPoints` is 0 and callers see the roster-only number, exactly as
 * before.
 *
 * Pass the opponent teamKey from the scoreboard; null until known. Feeds the
 * points marquee's projected-final math, the points brief, and the points
 * Next Week card (`week: 'next'`).
 */
export function usePointsOpponentWeek(
  leagueKey: string | undefined,
  opponentTeamKey: string | undefined,
  scoringType: string | undefined,
  week: WeekTarget = 'current',
) {
  const canFetch = Boolean(leagueKey && opponentTeamKey);
  const url = canFetch
    ? `/api/points/team?teamKey=${encodeURIComponent(opponentTeamKey!)}&leagueKey=${encodeURIComponent(leagueKey!)}&scoringType=${encodeURIComponent(scoringType ?? '')}&week=${week}&includeFA=0`
    : null;

  const { data, error, isLoading } = useSWR<PointsTeamResponse>(url, fetcher, {
    revalidateOnFocus: false,
  });

  // My own teamKey drives the streaming analysis (it prices the FA pool
  // against my roster); only its league-level `faStartPointsAvg` is read here.
  const { teamKey: myTeamKey } = useActiveLeague();
  const { data: streaming } = usePointsStreaming(leagueKey, myTeamKey, scoringType);
  const { startsByTeamKey } = useLeagueStreamRates(leagueKey);

  const rosterOnly = data?.weekProjectedPoints;
  const weekLength = windowLength(data?.week.start, data?.week.end);
  const { starts: streamStarts, points: streamPoints } = expectedStreamPoints({
    startsPerWeek: opponentTeamKey ? startsByTeamKey.get(opponentTeamKey) ?? 0 : 0,
    // A next-week window hasn't started, so all of it is remaining.
    remainingDays: week === 'next' ? weekLength : data?.week.remainingDays ?? 0,
    faStartPointsAvg: streaming?.faStartPointsAvg ?? 0,
  });

  return {
    /** Roster-only projection plus expected-stream points. Undefined until
     *  the opponent analysis resolves. */
    projectedRemaining: rosterOnly !== undefined ? rosterOnly + streamPoints : undefined,
    /** The roster-only figure, for surfaces that want to show the split. */
    rosterOnlyRemaining: rosterOnly,
    /** Points attributed to their expected streamed starts (0 until the
     *  streaming analysis resolves). */
    streamPoints,
    /** Their expected streamed starts over the window. */
    streamStarts,
    isLoading,
    isError: !!error,
  };
}
