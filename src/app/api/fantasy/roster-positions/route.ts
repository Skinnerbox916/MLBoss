import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getLeagueRosterPositions } from '@/lib/fantasy';

/**
 * GET /api/fantasy/roster-positions?leagueKey=469.l.108611
 * Returns the league's roster slot template (positions + counts) so the UI
 * can render the right number of slots per league.
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

    const positions = await getLeagueRosterPositions(user.id, leagueKey);
    return NextResponse.json({ league_key: leagueKey, positions });
  } catch (error) {
    console.error('Roster positions API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get roster positions' },
      { status: 500 },
    );
  }
}
