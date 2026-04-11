import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getAvailablePitchers } from '@/lib/fantasy';

/**
 * GET /api/fantasy/players?leagueKey=458.l.123456&position=P
 * Returns available players (free agents + waivers).
 * Currently only supports position=P for pitcher streaming.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const { searchParams } = new URL(request.url);
    const leagueKey = searchParams.get('leagueKey');
    const position = searchParams.get('position');

    if (!leagueKey) {
      return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });
    }

    if (position !== 'P') {
      return NextResponse.json({ error: 'Only position=P is currently supported' }, { status: 400 });
    }

    const players = await getAvailablePitchers(user.id, leagueKey);

    return NextResponse.json({ league_key: leagueKey, position, players });
  } catch (error) {
    console.error('Players API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get players' },
      { status: 500 },
    );
  }
}
