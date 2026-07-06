import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getScoringProfile, getLineupCadence, getEarliestPlayableDate, withCache, CACHE_CATEGORIES } from '@/lib/fantasy';
import { analyzePointsStreaming } from '@/lib/points/streaming';

/**
 * GET /api/points/streaming?teamKey=...&leagueKey=...&scoringType=...[&cadence=daily|weekly]
 *
 * Points-league streaming analysis: per-day lineup coverage (open slot-days),
 * FA pitcher starts ranked by expected points, and FA bats ranked by marginal
 * lineup gain. Lineup cadence (daily vs weekly-locked) is derived server-side
 * from the league's `weekly_deadline`; the explicit `cadence` param overrides
 * it (smoke testing / debugging only). 400s for non-points leagues (the UI
 * only calls this when `scoringProfile.mode === 'points'`).
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    const { searchParams } = new URL(request.url);
    const teamKey = searchParams.get('teamKey');
    const leagueKey = searchParams.get('leagueKey');
    const scoringType = searchParams.get('scoringType') ?? '';

    if (!teamKey) return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    if (!leagueKey) return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });

    const profile = await getScoringProfile(user.id, leagueKey, scoringType);
    if (profile.mode !== 'points') {
      return NextResponse.json({ error: `League ${leagueKey} is ${profile.mode}, not points` }, { status: 400 });
    }

    const cadenceParam = searchParams.get('cadence');
    const cadence = cadenceParam === 'weekly' || cadenceParam === 'daily'
      ? cadenceParam
      : await getLineupCadence(user.id, leagueKey);

    // Earliest date a pickup can play (Yahoo edit_key → floors the daily
    // window; immediate leagues include today). A `floor` query param overrides
    // for smoke testing, mirroring the `cadence` override.
    const floorParam = searchParams.get('floor');
    const earliestPlayableDate = /^\d{4}-\d{2}-\d{2}$/.test(floorParam ?? '')
      ? (floorParam as string)
      : await getEarliestPlayableDate(user.id, leagueKey);

    // Cache the assembled analysis as a unit (mirrors points-team): the FA
    // pools, game days, and stat batches underneath are each cached, but the
    // ~60 FA × per-day optimizer fan-out is worth skipping on every render.
    // Keyed on the window floor so the analysis rolls when edit_key advances.
    const analysis = await withCache(
      `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:points-streaming:${leagueKey}:${teamKey}:${cadence}:${earliestPlayableDate}`,
      CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
      () => analyzePointsStreaming(user.id, leagueKey, teamKey, profile, { cadence, earliestPlayableDate }),
    );
    return NextResponse.json({ leagueKey, teamKey, scoringType, ...analysis });
  } catch (error) {
    console.error('/api/points/streaming failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze points streaming' },
      { status: 500 },
    );
  }
}
