import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getEnrichedLeagueStatCategories } from '@/lib/fantasy';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
  // Next.js v15: params is a Promise
  const { leagueKey } = await params;

  try {
    // Authentication handled by middleware - get user from session
    const session = await getSession();
    const user = session.user as NonNullable<import('@/lib/auth').SessionData['user']>;

    if (!leagueKey) {
      return NextResponse.json(
        { error: 'League key is required' },
        { status: 400 }
      );
    }

    // Get league stat categories with enriched metadata
    const enrichedCategories = await getEnrichedLeagueStatCategories(user.id, leagueKey);
    
    // Separate batting and pitching categories
    const battingCategories = enrichedCategories.filter(cat => cat.is_batter_stat);
    const pitchingCategories = enrichedCategories.filter(cat => cat.is_pitcher_stat);
    
    return NextResponse.json({
      league_key: leagueKey,
      total_categories: enrichedCategories.length,
      batting_categories: battingCategories.map(cat => ({
        stat_id: cat.stat_id,
        display_name: cat.display_name,
        name: cat.name,
        betterIs: cat.betterIs,
        sort_order: cat.sort_order
      })),
      pitching_categories: pitchingCategories.map(cat => ({
        stat_id: cat.stat_id,
        display_name: cat.display_name,
        name: cat.name,
        betterIs: cat.betterIs,
        sort_order: cat.sort_order
      })),
      all_categories: enrichedCategories,
    });
  } catch (error) {
    console.error('League categories API error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to get league categories',
        league_key: leagueKey
      },
      { status: 500 }
    );
  }
} 