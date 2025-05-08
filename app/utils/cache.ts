import Redis from 'ioredis';

// Set default cache durations
const DEFAULT_CACHE_TTL = parseInt(process.env.DEFAULT_CACHE_TTL || '900', 10); // 15 minutes
const GAME_DATA_CACHE_TTL = parseInt(process.env.GAME_DATA_CACHE_TTL || '3600', 10); // 1 hour
const TEAM_DATA_CACHE_TTL = parseInt(process.env.TEAM_DATA_CACHE_TTL || '86400', 10); // 24 hours

// Data category TTLs
const STATIC_DATA_TTL = parseInt(process.env.STATIC_DATA_TTL || '86400', 10); // 24 hours - player teams, positions, etc.
const DAILY_DATA_TTL = parseInt(process.env.DAILY_DATA_TTL || '43200', 10); // 12 hours - probable pitchers, matchups, etc.
const REALTIME_DATA_TTL = parseInt(process.env.REALTIME_DATA_TTL || '900', 10); // 15 minutes - stats, scores, etc.

// Environment variables with fallbacks for local development
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';

// Create Redis client instance
let redisClient: Redis | null = null;

// Initialize Redis client
export const getRedisClient = (): Redis | null => {
  if (!CACHE_ENABLED) {
    return null;
  }

  if (!redisClient) {
    try {
      redisClient = new Redis(REDIS_URL, {
        // Reconnect on errors
        reconnectOnError: (err) => {
          console.error('Redis connection error:', err);
          return true; // Always attempt to reconnect
        },
        // Set connection timeout
        connectTimeout: 5000,
        // Retry strategy
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });
      
      redisClient.on('error', (err) => {
        console.error('Redis error:', err);
      });
      
      redisClient.on('connect', () => {
        console.log('Connected to Redis');
      });
      
    } catch (error) {
      console.error('Error creating Redis client:', error);
      return null;
    }
  }

  return redisClient;
};

interface CacheOptions {
  ttl?: number;
  allowStale?: boolean;
  /**
   * Data category that determines caching behavior:
   * - static: Longest TTL (24h), prioritizes cached data even if stale
   * - daily: Medium TTL (12h), prioritizes cached data even if stale
   * - realtime: Short TTL (15m), prioritizes fresh data, uses cache as fallback
   */
  category?: 'static' | 'daily' | 'realtime';
}

/**
 * Get cached value with optional stale fallback
 * @param key Cache key
 * @param options Cache options
 * @returns Cached value or null
 */
export async function getCachedData<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  
  try {
    // Try to get the data and metadata
    const cachedData = await redis.get(`data:${key}`);
    const cachedMeta = await redis.get(`meta:${key}`);
    
    if (!cachedData) return null;
    
    // Parse the data
    const data = JSON.parse(cachedData) as T;
    
    // Get category from metadata or from key
    let category = 'unknown';
    if (cachedMeta) {
      const meta = JSON.parse(cachedMeta);
      category = meta.category || 
        (key.startsWith('static:') ? 'static' : 
          key.startsWith('daily:') ? 'daily' : 
            key.startsWith('realtime:') ? 'realtime' : 'unknown');
      
      // Check if data is stale based on category
      const isStale = meta.expiresAt < Date.now();
      
      if (isStale) {
        // For realtime data, return null if stale to always get fresh data
        // unless allowStale is explicitly set to true
        if (category === 'realtime' || options.category === 'realtime') {
          if (options.allowStale !== true) {
            console.log(`Cache: Skipping stale realtime data for key ${key}`);
            return null;
          }
        } 
        // For static/daily data, allow stale data by default unless explicitly disallowed
        else if ((category === 'static' || category === 'daily' || 
            options.category === 'static' || options.category === 'daily')) {
          if (options.allowStale === false) {
            console.log(`Cache: Skipping stale ${category} data for key ${key}`);
            return null;
          }
        }
        
        // Log that we're using stale data, but still return it
        console.log(`Cache: Using stale ${category} data for key ${key} (expired at ${new Date(meta.expiresAt).toISOString()})`);
      }
    }
    
    console.log(`Cache: Hit for key ${key} (${category})`);
    return data;
  } catch (error) {
    console.error(`Cache: Error getting data for key ${key}:`, error);
    return null;
  }
}

/**
 * Set cached value with metadata
 * @param key Cache key
 * @param data Data to cache
 * @param options Cache options
 */
export async function setCachedData<T>(
  key: string, 
  data: T, 
  options: CacheOptions = {}
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  
  try {
    // Default TTL based on data category or key prefix
    let ttl = DEFAULT_CACHE_TTL;
    
    // First check for category-based TTL
    if (options.category) {
      if (options.category === 'static') {
        ttl = STATIC_DATA_TTL;
      } else if (options.category === 'daily') {
        ttl = DAILY_DATA_TTL;
      } else if (options.category === 'realtime') {
        ttl = REALTIME_DATA_TTL;
      }
    } 
    // Fall back to key prefix-based TTL if no category
    else if (key.startsWith('static:')) {
      ttl = STATIC_DATA_TTL;
    } else if (key.startsWith('daily:')) {
      ttl = DAILY_DATA_TTL;
    } else if (key.startsWith('realtime:')) {
      ttl = REALTIME_DATA_TTL;
    } else if (key.startsWith('game:')) {
      ttl = GAME_DATA_CACHE_TTL;
    } else if (key.startsWith('team:')) {
      ttl = TEAM_DATA_CACHE_TTL;
    }
    
    // Use provided TTL if specified
    if (options.ttl !== undefined) {
      ttl = options.ttl;
    }
    
    // Set metadata
    const meta = {
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl * 1000,
      ttl,
      category: options.category // Store category in metadata
    };
    
    // Store data and metadata
    await redis.set(`data:${key}`, JSON.stringify(data), 'EX', ttl);
    await redis.set(`meta:${key}`, JSON.stringify(meta), 'EX', ttl);
    
    console.log(`Cache: Set for key ${key} with TTL ${ttl}s${options.category ? ` (${options.category})` : ''}`);
  } catch (error) {
    console.error(`Cache: Error setting data for key ${key}:`, error);
  }
}

/**
 * Delete cached value
 * @param key Cache key
 */
export async function deleteCachedData(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  
  try {
    await redis.del(`data:${key}`, `meta:${key}`);
    console.log(`Cache: Deleted key ${key}`);
  } catch (error) {
    console.error(`Cache: Error deleting key ${key}:`, error);
  }
}

/**
 * Clear all cached values with a specific prefix
 * @param prefix Key prefix to clear
 */
export async function clearCacheByPrefix(prefix: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  
  try {
    // Get all keys matching the prefix
    const dataKeys = await redis.keys(`data:${prefix}*`);
    const metaKeys = await redis.keys(`meta:${prefix}*`);
    const allKeys = [...dataKeys, ...metaKeys];
    
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
      console.log(`Cache: Cleared ${allKeys.length} keys with prefix ${prefix}`);
    }
  } catch (error) {
    console.error(`Cache: Error clearing keys with prefix ${prefix}:`, error);
  }
}

/**
 * Generate a cache key for Yahoo API requests
 * @param endpoint Yahoo API endpoint
 * @param params Additional parameters
 * @param category Optional data category prefix
 * @returns Cache key
 */
export function generateYahooCacheKey(
  endpoint: string, 
  params: Record<string, string> = {},
  category?: 'static' | 'daily' | 'realtime'
): string {
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
    
  if (category) {
    return `${category}:yahoo:${endpoint}${sortedParams ? `:${sortedParams}` : ''}`;
  }
  
  return `yahoo:${endpoint}${sortedParams ? `:${sortedParams}` : ''}`;
} 