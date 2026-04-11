import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getGameDay } from '@/lib/mlb/schedule';
import { getParkByVenueId } from '@/lib/mlb/parks';

/**
 * GET /api/mlb/game-day?date=YYYY-MM-DD
 * Returns all MLB games for a date enriched with probable pitchers, venue, weather, and park data.
 * Omit date for today.
 */
export async function GET(request: Request) {
  try {
    // Requires auth — this data is used in the lineup tool
    await getSession().then(s => { if (!s.user) throw new Error('Unauthorized'); });

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const date = dateParam ?? new Date().toISOString().slice(0, 10);

    const games = await getGameDay(date);

    // Enrich each game with park data
    const enriched = games.map(game => ({
      ...game,
      park: getParkByVenueId(game.venue.mlbId) ?? null,
    }));

    return NextResponse.json({ date, games: enriched });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('game-day API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch game day' },
      { status: 500 },
    );
  }
}
