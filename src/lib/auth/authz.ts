import { getSession } from './session';

export type OperatorCheck =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 };

/**
 * Authoritative operator check for admin route handlers. Middleware already
 * screens /admin and /api/admin, but its matcher has exclusions and can be
 * misconfigured silently — operator-only handlers must not rely on it alone.
 *
 * Reads the role stamped into the session at login. A stale stamp lasts at
 * most the 7-day cookie life; role revocation before that means clearing the
 * user's session (delete their `user:*` Redis backup and have them re-login).
 */
export async function requireOperator(): Promise<OperatorCheck> {
  const session = await getSession();
  if (!session.user?.id) return { ok: false, status: 401 };
  if (session.user.role !== 'operator') return { ok: false, status: 403 };
  return { ok: true, userId: session.user.id };
}
