import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTeamStatsSeason, getTeamStatsWeek } from '@/lib/fantasy';

/**
 * GET /api/fantasy/team-stats?teamKey=458.l.123456.t.1&week=10
 * Returns team stats — season-to-date (omit week) or for a specific week.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const { searchParams } = new URL(request.url);
    const teamKey = searchParams.get('teamKey');
    const weekStr = searchParams.get('week');

    if (!teamKey) {
      return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    }

    const stats = weekStr
      ? await getTeamStatsWeek(user.id, teamKey, Number(weekStr))
      : await getTeamStatsSeason(user.id, teamKey);

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Team stats API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get team stats' },
      { status: 500 },
    );
  }
}
