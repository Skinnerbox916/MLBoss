'use client';

import { CacheInterface, CacheOptions } from '../shared/types';

/**
 * Client-side cache metadata
 */
interface CacheMetadata {
  expiresAt: number;
  ttl: number;
  category?: string;
}

/**
 * Client-side cache implementation using localStorage
 */
export const clientCache: CacheInterface = {
  /**
   * Get cached data from localStorage
   */
  async getCachedData<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    if (typeof window === 'undefined') {
      return null; // Not in browser environment
    }
    
    try {
      const dataKey = `data:${key}`;
      const metaKey = `meta:${key}`;
      
      const dataStr = localStorage.getItem(dataKey);
      const metaStr = localStorage.getItem(metaKey);
      
      if (!dataStr) return null;
      
      // If we have metadata, check expiration
      if (metaStr) {
        const meta = JSON.parse(metaStr) as CacheMetadata;
        const now = Date.now();
        
        // Check if data is stale
        if (meta.expiresAt < now) {
          // For realtime data, return null if stale unless allowStale is true
          if (options.category === 'realtime' && options.allowStale !== true) {
            return null;
          }
          
          // For other categories, return stale data unless explicitly disallowed
          if ((options.category === 'static' || options.category === 'daily') && 
              options.allowStale === false) {
            return null;
          }
          
          // Log that we're using stale data
          console.log(`Client cache: Using stale data for ${key}`);
        }
      }
      
      return JSON.parse(dataStr) as T;
    } catch (error) {
      console.error(`Client cache: Error getting data for ${key}:`, error);
      return null;
    }
  },

  /**
   * Set cached data in localStorage
   */
  async setCachedData<T>(
    key: string,
    data: T,
    options: CacheOptions = {}
  ): Promise<void> {
    if (typeof window === 'undefined') {
      return; // Not in browser environment
    }
    
    try {
      const dataKey = `data:${key}`;
      const metaKey = `meta:${key}`;
      
      // Determine TTL based on category
      let ttl = 900; // 15 minutes default
      
      if (options.ttl) {
        ttl = options.ttl;
      } else if (options.category === 'static') {
        ttl = 86400; // 24 hours
      } else if (options.category === 'daily') {
        ttl = 43200; // 12 hours
      } else if (options.category === 'realtime') {
        ttl = 900; // 15 minutes
      }
      
      const now = Date.now();
      const meta: CacheMetadata = {
        expiresAt: now + (ttl * 1000),
        ttl,
        category: options.category
      };
      
      localStorage.setItem(dataKey, JSON.stringify(data));
      localStorage.setItem(metaKey, JSON.stringify(meta));
    } catch (error) {
      console.error(`Client cache: Error setting data for ${key}:`, error);
    }
  },

  /**
   * Delete cached data from localStorage
   */
  async deleteCachedData(key: string): Promise<void> {
    if (typeof window === 'undefined') {
      return; // Not in browser environment
    }
    
    try {
      const dataKey = `data:${key}`;
      const metaKey = `meta:${key}`;
      
      localStorage.removeItem(dataKey);
      localStorage.removeItem(metaKey);
    } catch (error) {
      console.error(`Client cache: Error deleting data for ${key}:`, error);
    }
  },

  /**
   * Clear cache items by prefix
   */
  async clearCacheByPrefix(prefix: string): Promise<void> {
    if (typeof window === 'undefined') {
      return; // Not in browser environment
    }
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(`data:${prefix}`) || key.startsWith(`meta:${prefix}`))) {
          localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.error(`Client cache: Error clearing cache with prefix ${prefix}:`, error);
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
    // Add category prefix if provided
    const prefix = category ? `${category}:` : '';
    
    // Convert params to a sorted key=value string
    const paramsStr = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    
    // Create a key based on endpoint and params
    const key = paramsStr ? `${endpoint}?${paramsStr}` : endpoint;
    
    // Return with prefix
    return `${prefix}yahoo:${key}`;
  }
};

// Export functions directly for convenience
export const { 
  getCachedData, 
  setCachedData, 
  deleteCachedData, 
  clearCacheByPrefix,
  generateCacheKey
} = clientCache; 