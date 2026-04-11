import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { resolveMLBId, getBatterSplits, getCareerVsPitcher } from '@/lib/mlb/players';

/**
 * GET /api/mlb/player-splits?name=Mike+Trout&team=LAA&season=2025&pitcherId=123456
 *
 * Returns batter splits for the named player. Optionally include career vs. a specific pitcher.
 * - name: player full name (required)
 * - team: team abbreviation to disambiguate (optional but recommended)
 * - season: year (optional, defaults to current year)
 * - pitcherId: MLB ID of opposing pitcher for career-vs lookup (optional)
 */
export async function GET(request: Request) {
  try {
    await getSession().then(s => { if (!s.user) throw new Error('Unauthorized'); });

    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const team = searchParams.get('team') ?? undefined;
    const season = parseInt(searchParams.get('season') ?? String(new Date().getFullYear()), 10);
    const pitcherIdParam = searchParams.get('pitcherId');

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Resolve Yahoo player name → MLB ID
    const identity = await resolveMLBId(name, team);
    if (!identity) {
      return NextResponse.json({ error: `Player not found: ${name}` }, { status: 404 });
    }

    // Fetch splits
    const splits = await getBatterSplits(identity.mlbId, season);

    // Career vs pitcher if requested
    let careerVsPitcher = null;
    if (pitcherIdParam) {
      const pitcherId = parseInt(pitcherIdParam, 10);
      if (!isNaN(pitcherId)) {
        careerVsPitcher = await getCareerVsPitcher(identity.mlbId, pitcherId);
      }
    }

    return NextResponse.json({ identity, splits, careerVsPitcher });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('player-splits API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch player splits' },
      { status: 500 },
    );
  }
}
