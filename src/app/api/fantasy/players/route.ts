import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getAvailablePitchers, getTopAvailableBatters, getAvailableBatters } from '@/lib/fantasy';

/**
 * GET /api/fantasy/players?leagueKey=458.l.123456&position=P|B
 * Returns available players (free agents + waivers).
 *   position=P  — pitchers for the streaming board
 *   position=B  — top available batters for the waiver dashboard card
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

    if (position === 'P') {
      const players = await getAvailablePitchers(user.id, leagueKey);
      return NextResponse.json({ league_key: leagueKey, position, players });
    }

    if (position === 'B') {
      const extended = searchParams.get('count') === 'extended';
      const players = extended
        ? await getAvailableBatters(user.id, leagueKey)
        : await getTopAvailableBatters(user.id, leagueKey);
      return NextResponse.json({ league_key: leagueKey, position, players });
    }

    return NextResponse.json({ error: 'position must be P or B' }, { status: 400 });
  } catch (error) {
    console.error('Players API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get players' },
      { status: 500 },
    );
  }
}
