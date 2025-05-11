import { parseString } from 'xml2js';
import { getAccessToken } from '../lib/server/auth';
import { YahooApiOptions } from '../lib/shared/types';
import { serverCache } from '../lib/server/cache';

const API_TIMEOUT = 5000;

/**
 * Fetch data from Yahoo API (server-side version with caching)
 * @param endpoint API endpoint URL
 * @param options Cache and API options
 * @returns Response data object
 */
export async function fetchYahooApi<T>(
  endpoint: string,
  options: YahooApiOptions = {}
): Promise<T> {
  const useCache = !options.skipCache;
  
  // Get access token
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  // Get cache implementation
  const cache = serverCache;
  
  // Generate cache key
  const cacheKey = cache.generateCacheKey(endpoint, {}, options.category);
  
  // For realtime data, always fetch fresh data first
  if (options.category === 'realtime' && useCache) {
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
        await cache.setCachedData(cacheKey, responseData, { 
          ttl: options.ttl,
          category: options.category
        });

        return responseData;
      }
    } catch (error) {
      console.warn(`Yahoo API: Error fetching fresh realtime data, will try cache: ${error}`);
    }
  }

  // Try to get from cache unless skipCache is true
  if (useCache) {
    const allowStale = options.category === 'daily' || options.category === 'static';
    
    console.log(`Yahoo API: Attempting to get ${options.category || 'unknown'} data from cache for ${endpoint} (allowStale: ${allowStale})`);
    
    const cachedData = await cache.getCachedData<T>(cacheKey, { 
      ttl: options.ttl,
      category: options.category,
      allowStale
    });
    
    if (cachedData) {
      console.log(`Yahoo API: Successfully retrieved cached data for ${endpoint}`);
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
  if (useCache) {
    await cache.setCachedData(cacheKey, responseData, { 
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
  const gameData = await fetchYahooApi<any>(gameUrl, { 
    category: 'static',
    ttl: 24 * 60 * 60
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
  const teamData = await fetchYahooApi<any>(teamUrl, {
    category: 'daily',
    ttl: 60 * 60
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
  // Default response structure
  const defaultResponse = {
    has_game_today: false,
    game_start_time: null,
    data_source: 'none'
  };
  
  if (!playerKey) {
    return defaultResponse;
  }
  
  try {
    // Get the current date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    // Get player stats for today
    const playerUrl = `https://fantasysports.yahooapis.com/fantasy/v2/player/${playerKey}/stats;type=date;date=${today}`;
    // Game information is realtime data - use realtime category with skipCache
    const cacheKey = serverCache.generateCacheKey('player_game_info', { playerKey, date: today }, 'realtime');
    console.log(`Player Game Info: Checking game status for player ${playerKey} on ${today}`);
    
    try {
      // Try to fetch fresh data for realtime needs
      const response = await fetch(playerUrl, {
        headers: {
          Authorization: `Bearer ${await getAccessToken()}`,
        },
        signal: AbortSignal.timeout(API_TIMEOUT),
      });

      if (response.ok) {
        const data = await response.json();
        const hasGame = data?.fantasy_content?.player?.[0]?.stats?.[0]?.stats?.[0]?.stat?.[0]?.value?.[0] !== '0';
        
        if (hasGame) {
          return {
            has_game_today: true,
            game_start_time: null, // Yahoo API doesn't provide game time
            data_source: 'yahoo'
          };
        }
      }
    } catch (error) {
      console.warn(`Player Game Info: Error fetching fresh data, will try cache: ${error}`);
    }

    // Try cache if fresh data fetch failed
    const cachedData = await serverCache.getCachedData<any>(cacheKey, { 
      category: 'realtime',
      allowStale: false
    });

    if (cachedData) {
      const hasGame = cachedData?.fantasy_content?.player?.[0]?.stats?.[0]?.stats?.[0]?.stat?.[0]?.value?.[0] !== '0';
      
      if (hasGame) {
        return {
          has_game_today: true,
          game_start_time: null, // Yahoo API doesn't provide game time
          data_source: 'yahoo_cache'
        };
      }
    }

    return defaultResponse;
  } catch (error) {
    console.error(`Player Game Info: Error checking game status: ${error}`);
    return defaultResponse;
  }
} 