import { parseString } from 'xml2js';
import { getAccessToken } from './auth.server';
import { getCachedData, setCachedData, generateYahooCacheKey } from './cache';

// Default timeout for API requests
const API_TIMEOUT = 5000;

interface ApiOptions {
  ttl?: number;
  skipCache?: boolean;
  timeout?: number;
}

/**
 * Fetch data from Yahoo API with caching
 * @param endpoint API endpoint URL
 * @param options Cache and API options
 * @returns Response data object
 */
export async function fetchYahooApi<T>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  // Generate cache key from endpoint
  const cacheKey = generateYahooCacheKey(endpoint);

  // Try to get from cache unless skipCache is true
  if (!options.skipCache) {
    const cachedData = await getCachedData<T>(cacheKey, { ttl: options.ttl });
    if (cachedData) {
      return cachedData;
    }
  }

  // Fetch fresh data
  console.log(`Yahoo API: Fetching ${endpoint}`);
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(options.timeout || API_TIMEOUT),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Token expired or invalid');
    }
    const text = await response.text();
    throw new Error(`Yahoo API error (${response.status}): ${text}`);
  }

  // For XML responses, parse and convert to JSON
  const contentType = response.headers.get('content-type') || '';
  let responseData: T;

  if (contentType.includes('xml')) {
    const text = await response.text();
    responseData = await parseYahooXml<T>(text);
  } else {
    responseData = await response.json() as T;
  }

  // Cache the response
  if (!options.skipCache) {
    await setCachedData(cacheKey, responseData, { ttl: options.ttl });
  }

  return responseData;
}

/**
 * Parse Yahoo XML response
 * @param xmlText XML response text
 * @returns Parsed object
 */
export async function parseYahooXml<T>(xmlText: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    parseString(xmlText, (err: Error | null, result: T) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Get MLB game ID from Yahoo API
 * @returns MLB game ID
 */
export async function getYahooMlbGameId(): Promise<string> {
  const gameUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/game/mlb';
  const gameData = await fetchYahooApi<any>(gameUrl, { ttl: 24 * 60 * 60 }); // Cache for 24 hours
  
  const gameId = gameData?.fantasy_content?.game?.[0]?.game_id?.[0];
  if (!gameId) {
    throw new Error('Could not find MLB game ID');
  }
  
  return gameId;
}

/**
 * Get user's team key
 * @param gameId Yahoo MLB game ID
 * @returns Team key
 */
export async function getYahooTeamKey(gameId: string): Promise<string> {
  const teamUrl = `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=${gameId}/teams`;
  const teamData = await fetchYahooApi<any>(teamUrl, { ttl: 60 * 60 }); // Cache for 1 hour
  
  const teamKey = teamData?.fantasy_content?.users?.[0]?.user?.[0]?.games?.[0]?.game?.[0]?.teams?.[0]?.team?.[0]?.team_key?.[0];
  if (!teamKey) {
    throw new Error('Could not find team key');
  }
  
  return teamKey;
}

/**
 * Get player's game information for today
 * @param playerKey Yahoo player key
 * @returns Game information 
 */
export async function getPlayerGameInfo(playerKey: string): Promise<{
  has_game_today: boolean;
  game_start_time: string | null;
  data_source: string;
}> {
  const today = new Date().toISOString().split('T')[0];
  
  // Default response
  const defaultResponse = {
    has_game_today: false,
    game_start_time: null,
    data_source: 'none'
  };
  
  try {
    // Try the primary stats endpoint
    const playerUrl = `https://fantasysports.yahooapis.com/fantasy/v2/player/${playerKey}/stats;type=date;date=${today}`;
    const cacheKey = generateYahooCacheKey('player_game_info', { playerKey, date: today });
    
    // Check cache first
    const cachedData = await getCachedData<any>(cacheKey);
    if (cachedData) {
      return cachedData;
    }
    
    // Fetch fresh data
    const playerData = await fetchYahooApi<any>(playerUrl, { 
      timeout: 3000,
      skipCache: true // Skip the general cache as we're implementing custom caching
    });
    
    // Extract game info from player data
    const coverageStart = playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_metadata?.[0]?.coverage_start?.[0];
    if (coverageStart) {
      const result = {
        has_game_today: true,
        game_start_time: coverageStart,
        data_source: 'yahoo'
      };
      await setCachedData(cacheKey, result, { ttl: 60 * 15 }); // Cache for 15 minutes
      return result;
    }
    
    // Check alternative properties
    const isCoverageDay = playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.is_coverage_day?.[0];
    if (isCoverageDay === '1') {
      const result = {
        has_game_today: true,
        game_start_time: 'In Progress',
        data_source: 'yahoo_coverage_day'
      };
      await setCachedData(cacheKey, result, { ttl: 60 * 15 });
      return result;
    }
    
    // Try other properties
    const gameDate = playerData?.fantasy_content?.player?.[0]?.game_date?.[0];
    const gameTime = playerData?.fantasy_content?.player?.[0]?.game_time?.[0];
    const gameStartTime = playerData?.fantasy_content?.player?.[0]?.game_start_time?.[0];
    const scheduledGameTime = playerData?.fantasy_content?.player?.[0]?.scheduled_game_time?.[0];
    
    if (gameStartTime) {
      const result = {
        has_game_today: true,
        game_start_time: gameStartTime,
        data_source: 'yahoo_game_start_time'
      };
      await setCachedData(cacheKey, result, { ttl: 60 * 15 });
      return result;
    } 
    
    if (scheduledGameTime) {
      const result = {
        has_game_today: true,
        game_start_time: scheduledGameTime,
        data_source: 'yahoo_scheduled_game_time'
      };
      await setCachedData(cacheKey, result, { ttl: 60 * 15 });
      return result;
    }
    
    if (gameDate && gameTime) {
      const result = {
        has_game_today: true,
        game_start_time: `${gameDate} ${gameTime}`,
        data_source: 'yahoo_game_date_time'
      };
      await setCachedData(cacheKey, result, { ttl: 60 * 15 });
      return result;
    }
    
    if (gameDate) {
      const result = {
        has_game_today: true,
        game_start_time: gameDate,
        data_source: 'yahoo_game_date'
      };
      await setCachedData(cacheKey, result, { ttl: 60 * 15 });
      return result;
    }
    
    // Try alternate endpoint
    try {
      const altPlayerUrl = `https://fantasysports.yahooapis.com/fantasy/v2/player/${playerKey}`;
      const altPlayerData = await fetchYahooApi<any>(altPlayerUrl, { 
        timeout: 3000,
        skipCache: true
      });
      
      const altGameDate = altPlayerData?.fantasy_content?.player?.[0]?.game_date?.[0];
      const altGameTime = altPlayerData?.fantasy_content?.player?.[0]?.game_time?.[0];
      const altGameStartTime = altPlayerData?.fantasy_content?.player?.[0]?.game_start_time?.[0];
      
      if (altGameStartTime) {
        const result = {
          has_game_today: true,
          game_start_time: altGameStartTime,
          data_source: 'yahoo_alt_game_start_time'
        };
        await setCachedData(cacheKey, result, { ttl: 60 * 15 });
        return result;
      }
      
      if (altGameDate && altGameTime) {
        const result = {
          has_game_today: true,
          game_start_time: `${altGameDate} ${altGameTime}`,
          data_source: 'yahoo_alt_game_date_time'
        };
        await setCachedData(cacheKey, result, { ttl: 60 * 15 });
        return result;
      }
      
      if (altGameDate) {
        const result = {
          has_game_today: true,
          game_start_time: altGameDate,
          data_source: 'yahoo_alt_game_date'
        };
        await setCachedData(cacheKey, result, { ttl: 60 * 15 });
        return result;
      }
    } catch (e) {
      console.error(`Yahoo API: Error fetching alternative game data:`, e);
    }
    
    // Cache the negative result too, but with shorter TTL
    await setCachedData(cacheKey, defaultResponse, { ttl: 60 * 5 }); // Cache for 5 minutes
    return defaultResponse;
    
  } catch (e) {
    console.error(`Yahoo API: Error checking game info:`, e);
    return defaultResponse;
  }
} 