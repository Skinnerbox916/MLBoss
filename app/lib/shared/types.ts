// Shared type definitions for cache and auth interfaces

/**
 * Cache options for both client and server implementations
 */
export interface CacheOptions {
  ttl?: number;
  allowStale?: boolean;
  category?: 'static' | 'daily' | 'realtime';
  skipCache?: boolean;
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

/**
 * Interface for cache implementations
 * Should be implemented by both client and server cache modules
 */
export interface CacheInterface {
  getCachedData<T>(key: string, options?: CacheOptions): Promise<T | null>;
  setCachedData<T>(key: string, data: T, options?: CacheOptions): Promise<void>;
  deleteCachedData(key: string): Promise<void>;
  clearCacheByPrefix(prefix: string): Promise<void>;
  generateCacheKey(endpoint: string, params?: Record<string, string>, category?: 'static' | 'daily' | 'realtime'): string;
}

/**
 * Interface for auth implementations
 * Should be implemented by both client and server auth modules
 */
export interface AuthInterface {
  getAccessToken(): string | undefined;
  getRefreshToken(): string | undefined;
  getStoredState(): string | undefined;
  clearCookies(): void;
}

/**
 * Yahoo API options interface
 * Shared between client and server
 */
export interface YahooApiOptions {
  ttl?: number;
  skipCache?: boolean;
  timeout?: number;
  category?: 'static' | 'daily' | 'realtime';
} 