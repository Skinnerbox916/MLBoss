import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '../../../utils/auth.server';
import { parseString } from 'xml2js';
import { getYahooMlbGameId, getYahooTeamKey, fetchYahooApi } from '../../../utils/yahoo-api';
import { getEspnScoreboard } from '../../../utils/espn-api';
import { getCachedData, setCachedData, generateYahooCacheKey } from '../../../utils/cache';

// Declare global namespace for TypeScript - maintain backward compatibility
declare global {
  var espnScoreboardData: any | null;
  var espnDataLogged: boolean;
  var loggedPlayerKeys: Set<string>;
}

// Initialize global cache if not already set
if (typeof global.espnScoreboardData === 'undefined') {
  global.espnScoreboardData = null;
}

if (typeof global.espnDataLogged === 'undefined') {
  global.espnDataLogged = false;
}

if (typeof global.loggedPlayerKeys === 'undefined') {
  global.loggedPlayerKeys = new Set<string>();
}

// Helper function to get the week number of a date
function getWeekNumber(date: Date): number {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

interface YahooResponse {
  fantasy_content?: {
    game?: Array<{
      game_id?: string[];
    }>;
  };
}

export async function GET(req: NextRequest) {
  console.log('Team API: Starting request');
  const accessToken = getAccessToken();
  console.log('Team API: Access token:', accessToken ? 'Present' : 'Missing');
  
  if (!accessToken) {
    console.log('Team API: No access token found, returning 401');
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Get the current date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    // Generate cache key for team data
    const teamCacheKey = generateYahooCacheKey('team_data', { date: today });
    
    // Check if we have cached team data
    const cachedTeamData = await getCachedData<any>(teamCacheKey);
    if (cachedTeamData) {
      console.log('Team API: Returning cached team data');
      return NextResponse.json(cachedTeamData);
    }

    // Step 1: Get MLB game ID
    let gameId: string;
    try {
      gameId = await getYahooMlbGameId();
      console.log('Team API: Found MLB game ID:', gameId);
    } catch (error) {
      console.error('Team API: Error getting MLB game ID:', error);
      return NextResponse.json({ error: 'Failed to fetch MLB game ID' }, { status: 500 });
    }

    // Step 2: Get the user's team key
    let teamKey: string;
    let leagueKey: string;
    try {
      teamKey = await getYahooTeamKey(gameId);
      console.log('Team API: Found team key:', teamKey);
      leagueKey = teamKey?.split('.t.')[0];
    } catch (error) {
      console.error('Team API: Error getting team key:', error);
      return NextResponse.json({ error: 'Failed to fetch team key' }, { status: 500 });
    }

    // Step 3: Get team resource data
    const teamResourceUrl = `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}`;
    let teamData, movesUsed = 0, movesLimit = 0;
    let debugInfo = { transactionCounter: null };
    
    try {
      teamData = await fetchYahooApi<any>(teamResourceUrl);
      console.log('Team API: Successfully fetched team data');
      
      // Extract transaction counter and moves info
      const teamContent = teamData?.fantasy_content?.team?.[0];
      debugInfo.transactionCounter = teamContent?.transaction_counter;
      
      // Extract moves limit and used from roster_adds
      const rosterAdds = teamContent?.roster_adds?.[0];
      movesLimit = Number(rosterAdds?.coverage_value?.[0] || 0);
      movesUsed = Number(rosterAdds?.value?.[0] || 0);
    } catch (error) {
      console.error('Team API: Error getting team resource:', error);
      // Continue with other data even if this fails
    }

    // Step 4: Prepare the team object with basic info
    const team = teamData?.fantasy_content?.team?.[0];
    const teamObj: any = {
      name: team?.name?.[0] || '',
      team_id: team?.team_id?.[0] || '',
      team_logo: team?.team_logos?.[0]?.team_logo?.[0]?.url?.[0] || null,
      url: team?.url?.[0] || '',
      waiver_priority: team?.waiver_priority?.[0] || null,
      rank: null,
      matchup: null,
      record: null,
      games_today: 0,
      open_slots: 0,
      players_on_il: 0,
      dtd_players: 0,
      moves_used: movesUsed,
      moves_limit: movesLimit,
      moves_remaining: Math.max(movesLimit - movesUsed, 0),
      _debug: debugInfo, // Include debug info in response
      cached: false,
      generated_at: new Date().toISOString()
    };

    // Step 5: Fetch league standings for rank and record
    if (leagueKey && teamKey) {
      try {
        const standingsUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/standings`;
        const standingsData = await fetchYahooApi<any>(standingsUrl, { ttl: 4 * 60 * 60 }); // Cache for 4 hours
        
        const teams = standingsData?.fantasy_content?.league?.[0]?.standings?.[0]?.teams?.[0]?.team || [];
        console.log('Team API: Found teams in standings:', teams.length);
        const myTeam = teams.find((t: any) => t.team_key?.[0] === teamKey);
        
        if (myTeam) {
          const teamStandings = myTeam.team_standings?.[0];
          teamObj.rank = teamStandings?.rank?.[0] || null;
          
          // Extract record
          const outcomeTotals = teamStandings?.outcome_totals?.[0];
          if (outcomeTotals) {
            const wins = outcomeTotals.wins?.[0] || '0';
            const losses = outcomeTotals.losses?.[0] || '0';
            const ties = outcomeTotals.ties?.[0] || '0';
            teamObj.record = `${wins}-${losses}${ties !== '0' ? `-${ties}` : ''}`;
          }
        }
      } catch (e) {
        console.error('Team API: Error fetching standings:', e);
      }
    }

    // Step 6: Fetch roster for injury and slot information
    if (teamKey) {
      try {
        const rosterUrl = `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/roster`;
        const rosterData = await fetchYahooApi<any>(rosterUrl);
        
        const players = rosterData?.fantasy_content?.team?.[0]?.roster?.[0]?.players?.[0]?.player || [];
        console.log('Team API: Found players in roster:', players.length);
        
        // Count players on IL and DTD
        let ilCount = 0;
        let dtdCount = 0;
        players.forEach((player: any) => {
          const status = player?.status?.[0];
          if (status === 'IL') {
            ilCount++;
          } else if (status === 'DTD') {
            dtdCount++;
          }
        });
        teamObj.players_on_il = ilCount;
        teamObj.dtd_players = dtdCount;
        
        // Count open starting slots
        const startingPositions = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'Util', 'SP', 'SP', 'SP', 'SP', 'SP', 'RP', 'RP', 'RP', 'RP', 'P', 'P'];
        const filledPositions = new Set();
        
        players.forEach((player: any) => {
          const position = player?.selected_position?.[0]?.position?.[0];
          const isStarting = player?.starting_status?.[0]?.is_starting?.[0] === '1';
          if (position && isStarting) {
            filledPositions.add(position);
          }
        });

        teamObj.open_slots = startingPositions.length - filledPositions.size;
      } catch (e) {
        console.error('Team API: Error fetching roster:', e);
      }
    }

    // Step 7: Fetch games today information
    if (teamKey) {
      try {
        // Get all players with games for today
        const rosterUrl = `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/roster;date=${today}`;
        const rosterData = await fetchYahooApi<any>(rosterUrl);
        
        const players = rosterData?.fantasy_content?.team?.[0]?.roster?.[0]?.players?.[0]?.player || [];
        
        // Processing players for games data would be verbose here,
        // so we'll use a simple count approach based on the team roster API data
        // This is reasonable since we've already implemented detailed game checks in the roster API
        
        try {
          // Fetch the roster API which already contains game information
          const rosterApiUrl = `/api/yahoo/roster`;
          const rosterApiRes = await fetch(rosterApiUrl);
          
          if (rosterApiRes.ok) {
            const rosterApiData = await rosterApiRes.json();
            const playersWithGames = rosterApiData.players?.filter((p: any) => p.has_game_today) || [];
            
            teamObj.games_today = playersWithGames.length;
            console.log(`Team API: Found ${playersWithGames.length} players with games today`);
          }
        } catch (e) {
          console.error('Team API: Error fetching roster API data:', e);
          
          // Fallback: Use ESPN API to check for games
          try {
            const espnData = await getEspnScoreboard();
            
            // Get all team abbreviations from players
            const teamAbbreviations = new Map<string, string>();
            for (const player of players) {
              const teamKey = player?.editorial_team_key?.[0];
              const teamAbbr = player?.editorial_team_abbr?.[0];
              if (teamKey && teamAbbr) {
                teamAbbreviations.set(teamKey, teamAbbr);
              }
            }
            
            // Count unique teams with games today
            const teamsWithGamesToday = new Set<string>();
            
            if (espnData?.events) {
              for (const event of espnData.events) {
                if (event.competitions && event.competitions.length > 0) {
                  const competition = event.competitions[0];
                  
                  for (const team of competition.competitors || []) {
                    const teamAbbr = team.team?.abbreviation?.toUpperCase();
                    
                    for (const [yahooTeamKey, yahooTeamAbbr] of Array.from(teamAbbreviations.entries())) {
                      if (yahooTeamAbbr.toUpperCase() === teamAbbr) {
                        teamsWithGamesToday.add(yahooTeamKey);
                      }
                    }
                  }
                }
              }
            }
            
            // Count the number of players with games today
            let gamesCount = 0;
            for (const player of players) {
              const teamKey = player?.editorial_team_key?.[0];
              if (teamKey && teamsWithGamesToday.has(teamKey)) {
                gamesCount++;
              }
            }
            
            teamObj.games_today = gamesCount;
            console.log(`Team API: Found ${gamesCount} players with games today via ESPN data`);
          } catch (espnError) {
            console.error('Team API: Error using ESPN fallback:', espnError);
            teamObj.games_today = 0;
          }
        }
      } catch (e) {
        console.error('Team API: Error determining games today:', e);
        teamObj.games_today = 0;
      }
    }

    // Cache the response data
    await setCachedData(teamCacheKey, teamObj, { ttl: 15 * 60 }); // Cache for 15 minutes
    
    return NextResponse.json(teamObj);
  } catch (error) {
    console.error('Team API: Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
        
        // Fallback: If we couldn't determine games through player data,
        // just check a few known MLB game times for today
        if (teamsWithGamesToday.size === 0) {
          console.log('Team API: No games found through player data, using ESPN API fallback');
          
          try {
            // Load ESPN scoreboard data
            if (!global.espnScoreboardData) {
              console.log('Team API: Fetching ESPN scoreboard as fallback for game data');
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
                console.log('Team API: Successfully fetched ESPN scoreboard data');
              } else {
                console.error(`Team API: ESPN API returned ${scoreboardRes.status}`);
              }
            }
            
            // Get all team abbreviations from players
            const teamAbbreviations = new Map<string, string>();
            for (const player of players) {
              const teamKey = player?.editorial_team_key?.[0];
              const teamAbbr = player?.editorial_team_abbr?.[0];
              if (teamKey && teamAbbr) {
                teamAbbreviations.set(teamKey, teamAbbr);
              }
            }
            
            // Check ESPN data for teams with games today
            if (global.espnScoreboardData?.events) {
              console.log('Team API: Checking ESPN data for teams with games today');
              
              // Create a mapping of team abbreviations for easier debugging
              const teamAbbrevsDebug = Array.from(teamAbbreviations.entries())
                .map(([key, abbr]) => `${key} => ${abbr}`)
                .join(', ');
              console.log(`Team API: Yahoo team key to abbreviation mapping: ${teamAbbrevsDebug}`);
              
              // Log ESPN teams for debugging
              if (!global.espnDataLogged) {
                const espnTeams = global.espnScoreboardData.events
                  .flatMap((e: any) => e.competitions || [])
                  .flatMap((c: any) => c.competitors || [])
                  .map((t: any) => t.team?.abbreviation)
                  .filter(Boolean);
                
                console.log(`Team API: ESPN API teams with games today: ${espnTeams.join(', ')}`);
                global.espnDataLogged = true;
              }
              
              for (const event of global.espnScoreboardData.events) {
                if (event.competitions && event.competitions.length > 0) {
                  const competition = event.competitions[0];
                  
                  // Log each matchup for debugging
                  const matchupTeams = competition.competitors
                    ?.map((t: any) => t.team?.abbreviation)
                    .filter(Boolean)
                    .join(' vs ');
                  
                  if (matchupTeams) {
                    console.log(`Team API: ESPN game matchup: ${matchupTeams}`);
                  }
                  
                  for (const team of competition.competitors || []) {
                    const teamAbbr = team.team?.abbreviation?.toUpperCase();
                    
                    // Find matching Yahoo team key for this ESPN team abbreviation
                    for (const [yahooTeamKey, yahooTeamAbbr] of Array.from(teamAbbreviations.entries())) {
                      if (yahooTeamAbbr.toUpperCase() === teamAbbr) {
                        teamsWithGamesToday.add(yahooTeamKey);
                        console.log(`Team API: Found game for team ${yahooTeamAbbr} via ESPN API (matches ${teamAbbr})`);
                      }
                    }
                  }
                }
              }
              
              if (teamsWithGamesToday.size === 0) {
                console.log('Team API: No teams with games found in ESPN data');
              }
            }
          } catch (e) {
            console.error('Team API: Error fetching ESPN data:', e);
          }
          
          // If ESPN API fallback also failed, try Yahoo league scoreboard
          if (teamsWithGamesToday.size === 0) {
            console.log('Team API: ESPN API fallback failed, trying Yahoo league scoreboard');
            try {
              const leagueUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/scoreboard;date=${today}`;
              const leagueRes = await fetch(leagueUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              
              if (leagueRes.ok) {
                const leagueText = await leagueRes.text();
                const leagueData = await new Promise<any>((resolve, reject) => {
                  parseString(leagueText, (err: Error | null, result: any) => {
                    if (err) reject(err);
                    else resolve(result);
                  });
                });
                
                // Check if there are any games scheduled for today
                const games = leagueData?.fantasy_content?.league?.[0]?.scoreboard?.[0]?.matchups?.[0]?.matchup || [];
                console.log(`Team API: Found ${games.length} matchups in league scoreboard`);
                
                if (games.length > 0) {
                  // There are games today, collect team keys
                  console.log('Team API: Games found in Yahoo schedule');
                  for (const player of players) {
                    const teamKey = player?.editorial_team_key?.[0];
                    if (teamKey) {
                      teamsWithGamesToday.add(teamKey);
                    }
                  }
                }
              }
            } catch (e) {
              console.error('Team API: Error fetching league scoreboard:', e);
            }
          }
        }

        // Now count bench players with games
        for (const player of players) {
          const position = player?.selected_position?.[0]?.position?.[0];
          const teamKey = player?.editorial_team_key?.[0];
          const playerKey = player?.player_key?.[0];
          const playerName = player?.name?.[0]?.full?.[0] || 'Unknown';
          // Only count batters for available swaps, not pitchers
          const positionType = player?.position_type?.[0];
          const isBatter = positionType === 'B'; // 'B' for batters, 'P' for pitchers
          
          // Check if player is on bench, is a batter, and their team has a game today
          const hasGameByTime = playerKey && playerGameTimes.has(playerKey);
          const hasGameByTeam = teamKey && teamsWithGamesToday.has(teamKey);
          
          if (position === 'BN' && (hasGameByTime || hasGameByTeam)) {
            // Add to appropriate list
            if (isBatter) {
              availableSwaps++;
              benchBattersWithGames.push(playerName);
              console.log(`Team API: Bench batter ${playerName} has a game today`);
            } else {
              benchPitchersWithGames.push(playerName);
              console.log(`Team API: Bench pitcher ${playerName} has a game today (not counted in available swaps)`);
            }
            benchPlayersWithGames.push(playerName);
          }
        }

        teamObj.games_today = teamsWithGamesToday.size;
        teamObj.available_swaps = availableSwaps;
        console.log('Team API: Teams with games today:', Array.from(teamsWithGamesToday));
        console.log('Team API: Available swaps (batters only):', availableSwaps, 'Bench batters with games:', benchBattersWithGames);
        if (benchPitchersWithGames.length > 0) {
          console.log('Team API: Bench pitchers with games (not counted):', benchPitchersWithGames);
        }
      } catch (e) {
        console.error('Team API: Error fetching games:', e);
      }
    }

    // Fetch current matchup
    if (leagueKey && teamKey) {
      try {
        // Get current week and league name
        const leagueMetaUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}`;
        console.log('Team API: Getting league metadata from:', leagueMetaUrl);
        
        const leagueMetaRes = await fetch(leagueMetaUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const leagueMetaText = await leagueMetaRes.text();
        console.log('Team API: League metadata response status:', leagueMetaRes.status);
        
        const leagueMetaData = await new Promise<any>((resolve, reject) => {
          parseString(leagueMetaText, (err: Error | null, result: any) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        const currentWeek = leagueMetaData?.fantasy_content?.league?.[0]?.current_week?.[0];
        const leagueName = leagueMetaData?.fantasy_content?.league?.[0]?.name?.[0];
        teamObj.league_name = leagueName || 'Unknown League';
        console.log('Team API: Current week:', currentWeek);

        if (currentWeek) {
          const matchupsUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/scoreboard;week=${currentWeek}`;
          console.log('Team API: Getting matchup data from:', matchupsUrl);
          
          const matchupsRes = await fetch(matchupsUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const matchupsText = await matchupsRes.text();
          console.log('Team API: Matchup response status:', matchupsRes.status);
          
          const matchupsData = await new Promise<any>((resolve, reject) => {
            parseString(matchupsText, (err: Error | null, result: any) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
          console.log('Team API: Got matchup data');

          // Extract matchups from league scoreboard
          const matchups = matchupsData?.fantasy_content?.league?.[0]?.scoreboard?.[0]?.matchups?.[0]?.matchup || [];
          console.log('Team API: Found matchups:', matchups.length);
          
          // Find my matchup
          let myMatchup = null;
          let myTeam = null;
          let opponent = null;
          
          for (const matchup of matchups) {
            const teams = matchup.teams?.[0]?.team || [];
            const myTeamIndex = teams.findIndex((t: any) => t.team_key?.[0] === teamKey);
            
            if (myTeamIndex !== -1) {
              myMatchup = matchup;
              myTeam = teams[myTeamIndex];
              opponent = teams[1 - myTeamIndex]; // Get the other team (0 or 1)
              console.log('Team API: Found my matchup in position', myTeamIndex);
              break;
            }
          }
          
          // Initialize empty arrays for categories and stats
          const statCategories: any[] = [];
          const myTeamStats: any[] = [];
          const opponentStats: any[] = [];
          
          if (myMatchup) {
            console.log('Team API: Found my matchup');
            
            // Extract stat categories and stats from the matchup
            const matchupCategories = myMatchup.stat_categories?.[0]?.stats?.[0]?.stat || [];
            const matchupMyTeamStats = myTeam?.team_stats?.[0]?.stats?.[0]?.stat || [];
            const matchupOpponentStats = opponent?.team_stats?.[0]?.stats?.[0]?.stat || [];
            
            console.log('Team API: Found stat categories:', matchupCategories.length);
            console.log('Team API: My team stats:', matchupMyTeamStats.length);
            console.log('Team API: Opponent stats:', matchupOpponentStats.length);
            
            // Push all categories and stats from the matchup
            statCategories.push(...matchupCategories);
            myTeamStats.push(...matchupMyTeamStats);
            opponentStats.push(...matchupOpponentStats);
          }
          
          // If no matchups found or no categories in the matchup, get the categories from the league settings
          if (!myMatchup || statCategories.length === 0) {
            console.log('Team API: No matchup or categories found, getting league settings');
            
            try {
              const settingsUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/settings`;
              const settingsRes = await fetch(settingsUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              
              if (settingsRes.ok) {
                const settingsText = await settingsRes.text();
                const settingsData = await new Promise<any>((resolve, reject) => {
                  parseString(settingsText, (err: Error | null, result: any) => {
                    if (err) reject(err);
                    else resolve(result);
                  });
                });
                
                // Extract stat categories from league settings
                const settingsCats = settingsData?.fantasy_content?.league?.[0]?.settings?.[0]?.stat_categories?.[0]?.stats?.[0]?.stat || [];
                console.log('Team API: Found categories from settings:', settingsCats.length);
                
                if (settingsCats.length > 0) {
                  // We found real categories, use these
                  for (let i = 0; i < settingsCats.length; i++) {
                    const cat = settingsCats[i];
                    if (!statCategories.some((c: any) => c.stat_id?.[0] === cat.stat_id?.[0])) {
                      statCategories.push(cat);
                      
                      // Add default stats 
                      if (myTeamStats.length <= i) {
                        myTeamStats.push({ value: ['0'] });
                      }
                      if (opponentStats.length <= i) {
                        opponentStats.push({ value: ['0'] });
                      }
                    }
                  }
                  console.log('Team API: Used categories from settings:', statCategories.length);
                  // Now we have the categories, continue with the rest of the code
                }
              }
            } catch (e) {
              console.error('Team API: Error getting league settings:', e);
            }
            
            // Fallback if we couldn't get categories from league settings
            if (statCategories.length === 0) {
              // Create default categories
              const defaultCategoryNames = ['R', 'HR', 'RBI', 'SB', 'AVG', 'OPS', 'K', 'W', 'SV', 'SO', 'ERA', 'WHIP'];
              const defaultDisplayNames = ['Runs', 'Home Runs', 'RBIs', 'Stolen Bases', 'Batting Avg', 'OPS', 'Batter Ks', 'Wins', 'Saves', 'Pitcher Ks', 'ERA', 'WHIP'];
              
              for (let i = 0; i < defaultCategoryNames.length; i++) {
                // Determine if higher is better for each category
                const isReversed = defaultCategoryNames[i] === 'ERA' || 
                                  defaultCategoryNames[i] === 'WHIP' || 
                                  (defaultCategoryNames[i] === 'K' && defaultDisplayNames[i] === 'Batter Ks');
                
                statCategories.push({
                  name: [defaultCategoryNames[i]],
                  display_name: [defaultDisplayNames[i]],
                  stat_id: [`${i+1}`],
                  is_reverse_sort: [isReversed ? '1' : '0']
                });
                
                // Create default stats (all zeros)
                if (myTeamStats.length <= i) {
                  myTeamStats.push({ value: ['0'] });
                }
                if (opponentStats.length <= i) {
                  opponentStats.push({ value: ['0'] });
                }
              }
              
              console.log('Team API: Created default categories:', statCategories.length);
            }
          }
          
          // Build category stats array with comparisons
          const categoryStats = statCategories.map((cat: any, index: number) => {
            // Ensure we have a valid index into team stats arrays
            const safeIndex = Math.min(index, myTeamStats.length - 1, opponentStats.length - 1);
            
            const categoryName = cat.display_name?.[0] || cat.name?.[0] || `Stat ${index + 1}`;
            const categoryId = cat.stat_id?.[0] || `stat_${index}`;
            const myStat = safeIndex >= 0 && myTeamStats[safeIndex]?.value?.[0] || '0';
            const opponentStat = safeIndex >= 0 && opponentStats[safeIndex]?.value?.[0] || '0';
            
            // Determine if higher is better (default true unless specified otherwise)
            const isHigherBetter = cat.is_reverse_sort?.[0] !== '1';
            
            let winning = null;
            if (myStat !== '-' && opponentStat !== '-') {
              const myValue = parseFloat(myStat);
              const opponentValue = parseFloat(opponentStat);
              if (!isNaN(myValue) && !isNaN(opponentValue)) {
                if (isHigherBetter) {
                  winning = myValue > opponentValue ? true : myValue < opponentValue ? false : null;
                } else {
                  winning = myValue < opponentValue ? true : myValue > opponentValue ? false : null;
                }
              }
            }
            
            // Enhance strikeout categories to make them more distinguishable
            let displayName = cat.display_name?.[0] || categoryName;
            
            // Handle strikeout categories specially
            if (categoryName === 'K' || categoryName === 'SO' || categoryName === 'Strikeouts') {
              // Determine if this is batter or pitcher strikeouts based on position in category list
              // In fantasy baseball, batting stats typically come before pitching stats
              const isBatterCategory = index < statCategories.length / 2;
              
              if (isBatterCategory) {
                displayName = 'Batter Ks';
                // For batters, lower strikeouts is better (override the default)
                if (myStat !== '-' && opponentStat !== '-') {
                  const myValue = parseFloat(myStat);
                  const opponentValue = parseFloat(opponentStat);
                  if (!isNaN(myValue) && !isNaN(opponentValue)) {
                    winning = myValue < opponentValue ? true : myValue > opponentValue ? false : null;
                  }
                }
              } else {
                displayName = 'Pitcher Ks';
                // For pitchers, higher strikeouts is better (which is the default)
              }
              
              // Log how we categorized this
              console.log(`Team API: Categorized strikeout stat '${categoryName}' at index ${index} as ${displayName}`);
            }
            
            return {
              name: categoryName,
              id: categoryId,
              displayName,
              myStat,
              opponentStat,
              winning,
              isHigherBetter
            };
          });
          
          console.log('Team API: Processed categories:', categoryStats.length);
          if (categoryStats.length > 0) {
            console.log('Team API: First category:', categoryStats[0]);
          }
          
          // Create matchup object
          teamObj.matchup = {
            week: myMatchup?.week?.[0] || currentWeek,
            opponentName: opponent?.name?.[0] || 'No Current Matchup',
            opponentLogo: opponent?.team_logos?.[0]?.team_logo?.[0]?.url?.[0] || null,
            opponentScore: opponent?.team_points?.[0]?.total?.[0] || '0',
            myScore: myTeam?.team_points?.[0]?.total?.[0] || '0',
            categories: categoryStats
          };
          console.log('Team API: Matchup object created with categories:', categoryStats.length);
        } else {
          console.log('Team API: No current week found in league metadata or invalid week data');
        }
      } catch (e) {
        console.error('Team API: Error getting matchup data:', e);
        teamObj.matchup = null;
      }
    }

    // Return the team object, always
    console.log('Team API: Final team object:', teamObj);
    return NextResponse.json({ team: teamObj });
  } catch (error) {
    console.error('Team API: Unexpected error:', error);
    return NextResponse.json({ error: 'Unexpected error', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}