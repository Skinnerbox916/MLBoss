import { getAccessToken } from '../lib/server/auth';
import { YahooApiOptions } from '../lib/shared/types';
import { serverCache } from '../lib/server/cache';
import { deduplicateRequest } from '../lib/server/request-deduplication';
import { 
  API_TIMEOUT, 
  processYahooResponse, 
  YAHOO_ENDPOINTS,
  extractMlbGameId,
  extractTeamKey,
  extractPlayerGameInfo
} from './yahoo-api-utils';

/**
 * Fetch data from Yahoo API (server-side version with caching and request deduplication)
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
  
  // Generate cache key - this will be used for both caching and deduplication
  const cacheKey = cache.generateCacheKey(endpoint, {}, options.category);
  
  // For realtime data, always fetch fresh data first
  if (options.category === 'realtime' && useCache) {
    try {
      // Use deduplication for realtime requests
      const responseData = await deduplicateRequest<T>(
        `realtime:${cacheKey}`,
        async () => {
          console.log(`Yahoo API: Fetching fresh realtime data for ${endpoint}`);
          const response = await fetch(endpoint, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: AbortSignal.timeout(options.timeout || API_TIMEOUT),
          });

          if (response.ok) {
            const data = await processYahooResponse<T>(response);

            // Cache the response
            await cache.setCachedData(cacheKey, data, { 
              ttl: options.ttl,
              category: options.category
            });

            return data;
          }
          throw new Error(`Response not OK: ${response.status}`);
        }
      );

      return responseData;
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

  // Fetch fresh data with deduplication
  const responseData = await deduplicateRequest<T>(
    `fetch:${cacheKey}`,
    async () => {
      console.log(`Yahoo API: Fetching ${endpoint}`);
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(options.timeout || API_TIMEOUT),
      });

      const data = await processYahooResponse<T>(response);

      // Cache the response
      if (useCache) {
        await cache.setCachedData(cacheKey, data, { 
          ttl: options.ttl,
          category: options.category
        });
      }

      return data;
    }
  );

  return responseData;
}

/**
 * Get MLB game ID from Yahoo API
 * @returns MLB game ID
 */
export async function getYahooMlbGameId(): Promise<string> {
  const gameData = await fetchYahooApi<any>(YAHOO_ENDPOINTS.MLB_GAME, { 
    category: 'static',
    ttl: 24 * 60 * 60
  });
  
  return extractMlbGameId(gameData);
}

/**
 * Get user's team key
 * @param gameId Yahoo MLB game ID
 * @returns Team key
 */
export async function getYahooTeamKey(gameId: string): Promise<string> {
  const teamData = await fetchYahooApi<any>(YAHOO_ENDPOINTS.USER_TEAMS(gameId), {
    category: 'daily',
    ttl: 60 * 60
  });
  
  return extractTeamKey(teamData);
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
    const playerUrl = YAHOO_ENDPOINTS.PLAYER_STATS(playerKey, today);
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
        const gameInfo = extractPlayerGameInfo(data);
        
        if (gameInfo.has_game_today) {
          return gameInfo;
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
      const gameInfo = extractPlayerGameInfo(cachedData);
      if (gameInfo.has_game_today) {
        return {
          ...gameInfo,
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