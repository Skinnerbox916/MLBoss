import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getMovesBudget } from '@/lib/fantasy';

/**
 * GET /api/fantasy/moves?leagueKey=...&teamKey=...
 *
 * Weekly transaction budget for a team: league add cap + adds used + adds
 * left. Mode-agnostic (categories and points leagues both have the cap);
 * any page that wants to surface "moves left" consumes this.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const leagueKey = searchParams.get('leagueKey');
    const teamKey = searchParams.get('teamKey');
    if (!leagueKey) return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });
    if (!teamKey) return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });

    const budget = await getMovesBudget(session.user.id, leagueKey, teamKey);
    return NextResponse.json({ leagueKey, teamKey, ...budget });
  } catch (error) {
    console.error('/api/fantasy/moves failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch moves budget' },
      { status: 500 },
    );
  }
}
