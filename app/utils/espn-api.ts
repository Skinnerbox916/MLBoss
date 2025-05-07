import { getCachedData, setCachedData } from './cache';

// Default timeout for API requests
const API_TIMEOUT = 5000;

// Cache key for ESPN scoreboard data
const ESPN_SCOREBOARD_CACHE_KEY = 'espn:mlb:scoreboard';

/**
 * Get ESPN MLB scoreboard data with caching
 * @returns ESPN scoreboard data
 */
export async function getEspnScoreboard() {
  // Check cache first
  const cachedData = await getCachedData(ESPN_SCOREBOARD_CACHE_KEY);
  if (cachedData) {
    console.log('ESPN API: Using cached scoreboard data');
    return cachedData;
  }

  console.log('ESPN API: Fetching fresh scoreboard data');
  
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(API_TIMEOUT)
    });
    
    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Cache the data for 15 minutes
    await setCachedData(ESPN_SCOREBOARD_CACHE_KEY, data, { ttl: 15 * 60 });
    
    return data;
  } catch (error) {
    console.error('ESPN API: Error fetching scoreboard:', error);
    throw error;
  }
}

/**
 * Check if a team has a game today based on ESPN data
 * @param teamAbbr Team abbreviation
 * @returns Object with game info
 */
export async function checkTeamGameFromEspn(teamAbbr: string) {
  if (!teamAbbr) {
    return { has_game_today: false, game_start_time: null, data_source: 'none' };
  }
  
  try {
    const espnData = await getEspnScoreboard();
    
    if (!espnData?.events || !espnData.events.length) {
      return { has_game_today: false, game_start_time: null, data_source: 'espn_no_events' };
    }
    
    const teamAbbrUpper = teamAbbr.toUpperCase();
    
    for (const event of espnData.events) {
      if (!event.competitions || !event.competitions.length) continue;
      
      const competition = event.competitions[0];
      
      for (const team of competition.competitors || []) {
        if (team.team?.abbreviation?.toUpperCase() === teamAbbrUpper) {
          return {
            has_game_today: true,
            game_start_time: event.date || null,
            data_source: 'espn'
          };
        }
      }
    }
    
    return { has_game_today: false, game_start_time: null, data_source: 'espn_no_match' };
  } catch (error) {
    console.error(`ESPN API: Error checking game for team ${teamAbbr}:`, error);
    return { has_game_today: false, game_start_time: null, data_source: 'espn_error' };
  }
} 