import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPlayerMarketSignals } from '@/lib/fantasy';

/**
 * POST /api/fantasy/market-signals
 * Body: { player_keys: string[] }
 * Returns: { signals: Record<player_key, { percent_owned, average_draft_pick, percent_drafted }> }
 *
 * Batch-fetches Yahoo market signals (percent_owned + draft analysis) for a
 * set of player_keys. Used by the roster optimizer to dampen drop candidacy
 * for highly-owned / highly-drafted players.
 *
 * POST because roster key lists can exceed sensible URL lengths; the body is
 * a stable projection of the request so SWR keyed on the same body will dedupe.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const body = await request.json().catch(() => null);
    const playerKeys = Array.isArray(body?.player_keys)
      ? body.player_keys.filter((k: unknown): k is string => typeof k === 'string')
      : [];

    if (playerKeys.length === 0) {
      return NextResponse.json({ signals: {} });
    }

    const signals = await getPlayerMarketSignals(user.id, playerKeys);
    return NextResponse.json({ signals });
  } catch (error) {
    console.error('Market signals API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get market signals' },
      { status: 500 },
    );
  }
}
