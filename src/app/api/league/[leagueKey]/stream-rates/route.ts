import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getLeagueTeams } from '@/lib/fantasy';
import { getLeagueLimits } from '@/lib/fantasy/limits';
import { getLeagueTransactions } from '@/lib/fantasy/transactions';
import { withCache, CACHE_CATEGORIES } from '@/lib/fantasy/cache';
import { computeTeamStreamRates, type TeamStreamRate } from '@/lib/projection/streamVolume';

/**
 * GET /api/league/[leagueKey]/stream-rates
 *
 * Per-team expected streamed starts for the upcoming week, from demonstrated
 * behavior in the league's transaction feed (recency-weighted SP adds per
 * week, clamped by the weekly add cap). Consumed client-side by
 * `useLeagueStreamRates` → `useCorrectedMatchupAnalysis`'s next-week pivot,
 * so both sides' pitcher projections reflect the streaming each manager
 * actually does instead of assuming everyone stands pat.
 *
 * Rationale + estimator: [streamVolume.ts](../../../../../lib/projection/streamVolume.ts)
 * and docs/projection.md#expected-streamed-starts.
 *
 * League-scoped and viewer-independent, so it caches once per league.
 * Composes three already-cached fetches; the computed result caches at
 * SEMI_DYNAMIC.ttlLong (1 h) because a 3-week-half-life rate barely moves
 * within a day — one fresh add cannot meaningfully change it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ leagueKey: string }> },
) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const { leagueKey } = await params;

    const streamRates = await withCache(
      `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:league-stream-rates:${leagueKey}`,
      CACHE_CATEGORIES.SEMI_DYNAMIC.ttlLong,
      async (): Promise<TeamStreamRate[]> => {
        const [transactions, teams, limits] = await Promise.all([
          getLeagueTransactions(userId, leagueKey),
          getLeagueTeams(userId, leagueKey),
          getLeagueLimits(userId, leagueKey),
        ]);
        return computeTeamStreamRates({
          transactions,
          teamKeys: teams.map(t => t.team_key),
          weeklyAddCap: limits.maxWeeklyAdds,
          nowMs: Date.now(),
        });
      },
    );

    return NextResponse.json({ streamRates });
  } catch (error) {
    console.error('league stream-rates API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute stream rates' },
      { status: 500 },
    );
  }
}
