// Mock environment variables for tests
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CACHE_ENABLED = 'true';
process.env.DEFAULT_CACHE_TTL = '900';
process.env.STATIC_DATA_TTL = '86400';
process.env.DAILY_DATA_TTL = '43200';
process.env.REALTIME_DATA_TTL = '900';

// Increase test timeout for async operations
jest.setTimeout(10000); 