import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '../../../utils/auth.server';
import { parseString } from 'xml2js';

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
    // First get the current MLB game ID
    const gameUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/game/mlb';
    console.log('Roster API: Getting MLB game info from:', gameUrl);
    
    const gameRes = await fetch(gameUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    console.log('Roster API: MLB game info response status:', gameRes.status);
    const gameText = await gameRes.text();
    console.log('Roster API: MLB game info response:', gameText);

    if (!gameRes.ok) {
      console.log('Roster API: Failed to get MLB game info');
      return NextResponse.json({ error: 'Failed to fetch MLB game info', details: gameText }, { status: 500 });
    }

    // Parse XML response
    const gameData = await new Promise<any>((resolve, reject) => {
      parseString(gameText, (err: Error | null, result: any) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const gameId = gameData?.fantasy_content?.game?.[0]?.game_id?.[0];
    console.log('Roster API: Found MLB game ID:', gameId);
    
    if (!gameId) {
      console.log('Roster API: Could not find MLB game ID');
      return NextResponse.json({ error: 'Could not find MLB game ID' }, { status: 500 });
    }

    // Get the current date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    // Get the user's team
    const teamUrl = `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=${gameId}/teams`;
    console.log('Roster API: Getting team info from:', teamUrl);
    
    const teamRes = await fetch(teamUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!teamRes.ok) {
      console.log('Roster API: Failed to get team info');
      return NextResponse.json({ error: 'Failed to fetch team info' }, { status: 500 });
    }

    const teamText = await teamRes.text();
    const teamData = await new Promise<any>((resolve, reject) => {
      parseString(teamText, (err: Error | null, result: any) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const teamKey = teamData?.fantasy_content?.users?.[0]?.user?.[0]?.games?.[0]?.game?.[0]?.teams?.[0]?.team?.[0]?.team_key?.[0];
    
    if (!teamKey) {
      console.log('Roster API: Could not find team key');
      return NextResponse.json({ error: 'Could not find team key' }, { status: 500 });
    }

    // Now get roster for the current date
    const rosterUrl = `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/roster;date=${today}`;
    console.log('Roster API: Making request to Yahoo API for roster:', rosterUrl);
    
    const yahooRes = await fetch(rosterUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    console.log('Roster API: Yahoo API response status:', yahooRes.status);
    const yahooText = await yahooRes.text();
    console.log('Roster API: Yahoo API response:', yahooText);
    
    if (!yahooRes.ok) {
      if (yahooRes.status === 401) {
        console.log('Roster API: Token expired or invalid');
        return NextResponse.json({ error: 'Token expired' }, { status: 401 });
      }
      console.log('Roster API: Yahoo API error:', yahooText);
      return NextResponse.json({ error: 'Failed to fetch Yahoo data', details: yahooText }, { status: 500 });
    }

    // Parse XML response
    const data = await new Promise<YahooResponse>((resolve, reject) => {
      parseString(yahooText, (err: Error | null, result: YahooResponse) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    console.log('Roster API: Successfully parsed Yahoo data');

    // Log the players data structure directly from the XML response
    const rawPlayersData = data?.fantasy_content?.team?.[0]?.roster?.[0]?.players?.[0];
    console.log('Roster API: Raw players data structure:', JSON.stringify(rawPlayersData, null, 2));

    // Check the first player to see its structure
    if (rawPlayersData?.player && rawPlayersData.player.length > 0) {
      const firstPlayer = rawPlayersData.player[0];
      console.log('Roster API: First player raw data:', JSON.stringify(firstPlayer, null, 2));
      console.log('Roster API: First player status:', firstPlayer.status);
    }

    // Extract players from the response with more detailed status handling
    const players = data?.fantasy_content?.team?.[0]?.roster?.[0]?.players?.[0]?.player?.map(player => {
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

    // For each player, fetch their game start time for today and set has_game_today
    const playersWithGameInfo = await Promise.all(players.map(async player => {
      let has_game_today = false;
      let game_start_time = null;
      let data_source = 'none'; // Track where the data came from
      
      if (player.playerKey) {
        try {
          // PRIMARY METHOD: Use Yahoo's player stats endpoint with date filter
          const playerUrl = `https://fantasysports.yahooapis.com/fantasy/v2/player/${player.playerKey}/stats;type=date;date=${today}`;
          console.log(`Roster API: Checking game for player ${player.name} using Yahoo API: ${playerUrl}`);
          
          const playerRes = await fetch(playerUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            // Add timeout to prevent hanging
            signal: AbortSignal.timeout(3000)
          });
          
          if (playerRes.ok) {
            const playerText = await playerRes.text();
            
            // Log raw XML for the first player to help diagnose response format - without modifying the playerKey
            const debugTrackingKey = `${player.playerKey}_logged`;
            if (!global.loggedPlayerKeys) {
              global.loggedPlayerKeys = new Set();
            }
            
            if (!global.loggedPlayerKeys.has(debugTrackingKey)) {
              console.log(`Roster API: Raw Yahoo player stats response for ${player.name}:\n`, playerText);
              // Mark this player as logged to avoid excessive logging
              global.loggedPlayerKeys.add(debugTrackingKey);
            }
            
            const playerData = await new Promise<any>((resolve, reject) => {
              parseString(playerText, (err: Error | null, result: any) => {
                if (err) reject(err);
                else resolve(result);
              });
            });
            
            // Add more detailed logging to understand the response structure
            console.log(`Roster API: Yahoo player stats response structure for ${player.name}:`, 
              JSON.stringify({
                player_key: playerData?.fantasy_content?.player?.[0]?.player_key?.[0],
                player_name: playerData?.fantasy_content?.player?.[0]?.name?.[0]?.full?.[0],
                player_stats_path: playerData?.fantasy_content?.player?.[0]?.player_stats ? 'exists' : 'missing',
                coverage_metadata_path: playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_metadata ? 'exists' : 'missing',
                coverage_type: playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_type?.[0],
                stat_date: playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.date?.[0],
                coverage_start: playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_metadata?.[0]?.coverage_start?.[0],
                coverage_end: playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_metadata?.[0]?.coverage_end?.[0],
                fantasy_game_date: playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.fantasy_game_date?.[0],
                is_coverage_day: playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.is_coverage_day?.[0]
              }, null, 2)
            );
            
            // Log alternative property paths for debugging
            if (!playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_metadata?.[0]?.coverage_start?.[0]) {
              console.log(`Roster API: Alternative properties for ${player.name} game detection:`, 
                JSON.stringify({
                  // Look for any game-related properties
                  game_key: playerData?.fantasy_content?.player?.[0]?.game_key?.[0],
                  game_date: playerData?.fantasy_content?.player?.[0]?.game_date?.[0],
                  game_status: playerData?.fantasy_content?.player?.[0]?.game_status?.[0],
                  game_time: playerData?.fantasy_content?.player?.[0]?.game_time?.[0],
                  game_played: playerData?.fantasy_content?.player?.[0]?.game_played?.[0],
                  game_start_time: playerData?.fantasy_content?.player?.[0]?.game_start_time?.[0],
                  scheduled_game_time: playerData?.fantasy_content?.player?.[0]?.scheduled_game_time?.[0],
                  has_player_notes: playerData?.fantasy_content?.player?.[0]?.has_player_notes?.[0],
                  player_notes_last_timestamp: playerData?.fantasy_content?.player?.[0]?.player_notes_last_timestamp?.[0]
                }, null, 2)
              );
            }
            
            const coverageStart = playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_metadata?.[0]?.coverage_start?.[0];
            if (coverageStart) {
              has_game_today = true;
              game_start_time = coverageStart;
              data_source = 'yahoo';
              console.log(`Roster API: Player ${player.name} has game today at ${coverageStart} (Yahoo API)`);
            } else {
              console.log(`Roster API: No game found for ${player.name} in Yahoo API response (no coverage_start)`);
              
              // Check additional Yahoo API properties for game information
              // First check is_coverage_day
              const isCoverageDay = playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.is_coverage_day?.[0];
              if (isCoverageDay === '1') {
                has_game_today = true;
                game_start_time = 'In Progress';
                data_source = 'yahoo_coverage_day';
                console.log(`Roster API: Player ${player.name} has game today (is_coverage_day = 1)`);
              }
              
              // Check for alternative game time properties in the response
              if (!has_game_today) {
                // Try game_date and game_time from player data root
                const gameDate = playerData?.fantasy_content?.player?.[0]?.game_date?.[0];
                const gameTime = playerData?.fantasy_content?.player?.[0]?.game_time?.[0];
                const gameStartTime = playerData?.fantasy_content?.player?.[0]?.game_start_time?.[0];
                const scheduledGameTime = playerData?.fantasy_content?.player?.[0]?.scheduled_game_time?.[0];
                
                if (gameStartTime) {
                  has_game_today = true;
                  game_start_time = gameStartTime;
                  data_source = 'yahoo_game_start_time';
                  console.log(`Roster API: Player ${player.name} has game today at ${gameStartTime} (game_start_time property)`);
                } else if (scheduledGameTime) {
                  has_game_today = true;
                  game_start_time = scheduledGameTime;
                  data_source = 'yahoo_scheduled_game_time';
                  console.log(`Roster API: Player ${player.name} has game today at ${scheduledGameTime} (scheduled_game_time property)`);
                } else if (gameDate && gameTime) {
                  has_game_today = true;
                  game_start_time = `${gameDate} ${gameTime}`;
                  data_source = 'yahoo_game_date_time';
                  console.log(`Roster API: Player ${player.name} has game today at ${gameDate} ${gameTime} (game_date + game_time properties)`);
                } else if (gameDate) {
                  has_game_today = true;
                  game_start_time = gameDate;
                  data_source = 'yahoo_game_date';
                  console.log(`Roster API: Player ${player.name} has game today on ${gameDate} (game_date property)`);
                }
              }

              // If still no game found, try an alternative Yahoo API endpoint
              if (!has_game_today) {
                try {
                  // Try the direct player endpoint without stats parameter as a fallback
                  const altPlayerUrl = `https://fantasysports.yahooapis.com/fantasy/v2/player/${player.playerKey}`;
                  const altPlayerRes = await fetch(altPlayerUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  if (altPlayerRes.ok) {
                    const altPlayerText = await altPlayerRes.text();
                    const altPlayerData = await new Promise<any>((resolve, reject) => {
                      parseString(altPlayerText, (err: Error | null, result: any) => {
                        if (err) reject(err);
                        else resolve(result);
                      });
                    });
                    
                    // Check for direct game properties
                    const altGameDate = altPlayerData?.fantasy_content?.player?.[0]?.game_date?.[0];
                    const altGameTime = altPlayerData?.fantasy_content?.player?.[0]?.game_time?.[0];
                    const altGameStartTime = altPlayerData?.fantasy_content?.player?.[0]?.game_start_time?.[0];
                    
                    if (altGameStartTime) {
                      has_game_today = true;
                      game_start_time = altGameStartTime;
                      data_source = 'yahoo_alt_game_start_time';
                      console.log(`Roster API: Player ${player.name} has game today at ${altGameStartTime} (alt endpoint game_start_time)`);
                    } else if (altGameDate && altGameTime) {
                      has_game_today = true;
                      game_start_time = `${altGameDate} ${altGameTime}`;
                      data_source = 'yahoo_alt_game_date_time';
                      console.log(`Roster API: Player ${player.name} has game today at ${altGameDate} ${altGameTime} (alt endpoint game_date + game_time)`);
                    } else if (altGameDate) {
                      has_game_today = true;
                      game_start_time = altGameDate;
                      data_source = 'yahoo_alt_game_date';
                      console.log(`Roster API: Player ${player.name} has game today on ${altGameDate} (alt endpoint game_date)`);
                    }
                  }
                } catch (e) {
                  console.error(`Roster API: Error fetching alternative game data for ${player.name}:`, e);
                }
              }
            }
          } else {
            console.log(`Roster API: Failed to get Yahoo API data for ${player.name}: ${playerRes.status}`);
            // Will fall back to ESPN API below
          }
        } catch (e) {
          console.error(`Roster API: Error fetching game data from Yahoo for player ${player.name}:`, e);
          // Will fall back to ESPN API below
        }
        
        // FALLBACK: If Yahoo API didn't confirm a game, check ESPN API data
        if (!has_game_today && player.teamAbbr) {
          try {
            // We already fetch ESPN scoreboard data for pitchers, let's reuse that call
            // If this is the first player without game info, make the ESPN API call
            if (!global.espnScoreboardData) {
              console.log('Roster API: Fetching ESPN scoreboard as fallback for game data');
              const scoreboardRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', {
                method: 'GET',
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(5000)
              });
              
              if (scoreboardRes.ok) {
                global.espnScoreboardData = await scoreboardRes.json();
                console.log('Roster API: Successfully fetched ESPN scoreboard data');
              } else {
                console.error(`Roster API: ESPN API returned ${scoreboardRes.status}`);
              }
            }
            
            // Check if player's team has a game today in ESPN data
            if (global.espnScoreboardData?.events) {
              const playerTeamAbbr = player.teamAbbr.toUpperCase();
              
              // Log ESPN data structure for the first player to help debug
              if (!global.espnDataLogged) {
                console.log('Roster API: ESPN scoreboard data structure sample:', 
                  JSON.stringify({
                    events_count: global.espnScoreboardData.events.length,
                    first_event: global.espnScoreboardData.events[0] ? {
                      id: global.espnScoreboardData.events[0].id,
                      date: global.espnScoreboardData.events[0].date,
                      name: global.espnScoreboardData.events[0].name,
                      competitions_count: global.espnScoreboardData.events[0].competitions?.length || 0,
                      teams: global.espnScoreboardData.events[0].competitions?.[0]?.competitors?.map(
                        (c: any) => ({ id: c.id, abbrev: c.team?.abbreviation })
                      ) || []
                    } : 'no events'
                  }, null, 2)
                );
                global.espnDataLogged = true;
              }
              
              let matchFound = false;
              // For debugging, log all team abbreviations in ESPN data for this player
              console.log(`Roster API: Looking for team ${playerTeamAbbr} in ESPN data`);
              
              for (const event of global.espnScoreboardData.events) {
                if (event.competitions && event.competitions.length > 0) {
                  const competition = event.competitions[0];
                  
                  const teamAbbrevs = competition.competitors?.map((t: any) => t.team?.abbreviation?.toUpperCase()).filter(Boolean) || [];
                  if (teamAbbrevs.length > 0) {
                    console.log(`Roster API: ESPN game teams: ${teamAbbrevs.join(' vs ')} - checking against ${playerTeamAbbr}`);
                  }
                  
                  for (const team of competition.competitors || []) {
                    if (team.team?.abbreviation?.toUpperCase() === playerTeamAbbr) {
                      has_game_today = true;
                      game_start_time = event.date; // Use game time from ESPN
                      data_source = 'espn';
                      matchFound = true;
                      console.log(`Roster API: Player ${player.name} has game today (ESPN API fallback)`);
                      break;
                    }
                  }
                  
                  if (matchFound) break;
                }
              }
              
              if (!has_game_today) {
                console.log(`Roster API: No game found for ${player.name} (${playerTeamAbbr}) in ESPN data`);
              }
            }
          } catch (e) {
            console.error(`Roster API: Error checking ESPN data for ${player.name}:`, e);
          }
        }
      }
      
      return { ...player, has_game_today, game_start_time, data_source };
    }));

    // Log raw player data to see IL status
    const rawPlayersWithStatus = data?.fantasy_content?.team?.[0]?.roster?.[0]?.players?.[0]?.player?.filter(p => p.status) || [];
    console.log('Roster API: Raw players with status:', rawPlayersWithStatus.map(p => ({
      name: p.name?.[0]?.full?.[0],
      status: p.status,
      position: p.display_position?.[0]
    })));

    // Log player status for debugging
    const playersWithStatus = playersWithGameInfo.filter(p => p.status);
    console.log('Roster API: Players with status (processed):', playersWithStatus.map(p => ({ 
      name: p.name, 
      status: p.status,
      position: p.position
    })));

    // Step 3: Fetch probable pitchers for today to indicate who's starting
    const pitchersScheduledToday: string[] = [];
    try {
      console.log('Roster API: Fetching probable pitchers from API');
      // Use ESPN API instead of Rotowire for better reliability
      const probablePitchers = await fetch('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        // Add short timeout to prevent hanging
        signal: AbortSignal.timeout(5000)
      });
      
      if (!probablePitchers.ok) {
        throw new Error(`ESPN API returned ${probablePitchers.status}: ${probablePitchers.statusText}`);
      }
      
      const probData = await probablePitchers.json();
      
      // Extract probable pitchers from the ESPN API response
      if (probData.events && Array.isArray(probData.events)) {
        probData.events.forEach((event: any) => {
          if (event.competitions && Array.isArray(event.competitions)) {
            event.competitions.forEach((competition: any) => {
              if (competition.competitors && Array.isArray(competition.competitors)) {
                competition.competitors.forEach((team: any) => {
                  if (team.probables && Array.isArray(team.probables)) {
                    team.probables.forEach((player: any) => {
                      if (player.athlete && player.athlete.displayName) {
                        pitchersScheduledToday.push(player.athlete.displayName);
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
      
      console.log('Roster API: Found probable pitchers:', pitchersScheduledToday);
    } catch (e) {
      console.error('Roster API: Error fetching probable pitchers:', e);
      
      // If no external API works, use the fallback list of pitchers
      // This ensures we can still display some data even when the external API fails
      console.log('Roster API: Found probable pitchers: []');
    }
    
    const playersWithPitchingInfo = playersWithGameInfo.map(player => {
      // Only check for pitchers (SP, RP)
      if (player.position && (player.position.includes('SP') || player.position.includes('RP'))) {
        // Check if this player is pitching today using more robust name matching
        const isPitchingToday = pitchersScheduledToday.some(pitcherName => {
          // Log detailed matching attempt for debugging
          console.log(`Roster API: Attempting to match ${player.name} with ${pitcherName}`);
          
          // Helper function to normalize a name
          const normalizeName = (name: string) => {
            return name.toLowerCase()
              .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
              .replace(/[^a-z0-9]/g, " ") // Replace non-alphanumeric with spaces
              .replace(/\s+/g, " ")      // Convert multiple spaces to single space
              .trim();
          };

          // Special case for Shohei Ohtani who might have "(Pitcher)" in his name
          if (player.name.includes("Ohtani") && pitcherName.includes("Ohtani")) {
            console.log(`Roster API: Special case match for Ohtani`);
            return true;
          }

          // Normalize both names
          const normalizedPlayerName = normalizeName(player.name);
          const normalizedPitcherName = normalizeName(pitcherName);
          
          // Extract just last name for both players (more reliable matching)
          const playerLastName = normalizedPlayerName.split(" ").pop() || "";
          const pitcherLastName = normalizedPitcherName.split(" ").pop() || "";
          
          // Match on last name first
          if (playerLastName === pitcherLastName) {
            console.log(`Roster API: Last name match for ${player.name} and ${pitcherName}`);
            
            // For most cases, last name and first letter of first name is enough
            const playerFirstChar = normalizedPlayerName.charAt(0);
            const pitcherFirstChar = normalizedPitcherName.charAt(0);
            
            return playerFirstChar === pitcherFirstChar;
          }
          
          // If last names are long enough, partial matches can work too
          if (playerLastName.length > 5 && pitcherLastName.length > 5) {
            if (playerLastName.includes(pitcherLastName) || pitcherLastName.includes(playerLastName)) {
              console.log(`Roster API: Partial last name match for ${player.name} and ${pitcherName}`);
              return true;
            }
          }
          
          // Exact match on full normalized name
          if (normalizedPlayerName === normalizedPitcherName) {
            console.log(`Roster API: Exact name match for ${player.name} and ${pitcherName}`);
            return true;
          }
          
          return false;
        });
        
        console.log(`Roster API: Final result for ${player.name} pitching today: ${isPitchingToday}`);
        
        return { ...player, pitching_today: isPitchingToday };
      }
      return { ...player, pitching_today: false };
    });

    console.log('Roster API: Pitchers scheduled today:', playersWithPitchingInfo
      .filter(p => p.pitching_today)
      .map(p => p.name));

    // Transform the data for the frontend - ensure we preserve all status information
    const simplifiedPlayers = playersWithPitchingInfo.map(player => {
      // Create the simplified player object
      const simplified = {
        name: player.name,
        position: player.position || 'Unknown',
        team: player.teamAbbr || 'Unknown',
        image_url: player.image_url,
        status: player.status,
        pitching_today: player.pitching_today,
        eligiblePositions: player.eligiblePositions || [],
        selectedPosition: player.selectedPosition,
        isStarting: player.isStarting,
        has_game_today: player.has_game_today,
        game_start_time: player.game_start_time,
        data_source: player.data_source || 'unknown',
        playerKey: player.playerKey,
        teamKey: player.teamKey
      };
      
      // Debug log if this player has status
      return simplified;
    });

    // Log all simplified players with status
    console.log('Roster API: All simplified players with status:', 
      simplifiedPlayers.filter(p => p.status).map(p => ({ name: p.name, status: p.status, position: p.position }))
    );

    // Skip the mock data generation since we're trying to debug actual data
    return NextResponse.json({ players: simplifiedPlayers });
  } catch (error) {
    console.error('Roster API: Unexpected error:', error);
    return NextResponse.json({ error: 'Unexpected error', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}