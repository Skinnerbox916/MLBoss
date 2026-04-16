import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { YahooFantasyAPI } from '@/lib/yahoo-fantasy-api';

/**
 * GET /api/fantasy/roster-raw?teamKey=...&date=YYYY-MM-DD&limit=3
 * Returns the raw Yahoo player array structure for debugging.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const { searchParams } = new URL(request.url);
    const teamKey = searchParams.get('teamKey');
    const date = searchParams.get('date') ?? undefined;
    const limit = parseInt(searchParams.get('limit') ?? '3', 10);

    if (!teamKey) {
      return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    }

    const api = new YahooFantasyAPI(user.id);
    const raw = await api.getTeamRosterRaw(teamKey, { date, limit });

    return NextResponse.json({ teamKey, date, players: raw });
  } catch (error) {
    console.error('Roster raw API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get raw roster' },
      { status: 500 },
    );
  }
}
