import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getLeagueScoreboard } from '@/lib/fantasy';

/**
 * GET /api/fantasy/scoreboard?leagueKey=458.l.123456&week=10
 * Returns all matchups for a given week (omit week for current).
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const { searchParams } = new URL(request.url);
    const leagueKey = searchParams.get('leagueKey');
    const weekStr = searchParams.get('week');

    if (!leagueKey) {
      return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });
    }

    const week = weekStr ? Number(weekStr) : undefined;
    const matchups = await getLeagueScoreboard(user.id, leagueKey, week);

    const resolvedWeek = week ?? matchups?.[0]?.week;
    return NextResponse.json({ league_key: leagueKey, week: resolvedWeek, matchups });
  } catch (error) {
    console.error('Scoreboard API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get scoreboard' },
      { status: 500 },
    );
  }
}
