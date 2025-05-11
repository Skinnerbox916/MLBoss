/**
 * Shared types for cache implementations
 */

/**
 * Cache options for both client and server implementations
 */
export interface CacheOptions {
  ttl?: number;
  allowStale?: boolean;
  category?: 'static' | 'daily' | 'realtime';
}

/**
 * Cache metadata stored alongside cached data
 */
export interface CacheMetadata {
  expiresAt: number;
  ttl: number;
  category?: string;
  createdAt?: number;
}

/**
 * Cache statistics returned by admin functions
 */
export interface CacheStats {
  totalKeys: number;
  totalSize: number;
  largestKeys: {key: string; size: number}[];
  keysPerCategory: {[category: string]: number};
}

/**
 * Cache category configuration
 */
export interface CacheCategoryConfig {
  ttl: number;
  description: string;
}

/**
 * Cache categories and their default TTLs
 */
export const CACHE_CATEGORIES: Record<'static' | 'daily' | 'realtime', CacheCategoryConfig> = {
  static: {
    ttl: 86400, // 24 hours
    description: 'Static data that rarely changes (player teams, positions, etc.)'
  },
  daily: {
    ttl: 43200, // 12 hours
    description: 'Data that updates daily (probable pitchers, matchups, etc.)'
  },
  realtime: {
    ttl: 900, // 15 minutes
    description: 'Frequently changing data (stats, scores, etc.)'
  }
}; 