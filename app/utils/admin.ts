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
      'legacy:team': { count: 0, ttl: '24h' },
      'legacy:game': { count: 0, ttl: '1h' },
      'legacy:other': { count: 0, ttl: '15m' },
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
            categories[meta.category] = categories[meta.category] || { count: 0, ttl: formatTTL(meta.ttl) };
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
          } else if (key.startsWith('team:')) {
            category = 'legacy:team';
            categories['legacy:team'].count++;
          } else if (key.startsWith('game:')) {
            category = 'legacy:game';
            categories['legacy:game'].count++;
          } else {
            category = 'legacy:other';
            categories['legacy:other'].count++;
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
    
    // Handle category patterns
    if (category === 'static' || category === 'daily' || category === 'realtime') {
      pattern = `${category}:*`;
    } else if (category === 'legacy:team') {
      pattern = 'team:*';
    } else if (category === 'legacy:game') {
      pattern = 'game:*';
    } else if (category === 'legacy:other') {
      // More complex, exclude known categories
      const excludedPatterns = ['static:*', 'daily:*', 'realtime:*', 'team:*', 'game:*'];
      
      // Get all keys
      const allKeys = await redis.keys('data:*');
      
      // Filter out the excluded patterns
      const keysToDelete = allKeys.filter((key: string) => {
        const keyWithoutPrefix = key.replace('data:', '');
        return !excludedPatterns.some(pattern => 
          keyWithoutPrefix.match(new RegExp(`^${pattern.replace('*', '.*')}$`))
        );
      });
      
      // Delete filtered keys and their meta keys
      const metaKeysToDelete = keysToDelete.map((key: string) => key.replace('data:', 'meta:'));
      const allKeysToDelete = [...keysToDelete, ...metaKeysToDelete];
      
      if (allKeysToDelete.length > 0) {
        await redis.del(...allKeysToDelete);
      }
      
      return keysToDelete.length;
    } else {
      // For special cases where we want to clear keys with a specific category metadata
      // This is more complex and requires scanning the metadata
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
    
    // For standard pattern-based deletion
    const dataKeys = await redis.keys(`data:${pattern}`);
    const metaKeys = await redis.keys(`meta:${pattern}`);
    const allKeys = [...dataKeys, ...metaKeys];
    
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
    
    return dataKeys.length;
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