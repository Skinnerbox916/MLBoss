import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPitcherTalentBatch } from '@/lib/mlb/players';

/**
 * POST /api/mlb/pitcher-talent
 *
 * Batch-fetch canonical talent vectors (Layer 1) for a list of pitchers.
 * Body: { players: [{ name, team }], season? }
 *
 * Returns: Record<"name|team", PitcherTalent>
 */
export async function POST(request: Request) {
  try {
    await getSession().then(s => { if (!s.user) throw new Error('Unauthorized'); });

    const body = await request.json();
    const players: { name: string; team: string }[] = body.players ?? [];
    const season: number = body.season ?? new Date().getFullYear();

    if (!Array.isArray(players) || players.length === 0) {
      return NextResponse.json({ talent: {} });
    }

    const talent = await getPitcherTalentBatch(players, season);
    return NextResponse.json({ talent });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('pitcher-talent API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch pitcher talent' },
      { status: 500 },
    );
  }
}
