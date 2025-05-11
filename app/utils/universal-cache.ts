'use client';

import * as clientCache from './client-cache';
import { CacheOptions } from './cache-types';
import { generateYahooCacheKey } from './cache-keys';

/**
 * Universal cache that works in both client and server environments
 * Automatically detects environment and uses the appropriate implementation
 */

/**
 * Get cached data using the appropriate implementation
 */
export async function getCachedData<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
  // In the browser, use the client-side implementation
  if (typeof window !== 'undefined') {
    return clientCache.getCachedData<T>(key, options);
  }
  
  // In Node.js, dynamically import the server-side implementation
  try {
    const serverCache = await import('./cache');
    return serverCache.getCachedData<T>(key, options);
  } catch (error) {
    console.error('Error importing server-side cache:', error);
    return null;
  }
}

/**
 * Set cached data using the appropriate implementation
 */
export async function setCachedData<T>(
  key: string,
  data: T,
  options: CacheOptions = {}
): Promise<void> {
  // In the browser, use the client-side implementation
  if (typeof window !== 'undefined') {
    return clientCache.setCachedData(key, data, options);
  }
  
  // In Node.js, dynamically import the server-side implementation
  try {
    const serverCache = await import('./cache');
    return serverCache.setCachedData(key, data, options);
  } catch (error) {
    console.error('Error importing server-side cache:', error);
  }
}

/**
 * Delete cached data using the appropriate implementation
 */
export async function deleteCachedData(key: string): Promise<void> {
  // In the browser, use the client-side implementation
  if (typeof window !== 'undefined') {
    return clientCache.deleteCachedData(key);
  }
  
  // In Node.js, dynamically import the server-side implementation
  try {
    const serverCache = await import('./cache');
    return serverCache.deleteCachedData(key);
  } catch (error) {
    console.error('Error importing server-side cache:', error);
  }
}

/**
 * Clear cache by prefix using the appropriate implementation
 */
export async function clearCacheByPrefix(prefix: string): Promise<void> {
  // In the browser, use the client-side implementation
  if (typeof window !== 'undefined') {
    return clientCache.clearCacheByPrefix(prefix);
  }
  
  // In Node.js, dynamically import the server-side implementation
  try {
    const serverCache = await import('./cache');
    return serverCache.clearCacheByPrefix(prefix);
  } catch (error) {
    console.error('Error importing server-side cache:', error);
  }
}

/**
 * Generate a Yahoo API cache key
 */
export { generateYahooCacheKey }; 