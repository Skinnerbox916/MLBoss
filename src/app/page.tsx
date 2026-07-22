import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';

export default async function HomePage() {
  // Check if user is already authenticated with valid token
  const session = await getSession();
  if (session?.user) {
    // Check if token is still valid
    const now = Date.now();
    if (!session.user.expiresAt || now < session.user.expiresAt) {
      redirect('/dashboard');
    }
    // If token is expired, continue to show signin page
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      {/* Logo for light theme */}
      <Image
        src="/assets/mlboss-logo-light.svg"
        alt="MLBoss Logo"
        width={260}
        height={104}
        priority
        className="mx-auto mb-8 block dark:hidden"
      />
      {/* Logo for dark theme */}
      <Image
        src="/assets/mlboss-logo-dark.svg"
        alt="MLBoss Logo"
        width={260}
        height={104}
        priority
        className="mx-auto mb-8 hidden dark:block"
      />
      <a
        href="/api/auth/login"
        className="mt-4 px-8 py-4 rounded-lg bg-accent text-white text-xl font-bold shadow-lg hover:bg-accent-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500 transition-colors"
      >
        Sign in with Yahoo!
      </a>

      {/* Yahoo Fantasy attribution (required for API access). The official
          two-tone wordmark needs a light backing to stay legible in both
          themes, so it sits on a white chip. */}
      <footer className="absolute bottom-8 flex flex-col items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-white px-3 py-1.5 shadow-sm ring-1 ring-black/5">
          <Image
            src="/assets/yahoo-fantasy.svg"
            alt="Yahoo Fantasy"
            width={132}
            height={20}
            className="h-5 w-auto"
          />
        </span>
        <span className="text-caption text-muted-foreground">
          Fantasy data provided by Yahoo Fantasy
        </span>
      </footer>
    </div>
  );
}
