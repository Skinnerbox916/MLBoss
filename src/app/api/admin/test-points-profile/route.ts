import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { YahooFantasyAPI } from '@/lib/yahoo-fantasy-api';
import {
  getCurrentMLBGameKey,
  analyzeUserFantasyLeagues,
  getScoringProfile,
  type ScoringProfile,
} from '@/lib/fantasy';
import { COMMON_MLB_STATS } from '@/constants/statCategories';

/**
 * Phase 0 smoke endpoint — resolves the ScoringProfile for every MLB league
 * the caller is in (or just ?league_key=... if given) and dumps both the
 * canonical profile and the raw Yahoo stat_modifiers payload. Resolving here
 * also caches each profile under `static:scoring-profile:<leagueKey>`, so the
 * points-league profile is available for inspection afterwards.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const user = session.user;

    const { searchParams } = new URL(request.url);
    const requestedLeagueKey = searchParams.get('league_key');

    const currentMLB = await getCurrentMLBGameKey(user.id);
    if (!currentMLB?.game_key) {
      return NextResponse.json({ error: 'No active MLB season' }, { status: 404 });
    }

    const analysis = await analyzeUserFantasyLeagues(user.id, [currentMLB.game_key]);
    if (!analysis.ok) {
      return NextResponse.json({ error: analysis.error }, { status: 500 });
    }
    const allLeagues = analysis.data.leagues ?? [];

    const targets = requestedLeagueKey
      ? allLeagues.filter(l => l.league_key === requestedLeagueKey)
      : allLeagues;

    if (targets.length === 0) {
      return NextResponse.json(
        { error: requestedLeagueKey ? `League ${requestedLeagueKey} not found` : 'No leagues found' },
        { status: 404 },
      );
    }

    const api = new YahooFantasyAPI(user.id);

    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          const rawModifiers = await api.getLeagueStatModifiers(target.league_key);
          const profile: ScoringProfile = await getScoringProfile(
            user.id,
            target.league_key,
            target.scoring_type,
          );

          const annotatedWeights = profile.scoredStatIds
            .map(stat_id => ({
              stat_id,
              display: COMMON_MLB_STATS[stat_id]?.display ?? `stat_${stat_id}`,
              name: COMMON_MLB_STATS[stat_id]?.name ?? 'Unknown',
              positions: COMMON_MLB_STATS[stat_id]?.positions ?? [],
              weight: profile.weights[stat_id],
            }))
            .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

          return {
            league_key: target.league_key,
            league_name: target.league_name,
            scoring_type: target.scoring_type,
            team: target.user_team?.team_name ?? null,
            profile: {
              mode: profile.mode,
              scored_stat_count: profile.scoredStatIds.length,
              weights: profile.weights,
            },
            annotated_weights: annotatedWeights,
            unknown_stat_ids: profile.scoredStatIds.filter(id => !COMMON_MLB_STATS[id]),
            raw_modifiers: rawModifiers,
          };
        } catch (err) {
          return {
            league_key: target.league_key,
            league_name: target.league_name,
            scoring_type: target.scoring_type,
            error: err instanceof Error ? err.message : 'Failed to resolve',
          };
        }
      }),
    );

    return NextResponse.json({
      league_count: targets.length,
      leagues: results,
    });
  } catch (error) {
    console.error('[test-points-profile]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve scoring profile' },
      { status: 500 },
    );
  }
}
