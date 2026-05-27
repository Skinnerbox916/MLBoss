import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getLeagueStandings } from '@/lib/fantasy';
import { getTeamStatsSeason } from '@/lib/fantasy/teamStats';
import { withCache, CACHE_CATEGORIES } from '@/lib/fantasy/cache';
import { computeTeamEngagements, type TeamEngagement } from '@/lib/league/engagement';

/**
 * GET /api/league/[leagueKey]/engagements
 *
 * Per-team manager-engagement ratios for the league. Each team's YTD
 * plate appearances (back-calculated from `H / AVG / 0.91`) normalized
 * against the most-engaged team (1.0 = league leader). Captures the
 * "set-and-forget" / absentee-manager variance the talent model can't
 * see — a low-engagement opponent accrues fewer counting-cat PAs all week.
 *
 * Consumed client-side by `useLeagueEngagements`, which feeds
 * `useCorrectedMatchupAnalysis` so the matchup game plan discounts an
 * absentee opponent's counting projection. See
 * [engagement.ts](../../../../lib/league/engagement.ts).
 *
 * League-scoped, viewer-independent, so it caches once per league. YTD
 * pace moves slowly; SEMI_DYNAMIC.ttlLong (1 h) is plenty.
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

    const engagements = await withCache(
      `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:league-engagements:${leagueKey}`,
      CACHE_CATEGORIES.SEMI_DYNAMIC.ttlLong,
      async (): Promise<TeamEngagement[]> => {
        const standings = await getLeagueStandings(userId, leagueKey);
        const teamStatsAll = await Promise.all(
          standings.map(t => getTeamStatsSeason(userId, t.team_key).catch(() => null)),
        );
        return computeTeamEngagements(
          standings.map((t, i) => ({
            teamKey: t.team_key,
            teamName: t.name,
            stats: teamStatsAll[i],
          })),
        );
      },
    );

    return NextResponse.json({ engagements });
  } catch (error) {
    console.error('league engagements API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute engagements' },
      { status: 500 },
    );
  }
}
