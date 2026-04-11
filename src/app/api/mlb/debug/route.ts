import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { resolveMLBId, getBatterSplits, getCareerVsPitcher } from '@/lib/mlb/players';
import { getGameDay } from '@/lib/mlb/schedule';

/**
 * GET /api/mlb/debug?name=Aaron+Judge&team=NYY&date=2026-04-10&pitcherId=543037
 *
 * Debug probe — runs the full MLB pipeline end-to-end and returns raw results
 * from each stage so failures are easy to isolate. Used by /admin/debug.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') ?? 'Aaron Judge';
    const team = searchParams.get('team') ?? undefined;
    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    const season = parseInt(
      searchParams.get('season') ?? String(new Date().getFullYear()),
      10,
    );
    const pitcherIdParam = searchParams.get('pitcherId');

    // Stage 1: resolve name → MLB ID
    const identity = await resolveMLBId(name, team);

    // Stage 2: fetch splits (includes early-season fallback)
    const splits = identity ? await getBatterSplits(identity.mlbId, season) : null;

    // Stage 3: career vs pitcher (if pitcherId provided)
    let careerVsPitcher = null;
    if (identity && pitcherIdParam) {
      const pitcherId = parseInt(pitcherIdParam, 10);
      if (!isNaN(pitcherId)) {
        careerVsPitcher = await getCareerVsPitcher(identity.mlbId, pitcherId);
      }
    }

    // Stage 4: fetch the game day for the requested date
    const games = await getGameDay(date);
    const teamGame = team
      ? games.find(
          g =>
            g.homeTeam.abbreviation.toUpperCase() === team.toUpperCase() ||
            g.awayTeam.abbreviation.toUpperCase() === team.toUpperCase(),
        )
      : null;

    return NextResponse.json({
      request: { name, team, date, season, pitcherId: pitcherIdParam },
      stage1_identity: identity,
      stage2_splits: splits,
      stage3_careerVsPitcher: careerVsPitcher,
      stage4_gameDay: {
        totalGames: games.length,
        teamGame,
      },
    });
  } catch (error) {
    console.error('mlb/debug API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'debug probe failed',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
