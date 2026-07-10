import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getScoringProfile, withCache, CACHE_CATEGORIES } from '@/lib/fantasy';
import { analyzePointsTeam } from '@/lib/points/analyzeTeam';
import type { WeekTarget } from '@/lib/dashboard/weekRange';

/**
 * GET /api/points/team?teamKey=...&leagueKey=...&scoringType=...&week=current|next
 *
 * Points-league team analysis for the UI: ranked roster + FA values, value
 * over replacement, suggested moves, and the optimal lineup for the next
 * playable day. 400s for non-points leagues (the UI only calls this when
 * `scoringProfile.mode === 'points'`).
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    const { searchParams } = new URL(request.url);
    const teamKey = searchParams.get('teamKey');
    const leagueKey = searchParams.get('leagueKey');
    const scoringType = searchParams.get('scoringType') ?? '';
    const week: WeekTarget = searchParams.get('week') === 'next' ? 'next' : 'current';

    if (!teamKey) return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    if (!leagueKey) return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });

    const profile = await getScoringProfile(user.id, leagueKey, scoringType);
    if (profile.mode !== 'points') {
      return NextResponse.json({ error: `League ${leagueKey} is ${profile.mode}, not points` }, { status: 400 });
    }

    // Cache the assembled analysis so the dashboard / roster / lineup-pitchers
    // tab don't each re-run the full pipeline. Semi-dynamic (5 min): roster +
    // FA pool shift with transactions; the optimize-week route busts this key
    // after it writes a lineup. Per-user-scoped via the team key.
    const analysis = await withCache(
      `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:points-team:${leagueKey}:${teamKey}:${week}`,
      CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
      () => analyzePointsTeam(user.id, leagueKey, teamKey, profile, { week }),
    );
    return NextResponse.json({ leagueKey, teamKey, scoringType, ...analysis });
  } catch (error) {
    console.error('/api/points/team failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze points team' },
      { status: 500 },
    );
  }
}
