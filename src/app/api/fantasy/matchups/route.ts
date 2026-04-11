import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTeamMatchups } from '@/lib/fantasy';

/**
 * GET /api/fantasy/matchups?teamKey=458.l.123456.t.1&weeks=1,2,3
 * Returns matchup schedule for a team. Omit weeks for full schedule.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const { searchParams } = new URL(request.url);
    const teamKey = searchParams.get('teamKey');
    const weeksStr = searchParams.get('weeks');

    if (!teamKey) {
      return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    }

    const weeks = weeksStr ? weeksStr.split(',').map(Number) : undefined;
    const matchups = await getTeamMatchups(user.id, teamKey, weeks);

    return NextResponse.json({ team_key: teamKey, matchups });
  } catch (error) {
    console.error('Matchups API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get matchups' },
      { status: 500 },
    );
  }
}
