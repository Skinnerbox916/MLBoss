import { 
  EspnScoreboard,
  EspnGameCheckResult,
  EspnTeam
} from '../types/espn';

// Simple constants
const API_TIMEOUT = 5000;
const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const CACHE_KEY = 'realtime:espn:mlb:scoreboard';

/**
 * Dynamically import the appropriate cache module based on environment
 */
async function getCache() {
  if (typeof window !== 'undefined') {
    // Client-side
    return await import('../lib/client/cache');
  } else {
    // Server-side
    return await import('../lib/server/cache');
  }
}

/**
 * Get ESPN MLB scoreboard data with caching
 * NOTE: This should only be used as a fallback when Yahoo API data is unavailable
 * @returns ESPN scoreboard data
 */
export async function getEspnScoreboard(): Promise<EspnScoreboard> {
  console.log('ESPN API: Fetching scoreboard data (fallback to Yahoo)');
  
  // Get the appropriate cache implementation
  const cache = await getCache();
  
  try {
    const response = await fetch(SCOREBOARD_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(API_TIMEOUT)
    });
    
    if (!response.ok) {
      throw new Error(`ESPN API error (${response.status})`);
    }
    
    const data = await response.json() as EspnScoreboard;
    
    // Cache the data as fallback
    await cache.setCachedData(CACHE_KEY, data, { 
      category: 'realtime',
      ttl: 15 * 60
    });
    
    console.log('ESPN API: Successfully fetched scoreboard data');
    return data;
  } catch (error) {
    console.warn('ESPN API: Error fetching scoreboard, will try cache:', error);
    
    // Try cache as fallback
    const cachedData = await cache.getCachedData<EspnScoreboard>(CACHE_KEY, { 
      category: 'realtime' 
    });
    
    if (cachedData) {
      console.log('ESPN API: Using cached scoreboard data as fallback');
      return cachedData;
    }
    
    // If we reach here, both fresh and cache attempts failed
    console.error('ESPN API: Failed to fetch scoreboard data and no cache available');
    throw new Error('Failed to fetch ESPN scoreboard data');
  }
}

/**
 * Check if a team has a game today based on ESPN data
 * NOTE: This should only be used for probable pitchers or when Yahoo data is unavailable
 * @param teamAbbr Team abbreviation
 * @returns Object with game info
 */
export async function checkTeamGameFromEspn(teamAbbr: string): Promise<EspnGameCheckResult> {
  // This function should be used as a fallback only for:
  // 1. Probable pitcher information which Yahoo doesn't provide
  // 2. When Yahoo API fails to return game information
  
  if (!teamAbbr) {
    return { has_game_today: false, game_start_time: null, data_source: 'none' };
  }
  
  try {
    const espnData = await getEspnScoreboard();
    
    if (!espnData?.events?.length) {
      return { has_game_today: false, game_start_time: null, data_source: 'espn_no_events' };
    }
    
    const teamAbbrUpper = teamAbbr.toUpperCase();
    
    for (const event of espnData.events) {
      if (!event.competitions?.length) continue;
      
      const competition = event.competitions[0];
      
      for (const team of competition.competitors || []) {
        const espnTeam = team as EspnTeam;
        if (espnTeam.abbreviation?.toUpperCase() === teamAbbrUpper) {
          return {
            has_game_today: true,
            game_start_time: event.date || null,
            data_source: 'espn_fallback'
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