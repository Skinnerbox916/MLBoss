import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  getCurrentMLBGameKey,
  analyzeUserFantasyLeagues,
  getScoringProfile,
  type ScoringProfile,
} from '@/lib/fantasy';

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
      weekly_deadline: league.weekly_deadline,
      current_week: league.current_week,
      total_teams: league.total_teams,
      is_finished: league.is_finished,
      user_team: league.user_team,
    }));

    const primaryLeagueKey = leagues.find(l => l.user_team && !l.is_finished)?.league_key
      ?? leagues[0]?.league_key;
    const primaryTeamKey = leagues.find(l => l.user_team && !l.is_finished)?.user_team?.team_key
      ?? leagues[0]?.user_team?.team_key;

    // Resolve the scoring profile for the primary league only — secondary
    // leagues stay unresolved until a team switcher lands. Failure here is
    // non-fatal; surface the league context regardless so the UI can still
    // render in legacy categories mode.
    let primaryScoringProfile: ScoringProfile | undefined;
    if (primaryLeagueKey) {
      const primaryLeague = leagues.find(l => l.league_key === primaryLeagueKey);
      if (primaryLeague) {
        try {
          primaryScoringProfile = await getScoringProfile(
            user.id,
            primaryLeagueKey,
            primaryLeague.scoring_type,
          );
        } catch (err) {
          console.warn('[fantasy/context] failed to resolve scoring profile', primaryLeagueKey, err);
        }
      }
    }

    return NextResponse.json({
      game_key: currentMLB.game_key,
      season: currentMLB.season,
      leagues,
      primary_league_key: primaryLeagueKey,
      primary_team_key: primaryTeamKey,
      primary_scoring_profile: primaryScoringProfile,
    });
  } catch (error) {
    console.error('Fantasy context API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get fantasy context' },
      { status: 500 },
    );
  }
}
