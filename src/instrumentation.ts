// Runs once when the Next.js server boots (both `next dev` and production
// `next start`). The canonical place for fail-fast bootstrap checks: better
// to crash here with a clear error than to surface cryptic Redis/iron-session
// failures on the first request.
//
// See: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnvVars } = await import('@/constants/envSchema');
    validateEnvVars();

    // Apply pending Drizzle migrations (idempotent; reads ./drizzle at the
    // repo root — we don't use standalone output, so the folder ships with
    // the deploy). Non-fatal: the app degrades gracefully without Postgres
    // (login falls back to env-only roles, prefs to localStorage, ledger
    // captures no-op) — crash-looping the whole app on a DB hiccup would
    // be strictly worse.
    try {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      const { getDb } = await import('@/lib/db');
      await migrate(getDb(), { migrationsFolder: 'drizzle' });
      console.log('✅ Postgres migrations up to date');
    } catch (err) {
      console.error('❌ Postgres migration failed — durable-ledger features degraded:', err);
    }
  }
}
