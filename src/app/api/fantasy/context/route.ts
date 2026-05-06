import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getCurrentMLBGameKey, analyzeUserFantasyLeagues } from '@/lib/fantasy';

/**
 * GET /api/fantasy/context
 * Returns the user's primary MLB league and team keys.
 * This is the bootstrapping endpoint — the frontend calls it once on load
 * to know which league/team to query for all other data.
 */
export async function GET() {
  try {
    const session = await getSession();
    const user = session.user!;

    const currentMLB = await getCurrentMLBGameKey(user.id);

    if (!currentMLB?.game_key) {
      return NextResponse.json({ error: 'No active MLB season found' }, { status: 404 });
    }

    const result = await analyzeUserFantasyLeagues(user.id, [currentMLB.game_key]);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (result.data.status === 'no_leagues' || !result.data.leagues?.length) {
      return NextResponse.json({
        game_key: currentMLB.game_key,
        season: currentMLB.season,
        leagues: [],
      });
    }

    // Return all leagues with their user team info
    const leagues = result.data.leagues.map(league => ({
      league_key: league.league_key,
      league_name: league.league_name,
      league_type: league.league_type,
      scoring_type: league.scoring_type,
      current_week: league.current_week,
      total_teams: league.total_teams,
      is_finished: league.is_finished,
      user_team: league.user_team,
    }));

    return NextResponse.json({
      game_key: currentMLB.game_key,
      season: currentMLB.season,
      leagues,
      // Convenience: primary league/team (first active league where user has a team)
      primary_league_key: leagues.find(l => l.user_team && !l.is_finished)?.league_key ?? leagues[0]?.league_key,
      primary_team_key: leagues.find(l => l.user_team && !l.is_finished)?.user_team?.team_key ?? leagues[0]?.user_team?.team_key,
    });
  } catch (error) {
    console.error('Fantasy context API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get fantasy context' },
      { status: 500 },
    );
  }
}
