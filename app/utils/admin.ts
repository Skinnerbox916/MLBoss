// This file is server-only
import { getRedisClient } from './cache';
import type { Redis } from 'ioredis';

// Helper function to get the Redis client and handle async
async function getClient(): Promise<Redis> {
  const client = await getRedisClient();
  if (!client) {
    throw new Error('Redis client not available');
  }
  return client;
}

/**
 * Get all cache keys with their sizes
 */
export async function getCacheKeys(): Promise<{[key: string]: number}> {
  try {
    const client = await getClient();
    
    // Get all data keys
    const dataKeys = await client.keys('data:*');
    const metaKeys = await client.keys('meta:*');
    
    const result: {[key: string]: number} = {};
    
    // Get info about each key
    for (const key of dataKeys) {
      const value = await client.get(key);
      if (value) {
        const size = value.length;
        const cleanKey = key.replace('data:', '');
        result[cleanKey] = size;
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error getting cache keys:', error);
    return {};
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalKeys: number;
  totalSize: number;
  largestKeys: {key: string; size: number}[];
  keysPerCategory: {[category: string]: number};
}> {
  try {
    const keys = await getCacheKeys();
    
    // Calculate total size
    let totalSize = 0;
    for (const size of Object.values(keys)) {
      totalSize += size;
    }
    
    // Get largest keys
    const sortedKeys = Object.entries(keys)
      .sort(([, sizeA], [, sizeB]) => sizeB - sizeA)
      .slice(0, 10)
      .map(([key, size]) => ({key, size}));
    
    // Count keys per category
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
}

/**
 * Clear all cache keys with the given prefix
 */
export async function clearCache(prefix?: string): Promise<number> {
  try {
    const client = await getClient();
    let keys: string[] = [];
    
    if (prefix) {
      // Get all keys with the given prefix
      keys = await client.keys(`data:${prefix}*`);
      const metaKeys = await client.keys(`meta:${prefix}*`);
      keys = [...keys, ...metaKeys];
    } else {
      // Get all keys
      keys = await client.keys('data:*');
      const metaKeys = await client.keys('meta:*');
      keys = [...keys, ...metaKeys];
    }
    
    if (keys.length > 0) {
      // Delete all keys
      await client.del(...keys);
    }
    
    return keys.length;
  } catch (error) {
    console.error('Error clearing cache:', error);
    return 0;
  }
}

/**
 * Get a specific cache value for debugging
 */
export async function getCacheValue(key: string): Promise<string | null> {
  try {
    const client = await getClient();
    const dataKey = `data:${key}`;
    const value = await client.get(dataKey);
    return value;
  } catch (error) {
    console.error(`Error getting cache value for ${key}:`, error);
    return null;
  }
}

/**
 * Get Redis instance info and cache statistics
 * @returns Redis cache information and statistics
 */
export async function getRedisInfo() {
  try {
    const client = await getClient();
    
    // Get all keys
    const dataKeys = await client.keys('data:*');
    const metaKeys = await client.keys('meta:*');
    
    // Get redis info for memory usage
    const info = await client.info();
    const memoryMatch = info.match(/used_memory_human:(.*)/);
    const memoryUsage = memoryMatch ? memoryMatch[1].trim() : '0 MB';
    
    // Initialize categories
    const categories: Record<string, { count: number, ttl: string }> = {
      'static': { count: 0, ttl: '24h' },
      'daily': { count: 0, ttl: '12h' },
      'realtime': { count: 0, ttl: '15m' },
      'other': { count: 0, ttl: 'varied' }
    };
    
    // Get all meta keys to extract categories
    const keyDetails = await Promise.all(
      metaKeys.map(async (metaKey: string) => {
        const dataKey = metaKey.replace('meta:', 'data:');
        
        try {
          const metaData = await client.get(metaKey);
          if (!metaData) return null;
          
          const meta = JSON.parse(metaData);
          const key = dataKey.replace('data:', '');
          
          // Determine category
          let category: string;
          
          if (meta.category) {
            // Categorized by explicit category field
            category = meta.category;
            if (!categories[meta.category]) {
              // If it's a non-standard category, add it
              categories[meta.category] = { count: 0, ttl: formatTTL(meta.ttl) };
            }
            categories[meta.category].count++;
          } else if (key.startsWith('static:')) {
            category = 'static';
            categories.static.count++;
          } else if (key.startsWith('daily:')) {
            category = 'daily';
            categories.daily.count++;
          } else if (key.startsWith('realtime:')) {
            category = 'realtime';
            categories.realtime.count++;
          } else {
            // Any other format goes to 'other'
            category = 'other';
            categories.other.count++;
          }
          
          return {
            name: key,
            category,
            ttl: formatTTL(meta.ttl),
            expiresAt: meta.expiresAt ? new Date(meta.expiresAt).toISOString() : null,
          };
        } catch (e) {
          console.error(`Error processing key ${metaKey}:`, e);
          return null;
        }
      })
    );
    
    // Filter out null values
    const filteredKeyDetails = keyDetails.filter(Boolean);
    
    return {
      totalKeys: dataKeys.length,
      memoryUsage,
      hitRate: 'N/A', // Would need additional tracking to calculate hit rate
      categories,
      keys: filteredKeyDetails,
    };
  } catch (error) {
    console.error('Error getting Redis info:', error);
    return {
      error: 'Error fetching Redis info',
      totalKeys: 0,
      memoryUsage: '0 MB',
      categories: {},
    };
  }
}

/**
 * Clear Redis cache by category
 */
export async function clearCacheCategory(category: string) {
  try {
    const client = await getClient();
    let keys: string[] = [];
    let count = 0;
    
    // Get all matching data and meta keys
    if (category === 'all') {
      // Clear all keys
      const dataKeys = await client.keys('data:*');
      const metaKeys = await client.keys('meta:*');
      keys = [...dataKeys, ...metaKeys];
    } else {
      // Clear by specific category - both by prefix and by metadata
      const categoryKeys = await client.keys(`data:${category}:*`);
      const categoryMetaKeys = await client.keys(`meta:${category}:*`);
      
      // Also check meta keys for category field
      const metaKeys = await client.keys('meta:*');
      
      // Add keys from category prefix
      keys = [...categoryKeys, ...categoryMetaKeys];
      count = keys.length;
      
      // Now check all meta keys for category field
      for (const metaKey of metaKeys) {
        const metaValue = await client.get(metaKey);
        if (metaValue) {
          try {
            const meta = JSON.parse(metaValue);
            if (meta.category === category) {
              // Include this key and its data key
              const dataKey = metaKey.replace('meta:', 'data:');
              if (!keys.includes(metaKey)) keys.push(metaKey);
              if (!keys.includes(dataKey)) keys.push(dataKey);
            }
          } catch (e) {
            console.error(`Error parsing meta key ${metaKey}:`, e);
          }
        }
      }
    }
    
    // Delete all keys
    if (keys.length > 0) {
      await client.del(...keys);
    }
    
    return { 
      clearedKeys: keys.length,
      category
    };
  } catch (error) {
    console.error(`Error clearing cache category ${category}:`, error);
    return { 
      error: `Error clearing cache category ${category}`, 
      clearedKeys: 0,
      category
    };
  }
}

/**
 * Format TTL seconds to human-readable format
 */
function formatTTL(seconds: number): string {
  if (!seconds) return 'unknown';
  
  if (seconds >= 86400) {
    return `${Math.round(seconds / 86400)}d`;
  } else if (seconds >= 3600) {
    return `${Math.round(seconds / 3600)}h`;
  } else if (seconds >= 60) {
    return `${Math.round(seconds / 60)}m`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Clear all cache
 */
export async function clearAllCache() {
  try {
    const client = await getClient();
    // Get all keys
    const keys = await client.keys('*');
    
    if (keys.length > 0) {
      await client.del(...keys);
    }
    
    return { 
      success: true,
      clearedKeys: keys.length 
    };
  } catch (error) {
    console.error('Error clearing all cache:', error);
    return { 
      success: false, 
      error: 'Error clearing cache',
      clearedKeys: 0 
    };
  }
} 