import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { agentFantasy } from '@/agent';

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get game key from query params or default to MLB 2025
    const { searchParams } = new URL(request.url);
    const gameKey = searchParams.get('game') || '458';

    // Get stat categories
    const categories = await agentFantasy.getStatCategories(gameKey, session.user.id);
    
    // Get stat category map
    const categoryMap = await agentFantasy.getStatCategoryMap(gameKey, session.user.id);

    // Example stat IDs to demonstrate disambiguation
    const exampleStats = [
      { stat_id: "21", value: "14" }, // Batter strikeouts
      { stat_id: "30", value: "26" }, // Pitcher strikeouts
      { stat_id: "12", value: "8" },  // Home runs
      { stat_id: "13", value: "22" }, // RBIs
    ];

    // Enrich example stats with category info using the new utility
    const enrichedStats = await agentFantasy.enrichStats(gameKey, exampleStats, session.user.id);

    return NextResponse.json({
      game_key: gameKey,
      total_categories: categories.length,
      sample_categories: categories.slice(0, 10), // First 10 categories
      enriched_example_stats: enrichedStats,
      // Show how to disambiguate strikeouts
      disambiguation_example: {
        batter_strikeouts: categoryMap[21],
        pitcher_strikeouts: categoryMap[30],
      }
    });
  } catch (error) {
    console.error('Test stats error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get stat categories' },
      { status: 500 }
    );
  }
} 