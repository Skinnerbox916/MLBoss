import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getCachedLineupSpots } from '@/lib/mlb/lineupSpots';

/**
 * POST /api/mlb/lineup-spots
 *
 * Body: { mlbIds: number[] }
 * Returns: { spots: Record<number, number> } — only resolved entries.
 *
 * Lightweight client-side accessor for the lineup-spot cache. Used by the
 * batter streaming FA aggregator to apply cached priors when assembling
 * matchup contexts for D+1+.
 */
export async function POST(request: Request) {
  try {
    await getSession().then(s => { if (!s.user) throw new Error('Unauthorized'); });
    const body = await request.json();
    const mlbIds: unknown = body?.mlbIds;
    if (!Array.isArray(mlbIds)) {
      return NextResponse.json({ error: 'mlbIds (number[]) required' }, { status: 400 });
    }
    const numericIds = mlbIds.filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
    const map = await getCachedLineupSpots(numericIds);
    const spots: Record<number, number> = {};
    for (const [id, spot] of map) spots[id] = spot;
    return NextResponse.json({ spots });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('lineup-spots API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch lineup spots' },
      { status: 500 },
    );
  }
}
