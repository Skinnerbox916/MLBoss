import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getScoringProfile } from '@/lib/fantasy';

/**
 * GET /api/points/profile?leagueKey=...&scoringType=...
 *
 * Returns the resolved ScoringProfile (mode + per-stat point weights) for a
 * league, so client-side scoring (the unified lineup's points scorer) can run
 * without re-deriving weights. Cached static-tier server-side already.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const leagueKey = searchParams.get('leagueKey');
    const scoringType = searchParams.get('scoringType') ?? '';
    if (!leagueKey) return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });

    const profile = await getScoringProfile(session.user.id, leagueKey, scoringType);
    return NextResponse.json(profile);
  } catch (error) {
    console.error('/api/points/profile failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve scoring profile' },
      { status: 500 },
    );
  }
}
