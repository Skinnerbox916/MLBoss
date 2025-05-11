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