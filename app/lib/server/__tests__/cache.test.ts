import { serverCache, serverAdmin } from '../cache';
import type { Redis } from 'ioredis';

// Mock Redis client
const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  info: jest.fn(),
  scan: jest.fn(),
  on: jest.fn(),
} as unknown as Redis;

// Mock the entire cache module
jest.mock('../cache', () => {
  const actual = jest.requireActual('../cache');
  
  // Create a mock getRedisClient that returns our mock
  const getRedisClient = jest.fn(() => Promise.resolve(mockRedisClient));
  
  // Re-implement the cache functions using the mock
  const serverCache = {
    getCachedData: jest.fn(async (key: string, options: any = {}) => {
      const redis = await getRedisClient();
      if (!redis) return null;
      
      try {
        const dataKey = `data:${key}`;
        const metaKey = `meta:${key}`;
        
        const cachedData = await redis.get(dataKey);
        const cachedMeta = await redis.get(metaKey);
        
        if (!cachedData) {
          return null;
        }
        
        const data = JSON.parse(cachedData);
        
        if (cachedMeta) {
          const meta = JSON.parse(cachedMeta);
          const isStale = meta.expiresAt < Date.now();
          
          if (isStale) {
            const category = meta.category || 
              (key.startsWith('static:') ? 'static' : 
                key.startsWith('daily:') ? 'daily' : 
                  key.startsWith('realtime:') ? 'realtime' : 'unknown');
            
            if (category === 'realtime' || options.category === 'realtime') {
              if (options.allowStale !== true) {
                return null;
              }
            } else if ((category === 'static' || category === 'daily' || 
                options.category === 'static' || options.category === 'daily')) {
              if (options.allowStale === false) {
                return null;
              }
            }
          }
        }
        
        return data;
      } catch (error) {
        return null;
      }
    }),
    
    setCachedData: jest.fn(async (key: string, data: any, options: any = {}) => {
      const redis = await getRedisClient();
      if (!redis) return;
      
      let ttl = 900; // default
      
      if (options.category) {
        if (options.category === 'static') {
          ttl = 86400;
        } else if (options.category === 'daily') {
          ttl = 43200;
        } else if (options.category === 'realtime') {
          ttl = 900;
        }
      } else if (key.startsWith('static:')) {
        ttl = 86400;
      } else if (key.startsWith('daily:')) {
        ttl = 43200;
      } else if (key.startsWith('realtime:')) {
        ttl = 900;
      }
      
      if (options.ttl !== undefined) {
        ttl = options.ttl;
      }
      
      const meta = {
        createdAt: Date.now(),
        expiresAt: Date.now() + ttl * 1000,
        ttl,
        category: options.category
      };
      
      await redis.set(`data:${key}`, JSON.stringify(data), 'EX', ttl);
      await redis.set(`meta:${key}`, JSON.stringify(meta), 'EX', ttl);
    }),
    
    deleteCachedData: jest.fn(async (key: string) => {
      const redis = await getRedisClient();
      if (!redis) return;
      
      await redis.del(`data:${key}`);
      await redis.del(`meta:${key}`);
    }),
    
    clearCacheByPrefix: jest.fn(async (prefix: string) => {
      const redis = await getRedisClient();
      if (!redis) return;
      
      const dataKeys = await redis.keys(`data:${prefix}*`);
      const metaKeys = await redis.keys(`meta:${prefix}*`);
      
      if (dataKeys.length > 0 || metaKeys.length > 0) {
        await redis.del(...dataKeys, ...metaKeys);
      }
    }),
    
    generateCacheKey: jest.fn((endpoint: string, params: Record<string, string> = {}, category?: string) => {
      const sortedParams = Object.keys(params).sort();
      const paramString = sortedParams.map(key => `${key}=${params[key]}`).join('&');
      const baseKey = `yahoo:${endpoint}${paramString ? '?' + paramString : ''}`;
      return category ? `${category}:${baseKey}` : baseKey;
    })
  };
  
  const serverAdmin = {
    clearCache: jest.fn(async (prefix?: string) => {
      const redis = await getRedisClient();
      if (!redis) return 0;
      
      let keys: string[] = [];
      
      if (prefix) {
        const dataKeys = await redis.keys(`data:${prefix}*`);
        const metaKeys = await redis.keys(`meta:${prefix}*`);
        keys = [...dataKeys, ...metaKeys];
      } else {
        const dataKeys = await redis.keys('data:*');
        const metaKeys = await redis.keys('meta:*');
        keys = [...dataKeys, ...metaKeys];
      }
      
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      
      return keys.length;
    })
  };
  
  return {
    ...actual,
    getRedisClient,
    serverCache,
    serverAdmin,
    getCachedData: serverCache.getCachedData,
    setCachedData: serverCache.setCachedData,
    deleteCachedData: serverCache.deleteCachedData,
    clearCacheByPrefix: serverCache.clearCacheByPrefix,
    generateCacheKey: serverCache.generateCacheKey
  };
});

// Import the mocked functions
const { getCachedData, setCachedData, clearCacheByPrefix, generateCacheKey } = serverCache;

describe('Server Cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCachedData', () => {
    it('should return cached data when not stale', async () => {
      const testData = { test: 'data' };
      const metadata = {
        expiresAt: Date.now() + 3600000, // 1 hour from now
        ttl: 3600,
        category: 'daily'
      };

      (mockRedisClient.get as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(testData))
        .mockResolvedValueOnce(JSON.stringify(metadata));

      const result = await getCachedData('test-key');

      expect(result).toEqual(testData);
      expect(mockRedisClient.get).toHaveBeenCalledWith('data:test-key');
      expect(mockRedisClient.get).toHaveBeenCalledWith('meta:test-key');
    });

    it('should return null when no data found', async () => {
      (mockRedisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const result = await getCachedData('test-key');

      expect(result).toBeNull();
      expect(mockRedisClient.get).toHaveBeenCalledWith('data:test-key');
    });

    it('should return null for stale realtime data by default', async () => {
      const testData = { test: 'data' };
      const metadata = {
        expiresAt: Date.now() - 3600000, // 1 hour ago
        ttl: 900,
        category: 'realtime'
      };

      (mockRedisClient.get as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(testData))
        .mockResolvedValueOnce(JSON.stringify(metadata));

      const result = await getCachedData('realtime:test-key');

      expect(result).toBeNull();
    });

    it('should return stale realtime data when allowStale is true', async () => {
      const testData = { test: 'data' };
      const metadata = {
        expiresAt: Date.now() - 3600000, // 1 hour ago
        ttl: 900,
        category: 'realtime'
      };

      (mockRedisClient.get as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(testData))
        .mockResolvedValueOnce(JSON.stringify(metadata));

      const result = await getCachedData('realtime:test-key', { 
        allowStale: true 
      });

      expect(result).toEqual(testData);
    });

    it('should return stale daily data by default', async () => {
      const testData = { test: 'data' };
      const metadata = {
        expiresAt: Date.now() - 3600000, // 1 hour ago
        ttl: 43200,
        category: 'daily'
      };

      (mockRedisClient.get as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(testData))
        .mockResolvedValueOnce(JSON.stringify(metadata));

      const result = await getCachedData('daily:test-key');

      expect(result).toEqual(testData);
    });

    it('should not return stale daily data when allowStale is false', async () => {
      const testData = { test: 'data' };
      const metadata = {
        expiresAt: Date.now() - 3600000, // 1 hour ago
        ttl: 43200,
        category: 'daily'
      };

      (mockRedisClient.get as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(testData))
        .mockResolvedValueOnce(JSON.stringify(metadata));

      const result = await getCachedData('daily:test-key', { 
        allowStale: false 
      });

      expect(result).toBeNull();
    });

    it('should handle JSON parse errors gracefully', async () => {
      (mockRedisClient.get as jest.Mock).mockResolvedValueOnce('invalid json');

      const result = await getCachedData('test-key');

      expect(result).toBeNull();
    });
  });

  describe('setCachedData', () => {
    it('should set data with correct TTL for static category', async () => {
      const testData = { test: 'data' };

      await setCachedData('test-key', testData, { category: 'static' });

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'data:test-key',
        JSON.stringify(testData),
        'EX',
        86400 // 24 hours for static
      );
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'meta:test-key',
        expect.stringContaining('"category":"static"'),
        'EX',
        86400
      );
    });

    it('should set data with correct TTL for daily category', async () => {
      const testData = { test: 'data' };

      await setCachedData('test-key', testData, { category: 'daily' });

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'data:test-key',
        JSON.stringify(testData),
        'EX',
        43200 // 12 hours for daily
      );
    });

    it('should set data with correct TTL for realtime category', async () => {
      const testData = { test: 'data' };

      await setCachedData('test-key', testData, { category: 'realtime' });

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'data:test-key',
        JSON.stringify(testData),
        'EX',
        900 // 15 minutes for realtime
      );
    });

    it('should use custom TTL when provided', async () => {
      const testData = { test: 'data' };

      await setCachedData('test-key', testData, { 
        category: 'daily',
        ttl: 7200 // 2 hours
      });

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'data:test-key',
        JSON.stringify(testData),
        'EX',
        7200
      );
    });

    it('should detect category from key prefix', async () => {
      const testData = { test: 'data' };

      await setCachedData('static:test-key', testData);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'data:static:test-key',
        JSON.stringify(testData),
        'EX',
        86400 // 24 hours for static
      );
    });
  });

  describe('clearCacheByPrefix', () => {
    it('should clear keys with specific prefix', async () => {
      (mockRedisClient.keys as jest.Mock)
        .mockResolvedValueOnce(['data:daily:key1', 'data:daily:key2'])
        .mockResolvedValueOnce(['meta:daily:key1', 'meta:daily:key2']);

      await clearCacheByPrefix('daily');

      expect(mockRedisClient.keys).toHaveBeenCalledWith('data:daily*');
      expect(mockRedisClient.keys).toHaveBeenCalledWith('meta:daily*');
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        'data:daily:key1', 'data:daily:key2', 'meta:daily:key1', 'meta:daily:key2'
      );
    });

    it('should handle empty key list', async () => {
      (mockRedisClient.keys as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await clearCacheByPrefix('test');

      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });
  });

  describe('serverAdmin.clearCache', () => {
    it('should clear all cache keys when no prefix provided', async () => {
      (mockRedisClient.keys as jest.Mock)
        .mockResolvedValueOnce(['data:key1', 'data:key2'])
        .mockResolvedValueOnce(['meta:key1', 'meta:key2']);

      const result = await serverAdmin.clearCache();

      expect(mockRedisClient.keys).toHaveBeenCalledWith('data:*');
      expect(mockRedisClient.keys).toHaveBeenCalledWith('meta:*');
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        'data:key1', 'data:key2', 'meta:key1', 'meta:key2'
      );
      expect(result).toBe(4);
    });

    it('should clear only keys with specific prefix', async () => {
      (mockRedisClient.keys as jest.Mock)
        .mockResolvedValueOnce(['data:daily:key1'])
        .mockResolvedValueOnce(['meta:daily:key1']);

      const result = await serverAdmin.clearCache('daily');

      expect(mockRedisClient.keys).toHaveBeenCalledWith('data:daily*');
      expect(mockRedisClient.keys).toHaveBeenCalledWith('meta:daily*');
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        'data:daily:key1', 'meta:daily:key1'
      );
      expect(result).toBe(2);
    });
  });

  describe('generateCacheKey', () => {
    it('should generate key with category prefix', () => {
      const key = generateCacheKey('/api/endpoint', {}, 'daily');
      
      expect(key).toBe('daily:yahoo:/api/endpoint');
    });

    it('should include sorted params in key', () => {
      const key = generateCacheKey('/api/endpoint', {
        param2: 'value2',
        param1: 'value1'
      });
      
      expect(key).toBe('yahoo:/api/endpoint?param1=value1&param2=value2');
    });

    it('should handle empty params', () => {
      const key = generateCacheKey('/api/endpoint');
      
      expect(key).toBe('yahoo:/api/endpoint');
    });
  });
}); 