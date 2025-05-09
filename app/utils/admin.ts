import { getRedisClient } from './cache';

/**
 * Get Redis instance info and cache statistics
 * @returns Redis cache information and statistics
 */
export async function getRedisInfo() {
  const redis = getRedisClient();
  if (!redis) {
    return {
      error: 'Redis is not available',
      totalKeys: 0,
      memoryUsage: '0 MB',
      categories: {},
    };
  }

  try {
    // Get all keys
    const dataKeys = await redis.keys('data:*');
    const metaKeys = await redis.keys('meta:*');
    
    // Get redis info for memory usage
    const info = await redis.info();
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
          const metaData = await redis.get(metaKey);
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
    throw error;
  }
}

/**
 * Clear Redis cache by category
 * @param category Cache category to clear
 * @returns Number of keys cleared
 */
export async function clearCacheCategory(category: string) {
  const redis = getRedisClient();
  if (!redis) {
    return 0;
  }

  try {
    let pattern: string;
    
    // Handle category patterns for standard categories
    if (category === 'static' || category === 'daily' || category === 'realtime') {
      pattern = `${category}:*`;
      
      // For standard pattern-based deletion
      const dataKeys = await redis.keys(`data:${pattern}`);
      const metaKeys = await redis.keys(`meta:${pattern}`);
      const allKeys = [...dataKeys, ...metaKeys];
      
      if (allKeys.length > 0) {
        await redis.del(...allKeys);
      }
      
      return dataKeys.length;
    } 
    else if (category === 'other') {
      // For the 'other' category, exclude known categories
      const allKeys = await redis.keys('data:*');
      const keysToDelete = allKeys.filter(key => {
        const keyWithoutPrefix = key.replace('data:', '');
        return !keyWithoutPrefix.startsWith('static:') && 
               !keyWithoutPrefix.startsWith('daily:') && 
               !keyWithoutPrefix.startsWith('realtime:');
      });
      
      // Delete filtered keys and their meta keys
      const metaKeysToDelete = keysToDelete.map(key => key.replace('data:', 'meta:'));
      const allKeysToDelete = [...keysToDelete, ...metaKeysToDelete];
      
      if (allKeysToDelete.length > 0) {
        await redis.del(...allKeysToDelete);
      }
      
      return keysToDelete.length;
    }
    else {
      // For custom categories, check metadata
      const metaKeys = await redis.keys('meta:*');
      
      const keysToDelete: string[] = [];
      
      for (const metaKey of metaKeys) {
        try {
          const metaData = await redis.get(metaKey);
          if (!metaData) continue;
          
          const meta = JSON.parse(metaData);
          if (meta.category === category) {
            keysToDelete.push(metaKey);
            keysToDelete.push(metaKey.replace('meta:', 'data:'));
          }
        } catch (e) {
          console.error(`Error processing key ${metaKey}:`, e);
        }
      }
      
      if (keysToDelete.length > 0) {
        await redis.del(...keysToDelete);
      }
      
      return keysToDelete.length / 2; // Count only data keys
    }
  } catch (error) {
    console.error('Error clearing cache category:', error);
    throw error;
  }
}

/**
 * Format TTL seconds into human readable format
 * @param seconds TTL in seconds
 * @returns Formatted TTL string
 */
function formatTTL(seconds: number): string {
  if (!seconds) return 'N/A';
  
  if (seconds >= 86400) {
    return `${Math.round(seconds / 86400)}h`;
  } else if (seconds >= 3600) {
    return `${Math.round(seconds / 3600)}h`;
  } else if (seconds >= 60) {
    return `${Math.round(seconds / 60)}m`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Clear all cache entries in Redis
 * @returns Number of keys cleared
 */
export async function clearAllCache() {
  const redis = getRedisClient();
  if (!redis) {
    return 0;
  }

  try {
    // Get all keys
    const dataKeys = await redis.keys('data:*');
    const metaKeys = await redis.keys('meta:*');
    const allKeys = [...dataKeys, ...metaKeys];
    
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
    
    return dataKeys.length; // Return the count of data keys cleared
  } catch (error) {
    console.error('Error clearing all cache:', error);
    throw error;
  }
} 