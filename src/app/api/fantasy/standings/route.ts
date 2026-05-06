import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getLeagueStandings } from '@/lib/fantasy';

/**
 * GET /api/fantasy/standings?leagueKey=458.l.123456
 * Returns league standings with team records and ranks.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const { searchParams } = new URL(request.url);
    const leagueKey = searchParams.get('leagueKey');

    if (!leagueKey) {
      return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });
    }

    const standings = await getLeagueStandings(user.id, leagueKey);

    return NextResponse.json({ league_key: leagueKey, standings });
  } catch (error) {
    console.error('Standings API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get standings' },
      { status: 500 },
    );
  }
}
