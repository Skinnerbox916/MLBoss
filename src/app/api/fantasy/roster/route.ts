import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTeamRoster, getTeamRosterByDate } from '@/lib/fantasy';

/**
 * GET /api/fantasy/roster?teamKey=458.l.123456.t.1&date=2025-07-15
 * Returns the team roster. Omit date for today.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const { searchParams } = new URL(request.url);
    const teamKey = searchParams.get('teamKey');
    const date = searchParams.get('date');

    if (!teamKey) {
      return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    }

    const roster = date
      ? await getTeamRosterByDate(user.id, teamKey, date)
      : await getTeamRoster(user.id, teamKey);

    return NextResponse.json({ team_key: teamKey, date: date ?? 'today', roster });
  } catch (error) {
    console.error('Roster API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get roster' },
      { status: 500 },
    );
  }
}
