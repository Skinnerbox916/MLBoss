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
  }
}
