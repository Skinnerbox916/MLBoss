import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { redis } from '@/lib/redis';
import { fetchStatcastPitchers, fetchStatcastBatters } from '@/lib/mlb/savant';
import { getGameDay } from '@/lib/mlb/schedule';
import { isTokenValid } from '@/lib/fantasy';

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
  error?: string;
}

async function check(fn: () => Promise<string>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Date.now() - start, detail };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * GET /api/admin/health
 *
 * Probes every external data source the app depends on and returns a
 * structured health report. Requires auth.
 */
export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  const userId = session.user.id;

  const [
    redisCheck,
    yahooCheck,
    mlbScheduleCheck,
    mlbPlayerCheck,
    savantPitchersCheck,
    savantBattersCheck,
  ] = await Promise.all([
    // Redis
    check(async () => {
      const pong = await redis.ping();
      return `PING → ${pong}`;
    }),

    // Yahoo Fantasy API — token validity + lightweight API call
    check(async () => {
      const valid = await isTokenValid(userId);
      if (!valid) throw new Error('Token invalid or expired');
      return 'Token valid';
    }),

    // MLB Stats API — schedule (exercises the full pipeline: fetch + enrich)
    check(async () => {
      const games = await getGameDay(today);
      return `${games.length} games scheduled for ${today}`;
    }),

    // MLB Stats API — player search (raw HTTP, no cache)
    check(async () => {
      const res = await fetch(
        'https://statsapi.mlb.com/api/v1/people/search?names=Aaron+Judge&sportIds=1',
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { people?: unknown[] };
      return `${json.people?.length ?? 0} result(s) for "Aaron Judge"`;
    }),

    // Baseball Savant — pitcher leaderboard (full parse + cache path)
    check(async () => {
      const map = await fetchStatcastPitchers(year);
      return `${map.size} pitchers (${year} xERA leaderboard)`;
    }),

    // Baseball Savant — batter leaderboard (full parse + cache path)
    check(async () => {
      const map = await fetchStatcastBatters(year);
      return `${map.size} batters (${year} xwOBA leaderboard)`;
    }),
  ]);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    checks: {
      redis: redisCheck,
      yahoo_fantasy: yahooCheck,
      mlb_schedule: mlbScheduleCheck,
      mlb_player_search: mlbPlayerCheck,
      savant_pitchers: savantPitchersCheck,
      savant_batters: savantBattersCheck,
    },
  });
}
