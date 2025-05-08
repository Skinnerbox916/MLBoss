import { parseString } from 'xml2js';
import { getAccessToken } from './auth.server';
import { getCachedData, setCachedData, generateYahooCacheKey } from './cache';

// Default timeout for API requests
const API_TIMEOUT = 5000;

interface ApiOptions {
  ttl?: number;
  skipCache?: boolean;
  timeout?: number;
  /**
   * Data category that determines caching behavior:
   * - static: Longest TTL (24h), prioritizes cached data even if stale
   * - daily: Medium TTL (12h), prioritizes cached data even if stale
   * - realtime: Short TTL (15m), prioritizes fresh data, uses cache as fallback
   */
  category?: 'static' | 'daily' | 'realtime';
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

  // Generate cache key from endpoint, respecting the category if provided
  const cacheKey = generateYahooCacheKey(endpoint, {}, options.category);
  
  // For realtime data, always fetch fresh data first
  if (options.category === 'realtime' && !options.skipCache) {
    try {
      // Fetch fresh data
      console.log(`Yahoo API: Fetching fresh realtime data for ${endpoint}`);
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(options.timeout || API_TIMEOUT),
      });

      if (response.ok) {
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
        await setCachedData(cacheKey, responseData, { 
          ttl: options.ttl,
          category: options.category
        });

        return responseData;
      }
      // If fetch fails, continue to try the cache below
    } catch (error) {
      console.warn(`Yahoo API: Error fetching fresh realtime data, will try cache: ${error}`);
      // Continue to try cache
    }
  }

  // Try to get from cache unless skipCache is true
  if (!options.skipCache) {
    // Set allowStale based on category
    // For daily and static data, we want to allow stale data by default
    const allowStale = options.category === 'daily' || options.category === 'static' ? true : false;
    
    console.log(`Yahoo API: Attempting to get ${options.category || 'unknown'} data from cache for ${endpoint} (allowStale: ${allowStale})`);
    
    const cachedData = await getCachedData<T>(cacheKey, { 
      ttl: options.ttl,
      category: options.category,
      // Explicitly set allowStale based on category
      allowStale: allowStale
    });
    
    if (cachedData) {
      console.log(`Yahoo API: Successfully retrieved cached data for ${endpoint}`);
      return cachedData;
    } else {
      console.log(`Yahoo API: No valid cache found for ${endpoint}, fetching fresh data`);
    }
  }

  // Fetch fresh data - always try for all categories if cache miss
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
    await setCachedData(cacheKey, responseData, { 
      ttl: options.ttl,
      category: options.category
    });
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
  // This is static data that rarely changes - use static category
  const gameData = await fetchYahooApi<any>(gameUrl, { 
    category: 'static',
    ttl: 24 * 60 * 60 // Fallback TTL in case category doesn't work
  });
  
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
  // Team assignment data changes daily - use daily category
  const teamData = await fetchYahooApi<any>(teamUrl, {
    category: 'daily',
    ttl: 60 * 60 // Cache for 1 hour as fallback
  });
  
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
    // Game information is realtime data - use realtime category with skipCache
    const cacheKey = generateYahooCacheKey('player_game_info', { playerKey, date: today }, 'realtime');
    
    // Always fetch fresh data first for realtime player game info
    try {
      // Fetch fresh data directly for realtime data
      const playerData = await fetchYahooApi<any>(playerUrl, { 
        timeout: 5000,
        skipCache: true, // Skip the cache check
        category: 'realtime'
      });
      
      // Extract game info from player data
      const coverageStart = playerData?.fantasy_content?.player?.[0]?.player_stats?.[0]?.coverage_metadata?.[0]?.coverage_start?.[0];
      if (coverageStart) {
        const result = {
          has_game_today: true,
          game_start_time: coverageStart,
          data_source: 'yahoo'
        };
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5 // Cache for just 5 minutes as fallback
        });
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
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5
        });
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
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5
        });
        return result;
      } 
      
      if (scheduledGameTime) {
        const result = {
          has_game_today: true,
          game_start_time: scheduledGameTime,
          data_source: 'yahoo_scheduled_game_time'
        };
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5
        });
        return result;
      }
      
      if (gameDate && gameTime) {
        const result = {
          has_game_today: true,
          game_start_time: `${gameDate} ${gameTime}`,
          data_source: 'yahoo_game_date_time'
        };
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5
        });
        return result;
      }
      
      if (gameDate) {
        const result = {
          has_game_today: true,
          game_start_time: gameDate,
          data_source: 'yahoo_game_date'
        };
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5
        });
        return result;
      }
      
      // If we get here, try the alternate endpoint
      const altPlayerUrl = `https://fantasysports.yahooapis.com/fantasy/v2/player/${playerKey}`;
      const altPlayerData = await fetchYahooApi<any>(altPlayerUrl, { 
        timeout: 5000,
        skipCache: true,
        category: 'realtime'
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
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5
        });
        return result;
      }
      
      if (altGameDate && altGameTime) {
        const result = {
          has_game_today: true,
          game_start_time: `${altGameDate} ${altGameTime}`,
          data_source: 'yahoo_alt_game_date_time'
        };
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5
        });
        return result;
      }
      
      if (altGameDate) {
        const result = {
          has_game_today: true,
          game_start_time: altGameDate,
          data_source: 'yahoo_alt_game_date'
        };
        await setCachedData(cacheKey, result, { 
          category: 'realtime',
          ttl: 60 * 5
        });
        return result;
      }
      
      // No game info found, cache negative result with short TTL
      await setCachedData(cacheKey, defaultResponse, {
        category: 'realtime',
        ttl: 60 * 5 // Cache for 5 min
      });
      return defaultResponse;
    } catch (error) {
      console.warn(`Error fetching fresh player game info for ${playerKey}, trying cache:`, error);
      
      // Check cache as fallback only if fresh data fetch failed
      const cachedData = await getCachedData<any>(cacheKey, { category: 'realtime' });
      if (cachedData) {
        console.log(`Using cached game info for player ${playerKey} as fallback`);
        return cachedData;
      }
    }
    
    return defaultResponse;
  } catch (error) {
    console.error(`Error getting game info for player ${playerKey}:`, error);
    return defaultResponse;
  }
} 