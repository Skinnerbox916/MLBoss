import { and, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import { userPrefs } from './schema';

/**
 * User preference store — durable, per-user, cross-device. Replaces
 * browser localStorage for strategy state (concede/contest overrides,
 * depth targets). Value shape is owned by the consuming hook; this
 * layer treats it as opaque JSON.
 */

const MAX_VALUE_BYTES = 16 * 1024;

export async function getUserPref(userId: string, key: string): Promise<unknown | undefined> {
  const rows = await getDb()
    .select({ value: userPrefs.value })
    .from(userPrefs)
    .where(and(eq(userPrefs.userId, userId), eq(userPrefs.key, key)))
    .limit(1);
  return rows[0]?.value;
}

export async function setUserPref(userId: string, key: string, value: unknown): Promise<void> {
  if (JSON.stringify(value).length > MAX_VALUE_BYTES) {
    throw new Error(`pref value too large for key ${key}`);
  }
  await getDb()
    .insert(userPrefs)
    .values({ userId, key, value })
    .onConflictDoUpdate({
      target: [userPrefs.userId, userPrefs.key],
      set: { value, updatedAt: sql`now()` },
    });
}

export async function deleteUserPref(userId: string, key: string): Promise<void> {
  await getDb()
    .delete(userPrefs)
    .where(and(eq(userPrefs.userId, userId), eq(userPrefs.key, key)));
}
