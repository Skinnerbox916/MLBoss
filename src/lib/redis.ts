import Redis, { type RedisOptions } from 'ioredis';

// Build the ioredis client. Prefer REDIS_URL (the documented env var); fall
// back to discrete REDIS_HOST/REDIS_PORT/REDIS_PASSWORD/REDIS_DB so existing
// .env.local files keep working. We let ioredis defaults stand for retry,
// ready-check, and lazy-connect — the previous explicit overrides were
// copy-pasted from a BullMQ snippet and made the cache less reliable
// (notably maxRetriesPerRequest: null causes commands to hang forever
// during a Redis outage instead of failing fast).

function buildRedisClient(): Redis {
  const url = process.env.REDIS_URL;
  if (url) {
    return new Redis(url);
  }

  const options: RedisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
  };
  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }
  return new Redis(options);
}

// Singleton Redis client
class RedisClient {
  private static instance: Redis | null = null;

  public static getInstance(): Redis {
    if (!RedisClient.instance) {
      RedisClient.instance = buildRedisClient();

      RedisClient.instance.on('connect', () => {
        console.log('✅ Redis connected');
      });

      RedisClient.instance.on('end', () => {
        console.log('🔴 Redis connection closed');
      });

      RedisClient.instance.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting');
      });

      RedisClient.instance.on('error', (err) => {
        console.error('❌ Redis error:', err);
      });

      RedisClient.instance.on('close', () => {
        console.log('🔌 Redis client disconnected');
      });
    }

    return RedisClient.instance;
  }

  public static async disconnect(): Promise<void> {
    if (RedisClient.instance) {
      await RedisClient.instance.quit();
      RedisClient.instance = null;
      console.log('🔌 Redis client disconnected');
    }
  }
}

// Export the singleton instance
export const redis = RedisClient.getInstance();

// Export the class for advanced usage
export { RedisClient };

// Export common Redis operations as utility functions
export const redisUtils = {
  async ping(): Promise<string> {
    return await redis.ping();
  },

  async set(key: string, value: string, ttl?: number): Promise<'OK'> {
    if (ttl) {
      return await redis.setex(key, ttl, value);
    }
    return await redis.set(key, value);
  },

  async get(key: string): Promise<string | null> {
    return await redis.get(key);
  },

  async del(key: string): Promise<number> {
    return await redis.del(key);
  },

  async exists(key: string): Promise<number> {
    return await redis.exists(key);
  },

  async expire(key: string, seconds: number): Promise<number> {
    return await redis.expire(key, seconds);
  },

  async hset(key: string, field: string, value: string): Promise<number> {
    return await redis.hset(key, field, value);
  },

  async hget(key: string, field: string): Promise<string | null> {
    return await redis.hget(key, field);
  },

  async hgetall(key: string): Promise<Record<string, string>> {
    return await redis.hgetall(key);
  },

  async lpush(key: string, ...values: string[]): Promise<number> {
    return await redis.lpush(key, ...values);
  },

  async rpop(key: string): Promise<string | null> {
    return await redis.rpop(key);
  },

  /**
   * Match keys by pattern. DEV-ONLY — backs ad-hoc debugging from the
   * admin shell. Production cache invalidation goes through
   * `invalidateCachePattern` in `src/lib/fantasy/cache.ts`, which uses
   * SCAN. KEYS is O(N) over the full keyspace and blocks the server.
   */
  async keys(pattern: string = '*'): Promise<string[]> {
    return await redis.keys(pattern);
  },

  async dbsize(): Promise<number> {
    return await redis.dbsize();
  },

  async memoryInfo(): Promise<string> {
    return await redis.info('memory');
  },
};
