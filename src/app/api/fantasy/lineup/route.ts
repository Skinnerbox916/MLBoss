import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { setTeamRoster } from '@/lib/fantasy';

interface LineupPlayerInput {
  player_key: string;
  position: string;
}

interface LineupPutBody {
  teamKey: string;
  date: string;
  players: LineupPlayerInput[];
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isValidBody(body: unknown): body is LineupPutBody {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.teamKey !== 'string' || !b.teamKey) return false;
  if (typeof b.date !== 'string' || !isValidDate(b.date)) return false;
  if (!Array.isArray(b.players) || b.players.length === 0) return false;
  for (const p of b.players) {
    if (typeof p !== 'object' || p === null) return false;
    const pp = p as Record<string, unknown>;
    if (typeof pp.player_key !== 'string' || !pp.player_key) return false;
    if (typeof pp.position !== 'string' || !pp.position) return false;
  }
  return true;
}

/**
 * PUT /api/fantasy/lineup
 * Body: { teamKey, date (YYYY-MM-DD), players: [{ player_key, position }] }
 *
 * Yahoo requires the full roster in one PUT — callers must include every
 * rostered player with their intended slot (including BN / IL).
 */
export async function PUT(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isValidBody(raw)) {
      return NextResponse.json(
        { error: 'Body must be { teamKey, date: "YYYY-MM-DD", players: [{ player_key, position }] }' },
        { status: 400 },
      );
    }

    await setTeamRoster(user.id, raw.teamKey, raw.date, raw.players);

    return NextResponse.json({ ok: true, team_key: raw.teamKey, date: raw.date });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to set lineup';
    console.error('Lineup PUT failed:', message);
    // Yahoo returns 400 with "Player is not editable" when a player's game
    // has started; map that (and any other lock/edit/forbidden indicator) to
    // 409 so the client can show a friendly "lineup locked" state rather
    // than a generic server error.
    const lower = message.toLowerCase();
    const isConflict =
      lower.includes('not editable') ||
      lower.includes('locked') ||
      lower.includes('forbidden');
    return NextResponse.json({ error: message }, { status: isConflict ? 409 : 500 });
  }
}
