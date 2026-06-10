import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getScoringProfile, invalidateCachePattern, CACHE_CATEGORIES } from '@/lib/fantasy';
import { optimizePointsWeek } from '@/lib/points/optimizeWeek';

/**
 * POST /api/points/optimize-week
 * Body: { teamKey, leagueKey, scoringType }
 *
 * Sets the optimal points lineup in Yahoo for every remaining day of the
 * current fantasy week. Mutation — only the team owner's session can write.
 * 400s for non-points leagues.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    const body = await request.json().catch(() => ({}));
    const teamKey: string | undefined = body.teamKey;
    const leagueKey: string | undefined = body.leagueKey;
    const scoringType: string = body.scoringType ?? '';

    if (!teamKey) return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    if (!leagueKey) return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });

    const profile = await getScoringProfile(user.id, leagueKey, scoringType);
    if (profile.mode !== 'points') {
      return NextResponse.json({ error: `League ${leagueKey} is ${profile.mode}, not points` }, { status: 400 });
    }

    const result = await optimizePointsWeek(user.id, leagueKey, teamKey, profile);

    // The week's lineups changed → drop the cached team analysis so the
    // dashboard / roster / pitchers tab reflect the new lineup immediately.
    await invalidateCachePattern(`${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:points-team:${leagueKey}:${teamKey}`);

    return NextResponse.json(result);
  } catch (error) {
    console.error('/api/points/optimize-week failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to optimize week' },
      { status: 500 },
    );
  }
}
