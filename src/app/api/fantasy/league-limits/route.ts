import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getLeagueLimits } from '@/lib/fantasy';

/**
 * GET /api/fantasy/league-limits?leagueKey=458.l.123456
 *
 * Returns the league's weekly caps (transactions, IP, GS). Each field is
 * `null` when the league has no cap configured.
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

    const limits = await getLeagueLimits(user.id, leagueKey);
    return NextResponse.json({ league_key: leagueKey, limits });
  } catch (error) {
    console.error('League limits API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get league limits' },
      { status: 500 },
    );
  }
}
