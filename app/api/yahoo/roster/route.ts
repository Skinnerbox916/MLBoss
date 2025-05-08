import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '../../../utils/auth.server';
import { parseString } from 'xml2js';
import { getYahooMlbGameId, getYahooTeamKey, getPlayerGameInfo, fetchYahooApi, parseYahooXml } from '../../../utils/yahoo-api';
import { checkTeamGameFromEspn } from '../../../utils/espn-api';
import { getCachedData, setCachedData, generateYahooCacheKey } from '../../../utils/cache';

// Declare global namespace for TypeScript
declare global {
  var espnScoreboardData: any | null;
  var espnDataLogged: boolean;
  var loggedPlayerKeys: Set<string>;
}

// Initialize global cache if not already set
if (typeof global.espnScoreboardData === 'undefined') {
  global.espnScoreboardData = null;
}

if (typeof global.loggedPlayerKeys === 'undefined') {
  global.loggedPlayerKeys = new Set<string>();
}

interface YahooResponse {
  fantasy_content?: {
    team?: Array<{
      team_key?: string[];
      team_id?: string[];
      name?: string[];
      roster?: Array<{
        coverage_type?: string[];
        date?: string[];
        players?: Array<{
          player?: Array<{
            player_key?: string[];
            player_id?: string[];
            name?: Array<{
              full?: string[];
              first?: string[];
              last?: string[];
            }>;
            status?: string[];
            editorial_team_key?: string[];
            editorial_team_full_name?: string[];
            editorial_team_abbr?: string[];
            uniform_number?: string[];
            display_position?: string[];
            position_type?: string[];
            eligible_positions?: Array<{
              position?: string[];
            }>;
            selected_position?: Array<{
              position?: string[];
            }>;
            starting_status?: Array<{
              is_starting?: string[];
            }>;
            image_url?: string[];
          }>;
        }>;
      }>;
    }>;
  };
}

export async function GET(req: NextRequest) {
  console.log('Roster API: Starting request');
  const accessToken = getAccessToken();
  console.log('Roster API: Access token:', accessToken ? 'Present' : 'Missing');
  
  if (!accessToken) {
    console.log('Roster API: No access token found, returning 401');
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Get the current date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    // Generate cache key for the roster data
    const rosterCacheKey = generateYahooCacheKey('roster', { date: today }, 'daily');
    
    // Check if we have cached roster data
    const cachedRoster = await getCachedData<any>(rosterCacheKey, { category: 'daily' });
    if (cachedRoster) {
      console.log('Roster API: Returning cached roster data');
      console.log('Roster API: Cached roster data structure:', {
        dataType: typeof cachedRoster,
        keys: typeof cachedRoster === 'object' ? Object.keys(cachedRoster) : [],
        hasPlayers: typeof cachedRoster === 'object' && 'players' in cachedRoster,
        playersLength: typeof cachedRoster === 'object' && 'players' in cachedRoster ? cachedRoster.players.length : 0
      });
      
      return NextResponse.json(cachedRoster);
    }

    // Step 1: Get MLB game ID using the utility function
    let gameId: string;
    try {
      gameId = await getYahooMlbGameId();
      console.log('Roster API: Found MLB game ID:', gameId);
    } catch (error) {
      console.error('Roster API: Error getting MLB game ID:', error);
      return NextResponse.json({ error: 'Failed to fetch MLB game ID' }, { status: 500 });
    }
    
    // Step 2: Get the user's team key
    let teamKey: string;
    try {
      teamKey = await getYahooTeamKey(gameId);
      console.log('Roster API: Found team key:', teamKey);
    } catch (error) {
      console.error('Roster API: Error getting team key:', error);
      return NextResponse.json({ error: 'Failed to fetch team key' }, { status: 500 });
    }

    // Step 3: Get roster for the current date
    const rosterUrl = `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/roster;date=${today}`;
    console.log('Roster API: Making request to Yahoo API for roster:', rosterUrl);
    
    let yahooData: any;
    try {
      // Use our new fetch utility for caching
      yahooData = await fetchYahooApi<YahooResponse>(rosterUrl, {
        category: 'daily' // Roster data changes daily
      });
      console.log('Roster API: Successfully fetched and parsed Yahoo roster data');
    } catch (error: unknown) {
      console.error('Roster API: Error fetching roster:', error);
      if (error instanceof Error && error.message?.includes('401')) {
        return NextResponse.json({ error: 'Token expired' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Failed to fetch Yahoo roster data' }, { status: 500 });
    }

    // Extract players from the response with more detailed status handling
    const players = yahooData?.fantasy_content?.team?.[0]?.roster?.[0]?.players?.[0]?.player?.map((player: any) => {
      // Special handling for status field
      let status = '';
      if (player.status && player.status.length > 0) {
        status = player.status[0];
        console.log(`Roster API: Found player with status: ${player.name?.[0]?.full?.[0]} - ${status}`);
      }

      return {
        playerKey: player.player_key?.[0],
        playerId: player.player_id?.[0],
        name: player.name?.[0]?.full?.[0] || 'Unknown',
        firstName: player.name?.[0]?.first?.[0] || '',
        lastName: player.name?.[0]?.last?.[0] || '',
        status: status,
        teamKey: player.editorial_team_key?.[0],
        teamName: player.editorial_team_full_name?.[0],
        teamAbbr: player.editorial_team_abbr?.[0],
        uniformNumber: player.uniform_number?.[0],
        position: player.display_position?.[0],
        positionType: player.position_type?.[0],
        eligiblePositions: player.eligible_positions?.[0]?.position || [],
        selectedPosition: player.selected_position?.[0]?.position?.[0],
        isStarting: player.starting_status?.[0]?.is_starting?.[0] === '1',
        image_url: player.image_url?.[0] || null
      };
    }) || [];

    // Step 4: For each player, fetch their game information
    const playersWithGameInfo = await Promise.all(players.map(async (player: any) => {
      let gameInfo: {
        has_game_today: boolean;
        game_start_time: string | null;
        data_source: string;
      } = {
        has_game_today: false,
        game_start_time: null,
        data_source: 'none'
      };
      
      if (player.playerKey) {
        try {
          // Use our utility function to check if player has a game today
          gameInfo = await getPlayerGameInfo(player.playerKey);
          
          if (gameInfo.has_game_today) {
            console.log(`Roster API: Player ${player.name} has game today (${gameInfo.data_source})`);
          }
        } catch (e) {
          console.error(`Roster API: Error fetching game data from Yahoo for player ${player.name}:`, e);
        }
        
        // FALLBACK: If Yahoo API didn't confirm a game, check ESPN API data
        if (!gameInfo.has_game_today && player.teamAbbr) {
          try {
            // Use ESPN API utility to check for games
            const espnGameInfo = await checkTeamGameFromEspn(player.teamAbbr);
            
            if (espnGameInfo.has_game_today) {
              gameInfo = espnGameInfo;
              console.log(`Roster API: Player ${player.name} has game today (ESPN API fallback)`);
            } else {
              console.log(`Roster API: No game found for ${player.name} (${player.teamAbbr}) in ESPN data`);
            }
          } catch (e) {
            console.error(`Roster API: Error checking ESPN data for ${player.name}:`, e);
          }
        }
      }
      
      return { ...player, ...gameInfo };
    }));

    // Step 5: Fetch probable pitchers for today to indicate who's starting
    const probablePitchersCacheKey = generateYahooCacheKey('probable_pitchers', { date: today }, 'daily');
    let pitchersScheduledToday: string[] = [];
    
    // Check cache for probable pitchers
    const cachedPitchers = await getCachedData<string[]>(probablePitchersCacheKey, { category: 'daily' });
    if (cachedPitchers) {
      pitchersScheduledToday = cachedPitchers;
      console.log('Roster API: Using cached probable pitchers:', pitchersScheduledToday.length);
    } else {
      try {
        // Fetch probable pitchers from MLB API
        const pitchersRes = await fetch(new URL('/api/mlb/probable-pitchers', req.nextUrl.origin).toString());
        if (pitchersRes.ok) {
          const pitchersData = await pitchersRes.json();
          pitchersScheduledToday = pitchersData.pitchers || [];
          
          // Cache the probable pitchers for 4 hours
          await setCachedData(probablePitchersCacheKey, pitchersScheduledToday, { 
            category: 'daily',
            ttl: 4 * 60 * 60 
          });
          
          console.log('Roster API: Fetched probable pitchers:', pitchersScheduledToday.length);
        } else {
          console.error('Roster API: Error fetching probable pitchers');
        }
      } catch (e) {
        console.error('Roster API: Error in probable pitchers API:', e);
      }
    }

    // Mark pitchers who are probable starters today
    const playersWithStartingInfo = playersWithGameInfo.map(player => {
      const isProbableStarter = player.position === 'SP' && 
                               pitchersScheduledToday.some(pitcher => {
                                 // Normalize names for comparison
                                 const normalizeName = (name: string) => {
                                   return name.toLowerCase()
                                     .replace(/\./g, '')
                                     .replace(/\s+/g, ' ')
                                     .trim();
                                 };
                                 
                                 const playerNormalized = normalizeName(player.name);
                                 const pitcherNormalized = normalizeName(pitcher);
                                 
                                 return playerNormalized === pitcherNormalized ||
                                        (player.firstName && pitcherNormalized.includes(normalizeName(player.firstName)) &&
                                         player.lastName && pitcherNormalized.includes(normalizeName(player.lastName)));
                               });
      
      return {
        ...player,
        is_probable_starter: isProbableStarter
      };
    });

    // Create a properly structured response
    const result = {
      date: today,
      team_key: teamKey,
      players: playersWithStartingInfo,
      cached: false,
      generated_at: new Date().toISOString()
    };
    
    // Cache the processed roster data
    await setCachedData(rosterCacheKey, result, { 
      category: 'daily', 
      ttl: 60 * 60 // Cache for 1 hour
    });
    
    // Return the response
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('Roster API: Unhandled error:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}