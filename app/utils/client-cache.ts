'use client';

import { CacheOptions, CacheMetadata, CACHE_CATEGORIES } from '../lib/shared/types';
import { generateDataKey, generateMetaKey } from '../lib/shared/cache-keys';

/**
 * Simple client-side cache implementation using localStorage
 * This provides a localStorage-based alternative for client components
 */

/**
 * Get cached data from localStorage
 */
export async function getCachedData<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
  if (typeof window === 'undefined') {
    return null; // Not in browser environment
  }
  
  try {
    const dataKey = generateDataKey(key);
    const metaKey = generateMetaKey(key);
    
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
        if (meta.category === 'realtime' && options.allowStale !== true) {
          return null;
        }
        
        // For other categories, return stale data unless explicitly disallowed
        if ((meta.category === 'static' || meta.category === 'daily') && 
            options.allowStale === false) {
          return null;
        }
        
        console.log(`Client cache: Using stale data for ${key}`);
      }
    }
    
    return JSON.parse(dataStr) as T;
  } catch (error) {
    console.error(`Client cache: Error getting data for ${key}:`, error);
    return null;
  }
}

/**
 * Set cached data in localStorage
 */
export async function setCachedData<T>(
  key: string,
  data: T,
  options: CacheOptions = {}
): Promise<void> {
  if (typeof window === 'undefined') {
    return; // Not in browser environment
  }
  
  try {
    const dataKey = generateDataKey(key);
    const metaKey = generateMetaKey(key);
    
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
}

/**
 * Delete cached data from localStorage
 */
export async function deleteCachedData(key: string): Promise<void> {
  if (typeof window === 'undefined') {
    return; // Not in browser environment
  }
  
  try {
    const dataKey = generateDataKey(key);
    const metaKey = generateMetaKey(key);
    
    localStorage.removeItem(dataKey);
    localStorage.removeItem(metaKey);
  } catch (error) {
    console.error(`Client cache: Error deleting data for ${key}:`, error);
  }
}

/**
 * Clear cache items by prefix
 */
export async function clearCacheByPrefix(prefix: string): Promise<void> {
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
}

/**
 * Generate a cache key for Yahoo API requests
 */
export function generateYahooCacheKey(
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