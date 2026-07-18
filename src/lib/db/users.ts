import { sql } from 'drizzle-orm';
import { getDb } from './client';
import { users, type UserRole } from './schema';

function operatorGuids(): string[] {
  return (process.env.OPERATOR_YAHOO_GUIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Role resolution: the OPERATOR_YAHOO_GUIDS env allowlist is the bootstrap
 * authority (works even on an empty database); the users.role column allows
 * promoting someone later without an env change. Env can grant operator,
 * never revoke a DB-granted one.
 */
export async function upsertUserOnLogin(user: {
  id: string;
  email: string;
  name: string;
}): Promise<UserRole> {
  const envOperator = operatorGuids().includes(user.id);
  const rows = await getDb()
    .insert(users)
    .values({
      id: user.id,
      email: user.email,
      name: user.name,
      role: envOperator ? 'operator' : 'user',
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: user.email,
        name: user.name,
        lastLoginAt: sql`now()`,
        ...(envOperator ? { role: 'operator' as const } : {}),
      },
    })
    .returning({ role: users.role });
  return rows[0].role;
}

/**
 * Env-only role check for when Postgres is unreachable — login must not
 * depend on the DB being up, and the operator must not get locked out of
 * admin by a DB outage.
 */
export function roleFromEnv(userId: string): UserRole {
  return operatorGuids().includes(userId) ? 'operator' : 'user';
}
