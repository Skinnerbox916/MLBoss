import { NextResponse } from 'next/server';
import { requireOperator } from '@/lib/auth';
import { getGameDay } from '@/lib/mlb/schedule';
import { getParkByVenueId } from '@/lib/mlb/parks';
import { capturePitcherSlate, captureBatterSlate, todayEt } from '@/lib/ledger';

/**
 * POST /api/admin/forecast/capture?date=YYYY-MM-DD
 *
 * Manually snapshot the pitcher-start slate for a date (default today ET).
 * The same capture runs write-through on /api/mlb/game-day traffic; this
 * covers days nobody opened the app. Operator only.
 */
export async function POST(request: Request) {
  const authz = await requireOperator();
  if (!authz.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: authz.status });
  }
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '') ? (dateParam as string) : todayEt();

    const games = await getGameDay(date);
    const enriched = games.map(game => ({
      ...game,
      park: getParkByVenueId(game.venue.mlbId) ?? null,
    }));
    const [pitcherStarts, batterDays] = await Promise.all([
      capturePitcherSlate(date, enriched),
      captureBatterSlate(date, enriched),
    ]);
    return NextResponse.json({ date, games: enriched.length, pitcherStarts, batterDays });
  } catch (error) {
    console.error('/api/admin/forecast/capture failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Capture failed' },
      { status: 500 },
    );
  }
}
