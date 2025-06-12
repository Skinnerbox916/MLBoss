import Redis from 'ioredis';

// Configuration for local Redis server
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0'),
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
  lazyConnect: true,
};

// Singleton Redis client
class RedisClient {
  private static instance: Redis | null = null;

  public static getInstance(): Redis {
    if (!RedisClient.instance) {
      RedisClient.instance = new Redis(redisConfig);
      
      // Add connection event listeners
      RedisClient.instance.on('connect', () => {
        console.log('✅ Redis connected');
      });
      
      RedisClient.instance.on('ready', () => {
        // Redis is ready to receive commands
      });
      
      RedisClient.instance.on('end', () => {
        console.log('🔴 Redis connection closed');
      });
      
      RedisClient.instance.on('reconnecting', () => {
        console.log('�� Redis reconnecting');
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

  // Cache management utilities
  async keys(pattern: string = '*'): Promise<string[]> {
    return await redis.keys(pattern);
  },

  async flushdb(): Promise<'OK'> {
    return await redis.flushdb();
  },

  async dbsize(): Promise<number> {
    return await redis.dbsize();
  },

  async memoryInfo(): Promise<string> {
    return await redis.info('memory');
  },
}; 