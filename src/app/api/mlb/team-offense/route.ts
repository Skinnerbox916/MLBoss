import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTeamOffense } from '@/lib/mlb/teams';

/**
 * GET /api/mlb/team-offense?teamIds=109,110,111
 * Returns offensive profiles for the given MLB team IDs (comma-separated).
 * Max 30 teams per request.
 */
export async function GET(request: Request) {
  try {
    await getSession().then(s => { if (!s.user) throw new Error('Unauthorized'); });

    const { searchParams } = new URL(request.url);
    const teamIdsParam = searchParams.get('teamIds');

    if (!teamIdsParam) {
      return NextResponse.json({ error: 'teamIds is required' }, { status: 400 });
    }

    const teamIds = teamIdsParam.split(',').map(Number).filter(n => !isNaN(n)).slice(0, 30);

    const results = await Promise.all(teamIds.map(id => getTeamOffense(id)));
    const teams = Object.fromEntries(
      teamIds.map((id, i) => [id, results[i]]).filter(([, v]) => v !== null),
    );

    return NextResponse.json({ teams });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('team-offense API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch team offense' },
      { status: 500 },
    );
  }
}
