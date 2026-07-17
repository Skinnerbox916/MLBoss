import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getUserPref, setUserPref, deleteUserPref } from '@/lib/db/prefs';

/**
 * Per-user preference sync — the server side of `useSyncedPref`.
 *
 *   GET    /api/user/prefs?key=...   → { found, value }
 *   PUT    /api/user/prefs           { key, value }
 *   DELETE /api/user/prefs?key=...
 *
 * Values are opaque JSON owned by the consuming hook. Every handler
 * scopes to the session user — there is no cross-user access path.
 */

const MAX_KEY_LENGTH = 200;

async function requireUserId(): Promise<string | null> {
  const session = await getSession();
  return session.user?.id ?? null;
}

function keyParam(request: Request): string | null {
  const key = new URL(request.url).searchParams.get('key');
  return key && key.length <= MAX_KEY_LENGTH ? key : null;
}

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = keyParam(request);
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });
  try {
    const value = await getUserPref(userId, key);
    return NextResponse.json(value === undefined ? { found: false } : { found: true, value });
  } catch (error) {
    console.error('GET /api/user/prefs failed:', error);
    return NextResponse.json({ error: 'Pref read failed' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = (await request.json()) as { key?: unknown; value?: unknown };
    if (typeof body.key !== 'string' || body.key.length === 0 || body.key.length > MAX_KEY_LENGTH) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    if (body.value === undefined) {
      return NextResponse.json({ error: 'value is required' }, { status: 400 });
    }
    await setUserPref(userId, body.key, body.value);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/user/prefs failed:', error);
    return NextResponse.json({ error: 'Pref write failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = keyParam(request);
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });
  try {
    await deleteUserPref(userId, key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/user/prefs failed:', error);
    return NextResponse.json({ error: 'Pref delete failed' }, { status: 500 });
  }
}
