import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  console.log('ESPN Scoreboard API: Starting request');
  
  try {
    // Fetch the ESPN scoreboard data
    const scoreboardRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000)
    });
    
    if (!scoreboardRes.ok) {
      throw new Error(`ESPN API returned ${scoreboardRes.status}: ${scoreboardRes.statusText}`);
    }
    
    const scoreboardData = await scoreboardRes.json();
    
    // Process the data to extract useful debugging information
    const processedData = {
      date: new Date().toISOString().split('T')[0],
      events_count: scoreboardData.events?.length || 0,
      games: scoreboardData.events?.map((event: any) => {
        const competitors = event.competitions?.[0]?.competitors || [];
        
        return {
          id: event.id,
          name: event.name,
          short_name: event.shortName,
          date: event.date,
          teams: competitors.map((team: any) => ({
            id: team.id,
            name: team.team?.displayName,
            abbreviation: team.team?.abbreviation,
            location: team.team?.location,
            home_away: team.homeAway
          }))
        };
      }) || []
    };
    
    // Return both the processed data and raw data for debugging
    return NextResponse.json({
      processed: processedData,
      raw: scoreboardData
    });
  } catch (error) {
    console.error('ESPN Scoreboard API: Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ESPN data', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
} 