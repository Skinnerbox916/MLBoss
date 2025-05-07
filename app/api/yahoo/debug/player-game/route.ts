import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '../../../../utils/auth.server';
import { parseString } from 'xml2js';

// Define types for method results
type MethodResult = {
  method: string;
  url?: string;
  error?: string;
  has_game: boolean | null;
  [key: string]: any; // Allow additional properties
};

export async function GET(req: NextRequest) {
  console.log('Debug Player Game API: Starting request');
  let playerKey = req.nextUrl.searchParams.get('playerKey');
  const teamKey = req.nextUrl.searchParams.get('teamKey');
  // Allow a custom date parameter to be passed
  const dateParam = req.nextUrl.searchParams.get('date');
  
  if (!playerKey) {
    return NextResponse.json({ error: 'Player key is required' }, { status: 400 });
  }
  
  // Clean up the player key if it contains _debug_logged
  if (playerKey.includes('_debug_logged')) {
    playerKey = playerKey.replace('_debug_logged', '');
    console.log(`Debug: Cleaned up player key to ${playerKey}`);
  }
  
  const accessToken = getAccessToken();
  
  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  
  try {
    // Use the provided date or default to today
    const today = dateParam || new Date().toISOString().split('T')[0];
    console.log(`Debug: Using date ${today}`);
    
    const results: {
      player_key: string;
      date: string;
      methods: MethodResult[];
    } = {
      player_key: playerKey,
      date: today,
      methods: []
    };
    
    // Method 1: Using player stats endpoint
    try {
      console.log(`Debug: Testing player stats endpoint for player ${playerKey}`);
      const playerStatsUrl = `https://fantasysports.yahooapis.com/fantasy/v2/player/${playerKey}/stats;type=date;date=${today}`;
      
      const playerStatsRes = await fetch(playerStatsUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000)
      });
      
      if (playerStatsRes.ok) {
        const playerStatsText = await playerStatsRes.text();
        const playerStatsData = await new Promise<any>((resolve, reject) => {
          parseString(playerStatsText, (err: Error | null, result: any) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        
        const coverageStart = playerStatsData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_metadata?.[0]?.coverage_start?.[0];
        const coverageType = playerStatsData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_type?.[0];
        const isCoverageDay = playerStatsData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.is_coverage_day?.[0];
        const gameDate = playerStatsData?.fantasy_content?.player?.[0]?.game_date?.[0];
        const gameTime = playerStatsData?.fantasy_content?.player?.[0]?.game_time?.[0];
        const gameStartTime = playerStatsData?.fantasy_content?.player?.[0]?.game_start_time?.[0];
        
        // Look for any game indicators in the player stats data
        const gameIndicators = {
          coverage_start: coverageStart || null,
          coverage_type: coverageType || null,
          is_coverage_day: isCoverageDay || null,
          game_date: gameDate || null, 
          game_time: gameTime || null,
          game_start_time: gameStartTime || null,
          // Additional game-related fields that might be in the API response
          scheduled_game_time: playerStatsData?.fantasy_content?.player?.[0]?.scheduled_game_time?.[0] || null,
          game_status: playerStatsData?.fantasy_content?.player?.[0]?.game_status?.[0] || null,
          game_played: playerStatsData?.fantasy_content?.player?.[0]?.game_played?.[0] || null,
        };
        
        results.methods.push({
          method: 'player_stats',
          url: playerStatsUrl,
          has_game: Boolean(coverageStart || isCoverageDay === '1' || gameDate || gameTime || gameStartTime),
          game_indicators: gameIndicators,
          raw_response_summary: {
            player_key: playerStatsData?.fantasy_content?.player?.[0]?.player_key?.[0] || null,
            player_name: playerStatsData?.fantasy_content?.player?.[0]?.name?.[0]?.full?.[0] || null,
            team_key: playerStatsData?.fantasy_content?.player?.[0]?.editorial_team_key?.[0] || null,
            team_name: playerStatsData?.fantasy_content?.player?.[0]?.editorial_team_full_name?.[0] || null,
            team_abbr: playerStatsData?.fantasy_content?.player?.[0]?.editorial_team_abbr?.[0] || null,
          }
        });
      } else {
        results.methods.push({
          method: 'player_stats',
          url: playerStatsUrl,
          error: `API returned ${playerStatsRes.status}`,
          has_game: null
        });
      }
    } catch (e) {
      results.methods.push({
        method: 'player_stats',
        error: e instanceof Error ? e.message : String(e),
        has_game: null
      });
    }
    
    // Method 2: Try to get game directly from player endpoint
    try {
      console.log(`Debug: Testing direct player endpoint for player ${playerKey}`);
      const playerUrl = `https://fantasysports.yahooapis.com/fantasy/v2/player/${playerKey}`;
      
      const playerRes = await fetch(playerUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000)
      });
      
      if (playerRes.ok) {
        const playerText = await playerRes.text();
        const playerData = await new Promise<any>((resolve, reject) => {
          parseString(playerText, (err: Error | null, result: any) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        
        const gameDate = playerData?.fantasy_content?.player?.[0]?.game_date?.[0];
        const gameTime = playerData?.fantasy_content?.player?.[0]?.game_time?.[0];
        const gameStartTime = playerData?.fantasy_content?.player?.[0]?.game_start_time?.[0];
        
        // Look for any game indicators in the player data
        const gameIndicators = {
          game_date: gameDate || null,
          game_time: gameTime || null,
          game_start_time: gameStartTime || null,
          // Additional game-related fields that might be in the API response
          scheduled_game_time: playerData?.fantasy_content?.player?.[0]?.scheduled_game_time?.[0] || null,
          game_status: playerData?.fantasy_content?.player?.[0]?.game_status?.[0] || null,
          game_played: playerData?.fantasy_content?.player?.[0]?.game_played?.[0] || null,
          is_start: playerData?.fantasy_content?.player?.[0]?.is_start?.[0] || null,
        };
        
        results.methods.push({
          method: 'player_direct',
          url: playerUrl,
          has_game: Boolean(gameDate || gameTime || gameStartTime),
          game_indicators: gameIndicators,
          raw_response_summary: {
            player_key: playerData?.fantasy_content?.player?.[0]?.player_key?.[0] || null,
            player_name: playerData?.fantasy_content?.player?.[0]?.name?.[0]?.full?.[0] || null,
            team_key: playerData?.fantasy_content?.player?.[0]?.editorial_team_key?.[0] || null,
            team_name: playerData?.fantasy_content?.player?.[0]?.editorial_team_full_name?.[0] || null,
            team_abbr: playerData?.fantasy_content?.player?.[0]?.editorial_team_abbr?.[0] || null,
          }
        });
      } else {
        results.methods.push({
          method: 'player_direct',
          url: playerUrl,
          error: `API returned ${playerRes.status}`,
          has_game: null
        });
      }
    } catch (e) {
      results.methods.push({
        method: 'player_direct',
        error: e instanceof Error ? e.message : String(e),
        has_game: null
      });
    }
    
    // Method 3: Try team/players endpoint
    if (teamKey) {
      try {
        console.log(`Debug: Testing team/players endpoint for team ${teamKey}`);
        const teamPlayersUrl = `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/players;date=${today}`;
        
        const teamPlayersRes = await fetch(teamPlayersUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(5000)
        });
        
        if (teamPlayersRes.ok) {
          const teamPlayersText = await teamPlayersRes.text();
          const teamPlayersData = await new Promise<any>((resolve, reject) => {
            parseString(teamPlayersText, (err: Error | null, result: any) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
          
          const allPlayers = teamPlayersData?.fantasy_content?.team?.[0]?.players?.[0]?.player || [];
          const thisPlayer = allPlayers.find((p: any) => p.player_key?.[0] === playerKey);
          
          const gameStartTime = thisPlayer?.game_start_time?.[0];
          const gameDate = thisPlayer?.game_date?.[0];
          const gameTime = thisPlayer?.game_time?.[0];
          
          // Add additional game-related fields
          const gameIndicators = thisPlayer ? {
            game_start_time: gameStartTime || null,
            game_date: gameDate || null,
            game_time: gameTime || null,
            scheduled_game_time: thisPlayer?.scheduled_game_time?.[0] || null,
            game_status: thisPlayer?.game_status?.[0] || null,
            game_played: thisPlayer?.game_played?.[0] || null,
            is_start: thisPlayer?.is_start?.[0] || null,
          } : null;
          
          results.methods.push({
            method: 'team_players',
            url: teamPlayersUrl,
            has_game: Boolean(gameStartTime || (gameDate && gameTime) || gameDate),
            game_indicators: gameIndicators,
            player_found: Boolean(thisPlayer),
            raw_response_summary: thisPlayer ? {
              player_key: thisPlayer?.player_key?.[0] || null,
              player_name: thisPlayer?.name?.[0]?.full?.[0] || null,
              team_key: thisPlayer?.editorial_team_key?.[0] || null,
              team_name: thisPlayer?.editorial_team_full_name?.[0] || null,
              team_abbr: thisPlayer?.editorial_team_abbr?.[0] || null,
            } : null
          });
        } else {
          // For 400 error, provide more insight on why the future date is likely failing
          if (teamPlayersRes.status === 400) {
            results.methods.push({
              method: 'team_players',
              url: teamPlayersUrl,
              error: `API returned ${teamPlayersRes.status}`,
              has_game: null
            });
          } else {
            results.methods.push({
              method: 'team_players',
              url: teamPlayersUrl,
              error: `API returned ${teamPlayersRes.status}`,
              has_game: null
            });
          }
        }
      } catch (e) {
        results.methods.push({
          method: 'team_players',
          error: e instanceof Error ? e.message : String(e),
          has_game: null
        });
      }
    }
    
    // Method 4: Fetch league scoreboard for date to get matchup start_time
    if (teamKey) {
      const leagueKey = teamKey.split('.t.')[0];
      const leagueScoreboardUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/scoreboard;date=${today}?format=json`;
      try {
        const leagueRes = await fetch(leagueScoreboardUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(5000)
        });
        if (leagueRes.ok) {
          const leagueData = await leagueRes.json();
          const matchups = leagueData.fantasy_content?.league?.[0]?.scoreboard?.[0]?.matchups?.[0]?.matchup || [];
          const myMatchup = matchups.find((m: any) => 
            m.home?.[0]?.team_key?.[0] === teamKey ||
            m.away?.[0]?.team_key?.[0] === teamKey
          );
          const startTime = myMatchup?.start_time || null;
          results.methods.push({
            method: 'league_scoreboard',
            url: leagueScoreboardUrl,
            has_game: Boolean(startTime),
            game_indicators: { start_time: startTime }
          });
        } else {
          results.methods.push({
            method: 'league_scoreboard',
            url: leagueScoreboardUrl,
            error: `API returned ${leagueRes.status}`,
            has_game: null
          });
        }
      } catch (e) {
        results.methods.push({
          method: 'league_scoreboard',
          error: e instanceof Error ? e.message : String(e),
          has_game: null
        });
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Debug API: Unexpected error:', error);
    return NextResponse.json(
      { error: 'Unexpected error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
} 