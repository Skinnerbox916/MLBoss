// Server-side cache implementation
import type { Redis } from 'ioredis';
import { CacheInterface, CacheOptions, CacheMetadata, CacheStats, CACHE_CATEGORIES } from '../shared/types';
import { generateDataKey, generateMetaKey, extractOriginalKey, generateYahooCacheKey } from '../shared/cache-keys';

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
  if (!CACHE_ENABLED) {
    console.log('REDIS: Cache is disabled via CACHE_ENABLED environment variable');
    return null;
  }

  if (!redisClient) {
    try {
      console.log('REDIS: Initializing connection to Redis server', {
        url: REDIS_URL.replace(/\/\/.*@/, '//[auth-hidden]@'), // Hide auth info in logs
        dailyTTL: DAILY_DATA_TTL,
        cacheEnabled: CACHE_ENABLED
      });
      
      // Dynamically import ioredis only on the server side
      const Redis = (await import('ioredis')).default;
      
      redisClient = new Redis(REDIS_URL, {
        // Reconnect on errors
        reconnectOnError: (err) => {
          console.error('REDIS: Connection error, will attempt to reconnect:', err.message);
          return true; // Always attempt to reconnect
        },
        // Set connection timeout
        connectTimeout: 5000,
        // Retry strategy
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          console.log(`REDIS: Connection retry attempt ${times}, delay ${delay}ms`);
          return delay;
        },
      });
      
      // Error events
      redisClient.on('error', (err) => {
        console.error('REDIS: Error event:', err.message);
      });
      
      // Connection events
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
      console.error('REDIS: Error creating Redis client:', error);
      return null;
    }
  }

  return redisClient;
};

/**
 * Server-side cache implementation using Redis
 */
export const serverCache: CacheInterface = {
  /**
   * Get cached data with optional stale fallback
   */
  async getCachedData<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const redis = await getRedisClient();
    if (!redis) return null;
    
    try {
      // Record start time for performance measurement
      const startTime = Date.now();
      const isDaily = key.startsWith('daily:') || options.category === 'daily';
      
      if (isDaily) {
        console.log(`DAILY CACHE - Get attempt: ${key}, allowStale: ${options.allowStale}`);
      }
      
      // Try to get the data and metadata
      const cachedData = await redis.get(generateDataKey(key));
      const cachedMeta = await redis.get(generateMetaKey(key));
      
      if (!cachedData) {
        if (isDaily) {
          console.log(`DAILY CACHE - MISS: ${key} - Data not found in Redis`);
        }
        return null;
      }
      
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
        
        if (isDaily) {
          console.log(`DAILY CACHE - Meta: ${key}, isStale: ${isStale}, expiresAt: ${new Date(meta.expiresAt).toISOString()}, now: ${new Date().toISOString()}`);
        }
        
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
              if (isDaily) {
                console.log(`DAILY CACHE - Skipping stale data: ${key}, allowStale explicitly set to false`);
              }
              console.log(`Cache: Skipping stale ${category} data for key ${key}`);
              return null;
            }
            if (isDaily) {
              console.log(`DAILY CACHE - Using stale data: ${key}, allowStale: ${options.allowStale}, ttl: ${meta.ttl}`);
            }
          }
          
          // Log that we're using stale data, but still return it
          console.log(`Cache: Using stale ${category} data for key ${key} (expired at ${new Date(meta.expiresAt).toISOString()})`);
        }
      }
      
      const elapsed = Date.now() - startTime;
      if (isDaily) {
        console.log(`DAILY CACHE - HIT: ${key}, category: ${category}, size: ${cachedData.length} bytes, elapsed: ${elapsed}ms`);
      }
      console.log(`Cache: Hit for key ${key} (${category})`);
      return data;
    } catch (error) {
      const isDaily = key.startsWith('daily:') || options.category === 'daily';
      if (isDaily) {
        console.error(`DAILY CACHE - ERROR: ${key}`, error);
      }
      console.error(`Cache: Error getting data for key ${key}:`, error);
      return null;
    }
  },

  /**
   * Set cached value with metadata
   */
  async setCachedData<T>(
    key: string, 
    data: T, 
    options: CacheOptions = {}
  ): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;
    
    try {
      const isDaily = key.startsWith('daily:') || options.category === 'daily';
      
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
      }
      
      // Use provided TTL if specified
      if (options.ttl !== undefined) {
        ttl = options.ttl;
      }
      
      if (isDaily) {
        console.log(`DAILY CACHE - Set: ${key}, ttl: ${ttl}s, expires: ${new Date(Date.now() + ttl * 1000).toISOString()}`);
      }
      
      // Set metadata
      const meta = {
        createdAt: Date.now(),
        expiresAt: Date.now() + ttl * 1000,
        ttl,
        category: options.category // Store category in metadata
      };
      
      // Convert data to string and measure size
      const dataString = JSON.stringify(data);
      const dataSize = dataString.length;
      
      // Store data and metadata
      await redis.set(generateDataKey(key), dataString, 'EX', ttl);
      await redis.set(generateMetaKey(key), JSON.stringify(meta), 'EX', ttl);
      
      console.log(`Cache: Set key ${key} (${options.category || 'default'}), size: ${dataSize} bytes, ttl: ${ttl}s`);
    } catch (error) {
      console.error(`Cache: Error setting data for key ${key}:`, error);
    }
  },

  /**
   * Delete cached value and its metadata
   */
  async deleteCachedData(key: string): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;
    
    try {
      // Delete both data and metadata
      await redis.del(generateDataKey(key));
      await redis.del(generateMetaKey(key));
      
      console.log(`Cache: Deleted key ${key}`);
    } catch (error) {
      console.error(`Cache: Error deleting data for key ${key}:`, error);
    }
  },

  /**
   * Clear all keys with a specific prefix
   */
  async clearCacheByPrefix(prefix: string): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;
    
    try {
      // Use SCAN to find matching keys without blocking Redis
      let cursor = '0';
      let keysDeleted = 0;
      
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH', 
          `*${prefix}*`,
          'COUNT',
          '100'
        );
        
        cursor = nextCursor;
        
        if (keys.length > 0) {
          // Delete keys in batch
          await redis.del(...keys);
          keysDeleted += keys.length;
        }
      } while (cursor !== '0');
      
      console.log(`Cache: Cleared ${keysDeleted} keys with prefix ${prefix}`);
    } catch (error) {
      console.error(`Cache: Error clearing keys with prefix ${prefix}:`, error);
    }
  },

  /**
   * Generate a cache key for API requests
   */
  generateCacheKey(
    endpoint: string,
    params: Record<string, string> = {},
    category?: 'static' | 'daily' | 'realtime'
  ): string {
    return generateYahooCacheKey(endpoint, params, category);
  }
};

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

// Export functions directly for convenience
export const { 
  getCachedData, 
  setCachedData, 
  deleteCachedData, 
  clearCacheByPrefix,
  generateCacheKey
} = serverCache; 