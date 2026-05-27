import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { YahooFantasyAPI } from '@/lib/yahoo-fantasy-api';
import {
  getCurrentMLBGameKey,
  analyzeUserFantasyLeagues,
  getScoringProfile,
} from '@/lib/fantasy';
import { COMMON_MLB_STATS } from '@/constants/statCategories';

/**
 * Phase 0 smoke endpoint — dumps the resolved ScoringProfile for the caller's
 * primary MLB league (or a league_key passed as ?league_key=...). Returns
 * both the canonical profile and the raw Yahoo stat_modifiers payload so we
 * can eyeball the parse and compare against league settings.
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
    const leagues = analysis.data.leagues ?? [];

    const target = requestedLeagueKey
      ? leagues.find(l => l.league_key === requestedLeagueKey)
      : leagues.find(l => l.user_team && !l.is_finished) ?? leagues[0];

    if (!target) {
      return NextResponse.json(
        { error: requestedLeagueKey ? `League ${requestedLeagueKey} not found` : 'No leagues found' },
        { status: 404 },
      );
    }

    const api = new YahooFantasyAPI(user.id);
    const rawModifiers = await api.getLeagueStatModifiers(target.league_key);
    const profile = await getScoringProfile(user.id, target.league_key, target.scoring_type);

    const annotatedWeights = profile.scoredStatIds
      .map(stat_id => ({
        stat_id,
        display: COMMON_MLB_STATS[stat_id]?.display ?? `stat_${stat_id}`,
        name: COMMON_MLB_STATS[stat_id]?.name ?? 'Unknown',
        positions: COMMON_MLB_STATS[stat_id]?.positions ?? [],
        weight: profile.weights[stat_id],
      }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

    const unknownStatIds = profile.scoredStatIds.filter(id => !COMMON_MLB_STATS[id]);

    return NextResponse.json({
      league_key: target.league_key,
      league_name: target.league_name,
      scoring_type: target.scoring_type,
      profile: {
        mode: profile.mode,
        scored_stat_count: profile.scoredStatIds.length,
        weights: profile.weights,
      },
      annotated_weights: annotatedWeights,
      unknown_stat_ids: unknownStatIds,
      raw_modifiers: rawModifiers,
    });
  } catch (error) {
    console.error('[test-points-profile]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve scoring profile' },
      { status: 500 },
    );
  }
}
