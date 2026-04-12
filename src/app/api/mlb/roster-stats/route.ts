import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getRosterSeasonStats } from '@/lib/mlb/players';

/**
 * POST /api/mlb/roster-stats
 *
 * Batch-fetch lightweight season stats (OPS, AVG, HR, SB, PA) for a list
 * of roster players.  Body: { players: [{ name, team }], season? }
 *
 * Returns: Record<"name|team", BatterSeasonStats>
 */
export async function POST(request: Request) {
  try {
    await getSession().then(s => { if (!s.user) throw new Error('Unauthorized'); });

    const body = await request.json();
    const players: { name: string; team: string }[] = body.players ?? [];
    const season: number = body.season ?? new Date().getFullYear();

    if (!Array.isArray(players) || players.length === 0) {
      return NextResponse.json({ stats: {} });
    }

    const stats = await getRosterSeasonStats(players, season);
    return NextResponse.json({ stats });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('roster-stats API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch roster stats' },
      { status: 500 },
    );
  }
}
