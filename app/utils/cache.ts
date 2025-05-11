// Use dynamic imports for server-side modules
import type { Redis } from 'ioredis';
import { CacheOptions, CacheMetadata, CacheStats, CACHE_CATEGORIES } from './cache-types';
import { generateDataKey, generateMetaKey, extractOriginalKey } from './cache-keys';

// Set default cache durations
const DEFAULT_CACHE_TTL = parseInt(process.env.DEFAULT_CACHE_TTL || '900', 10); // 15 minutes

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
export const getRedisClient = async (): Promise<Redis | null> => {
  // Only run on server
  if (typeof window !== 'undefined') {
    console.log('REDIS: Cannot use Redis client in browser environment');
    return null;
  }

  if (!CACHE_ENABLED) {
    console.log('REDIS: Cache is disabled via CACHE_ENABLED environment variable');
    return null;
  }

  if (!redisClient) {
    try {
      console.log('REDIS: Initializing connection to Redis server', {
        url: REDIS_URL.replace(/\/\/.*@/, '//[auth-hidden]@'), // Hide auth info in logs
        cacheEnabled: CACHE_ENABLED
      });
      
      // Dynamically import ioredis only on the server side
      const Redis = (await import('ioredis')).default;
      
      redisClient = new Redis(REDIS_URL, {
        reconnectOnError: (err) => {
          console.error('REDIS: Connection error, will attempt to reconnect:', err.message);
          return true;
        },
        connectTimeout: 5000,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          console.log(`REDIS: Connection retry attempt ${times}, delay ${delay}ms`);
          return delay;
        },
      });
      
      redisClient.on('error', (err) => {
        console.error('REDIS: Error event:', err.message);
      });
      
      redisClient.on('connect', () => {
        console.log('REDIS: Connected to Redis server');
      });
      
      redisClient.on('ready', () => {
        console.log('REDIS: Redis client is ready for use');
        // Log Redis info on startup
        if (redisClient) {
          redisClient.info().then(info => {
            const lines = info.split('\n');
            const version = lines.find(line => line.startsWith('redis_version'));
            const memory = lines.find(line => line.startsWith('used_memory_human'));
            const clients = lines.find(line => line.startsWith('connected_clients'));
            console.log('REDIS: Server info', { version, memory, clients });
          }).catch(err => {
            console.error('REDIS: Error fetching Redis info:', err.message);
          });
        }
      });
      
      redisClient.on('reconnecting', (delay: number) => {
        console.log(`REDIS: Reconnecting to Redis after ${delay}ms`);
      });
      
      redisClient.on('end', () => {
        console.log('REDIS: Connection to Redis server ended');
      });
      
      // Add command monitoring for the 'daily' category operations - useful for debugging
      const monitorCommands = process.env.REDIS_MONITOR_COMMANDS === 'true';
      if (monitorCommands) {
        redisClient.on('select', (db) => {
          console.log(`REDIS: Selected database ${db}`);
        });
        
        redisClient.on('command', (cmd, args) => {
          if (args && args.length > 0) {
            const key = args[0]?.toString() || '';
            if (key.includes('daily:')) {
              console.log(`REDIS: Command ${cmd} for ${key}`);
            }
          }
        });
      }
    } catch (error) {
      console.error('REDIS: Failed to initialize Redis client:', error);
      return null;
    }
  }
  
  return redisClient;
};

/**
 * Get cached data from Redis
 */
export async function getCachedData<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
  const redis = await getRedisClient();
  if (!redis) return null;
  
  try {
    const dataKey = generateDataKey(key);
    const metaKey = generateMetaKey(key);
    
    const [dataStr, metaStr] = await Promise.all([
      redis.get(dataKey),
      redis.get(metaKey)
    ]);
    
    if (!dataStr) return null;
    
    // If we have metadata, check expiration
    if (metaStr) {
      const meta = JSON.parse(metaStr) as CacheMetadata;
      const now = Date.now();
      
      // Check if data is stale
      if (meta.expiresAt < now) {
        // For realtime data, return null if stale unless allowStale is true
        if (meta.category === 'realtime' && options.allowStale !== true) {
          return null;
        }
        
        // For other categories, return stale data unless explicitly disallowed
        if ((meta.category === 'static' || meta.category === 'daily') && 
            options.allowStale === false) {
          return null;
        }
        
        console.log(`Cache: Using stale data for ${key}`);
      }
    }
    
    return JSON.parse(dataStr) as T;
  } catch (error) {
    console.error(`Cache: Error getting data for ${key}:`, error);
    return null;
  }
}

/**
 * Set cached data in Redis
 */
export async function setCachedData<T>(
  key: string, 
  data: T, 
  options: CacheOptions = {}
): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  
  try {
    const isDaily = key.startsWith('daily:') || options.category === 'daily';
    
    // Determine TTL based on category
    let ttl = CACHE_CATEGORIES.realtime.ttl; // Default to realtime TTL
    
    if (options.ttl !== undefined) {
      ttl = options.ttl;
    } else if (options.category) {
      ttl = CACHE_CATEGORIES[options.category].ttl;
    } else if (key.startsWith('static:')) {
      ttl = CACHE_CATEGORIES.static.ttl;
    } else if (key.startsWith('daily:')) {
      ttl = CACHE_CATEGORIES.daily.ttl;
    } else if (key.startsWith('realtime:')) {
      ttl = CACHE_CATEGORIES.realtime.ttl;
    }
    
    if (isDaily) {
      console.log(`DAILY CACHE - Set: ${key}, ttl: ${ttl}s, expires: ${new Date(Date.now() + ttl * 1000).toISOString()}`);
    }
    
    // Set metadata
    const meta: CacheMetadata = {
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl * 1000,
      ttl,
      category: options.category
    };
    
    // Convert data to string and measure size
    const dataString = JSON.stringify(data);
    const dataSize = dataString.length;
    
    // Store data and metadata
    const dataKey = generateDataKey(key);
    const metaKey = generateMetaKey(key);
    
    await redis.set(dataKey, dataString, 'EX', ttl);
    await redis.set(metaKey, JSON.stringify(meta), 'EX', ttl);
    
    if (isDaily) {
      console.log(`DAILY CACHE - Set complete: ${key}, size: ${dataSize} bytes`);
    }
    
    console.log(`Cache: Set for key ${key} with TTL ${ttl}s${options.category ? ` (${options.category})` : ''}`);
  } catch (error) {
    const isDaily = key.startsWith('daily:') || options.category === 'daily';
    if (isDaily) {
      console.error(`DAILY CACHE - SET ERROR: ${key}`, error);
    }
    console.error(`Cache: Error setting data for key ${key}:`, error);
  }
}

/**
 * Delete cached data from Redis
 */
export async function deleteCachedData(key: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  
  try {
    const dataKey = generateDataKey(key);
    const metaKey = generateMetaKey(key);
    
    await redis.del(dataKey, metaKey);
  } catch (error) {
    console.error(`Cache: Error deleting data for key ${key}:`, error);
  }
}

/**
 * Clear cache by prefix
 */
export async function clearCacheByPrefix(prefix: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  
  try {
    const dataKeys = await redis.keys(`data:${prefix}*`);
    const metaKeys = await redis.keys(`meta:${prefix}*`);
    
    if (dataKeys.length > 0 || metaKeys.length > 0) {
      await redis.del(...dataKeys, ...metaKeys);
    }
  } catch (error) {
    console.error(`Cache: Error clearing cache with prefix ${prefix}:`, error);
  }
}

/**
 * Server-side cache administration functions
 */
export const serverAdmin = {
  /**
   * Get all cache keys with their sizes
   */
  async getCacheKeys(): Promise<{[key: string]: number}> {
    try {
      const redis = await getRedisClient();
      if (!redis) return {};
      
      const dataKeys = await redis.keys('data:*');
      const result: {[key: string]: number} = {};
      
      for (const key of dataKeys) {
        const value = await redis.get(key);
        if (value) {
          const size = value.length;
          const cleanKey = extractOriginalKey(key);
          result[cleanKey] = size;
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error getting cache keys:', error);
      return {};
    }
  },

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<CacheStats> {
    try {
      const keys = await this.getCacheKeys();
      
      let totalSize = 0;
      for (const size of Object.values(keys)) {
        totalSize += size;
      }
      
      const sortedKeys = Object.entries(keys)
        .sort(([, sizeA], [, sizeB]) => sizeB - sizeA)
        .slice(0, 10)
        .map(([key, size]) => ({key, size}));
      
      const keysPerCategory: {[category: string]: number} = {};
      
      for (const key of Object.keys(keys)) {
        let category = 'unknown';
        
        if (key.startsWith('static:')) {
          category = 'static';
        } else if (key.startsWith('daily:')) {
          category = 'daily';
        } else if (key.startsWith('realtime:')) {
          category = 'realtime';
        }
        
        keysPerCategory[category] = (keysPerCategory[category] || 0) + 1;
      }
      
      return {
        totalKeys: Object.keys(keys).length,
        totalSize,
        largestKeys: sortedKeys,
        keysPerCategory
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return {
        totalKeys: 0,
        totalSize: 0,
        largestKeys: [],
        keysPerCategory: {}
      };
    }
  },

  /**
   * Clear all cache keys with the given prefix
   */
  async clearCache(prefix?: string): Promise<number> {
    try {
      const redis = await getRedisClient();
      if (!redis) return 0;
      
      let keys: string[] = [];
      
      if (prefix) {
        const dataKeys = await redis.keys(`data:${prefix}*`);
        const metaKeys = await redis.keys(`meta:${prefix}*`);
        keys = [...dataKeys, ...metaKeys];
      } else {
        const dataKeys = await redis.keys('data:*');
        const metaKeys = await redis.keys('meta:*');
        keys = [...dataKeys, ...metaKeys];
      }
      
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      
      return keys.length;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return 0;
    }
  },

  /**
   * Get a specific cache value for debugging
   */
  async getCacheValue(key: string): Promise<string | null> {
    try {
      const redis = await getRedisClient();
      if (!redis) return null;
      
      const dataKey = generateDataKey(key);
      return await redis.get(dataKey);
    } catch (error) {
      console.error(`Error getting cache value for ${key}:`, error);
      return null;
    }
  }
};

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