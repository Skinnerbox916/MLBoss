/**
 * Shared utilities for cache key generation
 */

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

/**
 * Generate a data key for storing cache data
 */
export function generateDataKey(key: string): string {
  return `data:${key}`;
}

/**
 * Generate a metadata key for storing cache metadata
 */
export function generateMetaKey(key: string): string {
  return `meta:${key}`;
}

/**
 * Extract the original key from a data or metadata key
 */
export function extractOriginalKey(key: string): string {
  return key.replace(/^(data|meta):/, '');
}

/**
 * Check if a key is a data key
 */
export function isDataKey(key: string): boolean {
  return key.startsWith('data:');
}

/**
 * Check if a key is a metadata key
 */
export function isMetaKey(key: string): boolean {
  return key.startsWith('meta:');
} 