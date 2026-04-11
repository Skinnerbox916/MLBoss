// Authentication handled by middleware
import { redisUtils } from '@/lib/redis';
import AppLayout from '@/components/layout/AppLayout';

// Server actions for cache operations

// Clear all fantasy data cache without touching auth (user:* / token:* keys).
async function clearAllCache() {
  'use server';
  try {
    const keys = await redisUtils.keys('cache:*');
    if (keys.length > 0) {
      await Promise.all(keys.map(key => redisUtils.del(key)));
    }
    console.log(`✅ Cleared ${keys.length} cache keys (auth preserved)`);
  } catch (error) {
    console.error('❌ Failed to clear cache:', error);
    throw error;
  }
}

async function clearStaticCache() {
  'use server';
  try {
    const keys = await redisUtils.keys('cache:static:*');
    if (keys.length > 0) {
      await Promise.all(keys.map(key => redisUtils.del(key)));
      console.log(`✅ Cleared ${keys.length} static cache keys`);
    }
  } catch (error) {
    console.error('❌ Failed to clear static cache:', error);
    throw error;
  }
}

async function clearSemiDynamicCache() {
  'use server';
  try {
    const keys = await redisUtils.keys('cache:semi-dynamic:*');
    if (keys.length > 0) {
      await Promise.all(keys.map(key => redisUtils.del(key)));
      console.log(`✅ Cleared ${keys.length} semi-dynamic cache keys`);
    }
  } catch (error) {
    console.error('❌ Failed to clear semi-dynamic cache:', error);
    throw error;
  }
}

async function clearDynamicCache() {
  'use server';
  try {
    const keys = await redisUtils.keys('cache:dynamic:*');
    if (keys.length > 0) {
      await Promise.all(keys.map(key => redisUtils.del(key)));
      console.log(`✅ Cleared ${keys.length} dynamic cache keys`);
    }
  } catch (error) {
    console.error('❌ Failed to clear dynamic cache:', error);
    throw error;
  }
}

async function clearUserCache() {
  'use server';
  try {
    const keys = await redisUtils.keys('user:*');
    if (keys.length > 0) {
      await Promise.all(keys.map(key => redisUtils.del(key)));
      console.log(`✅ Cleared ${keys.length} user cache keys`);
    }
  } catch (error) {
    console.error('❌ Failed to clear user cache:', error);
    throw error;
  }
}

async function clearAgentCache() {
  'use server';
  try {
    const keys = await redisUtils.keys('cache:*');
    if (keys.length > 0) {
      await Promise.all(keys.map(key => redisUtils.del(key)));
      console.log(`✅ Cleared ${keys.length} agent cache keys`);
    }
  } catch (error) {
    console.error('❌ Failed to clear agent cache:', error);
    throw error;
  }
}

export default async function CachePage() {
  // Authentication handled by middleware

  // Get basic cache stats
  let cacheStats = {
    totalKeys: 0,
    staticKeys: 0,
    semiDynamicKeys: 0,
    dynamicKeys: 0,
    userKeys: 0,
    memoryInfo: 'Not available'
  };

  try {
    const [totalKeys, staticKeys, semiDynamicKeys, dynamicKeys, userKeys, memoryInfo] = await Promise.all([
      redisUtils.dbsize(),
      redisUtils.keys('cache:static:*').then(keys => keys.length),
      redisUtils.keys('cache:semi-dynamic:*').then(keys => keys.length),
      redisUtils.keys('cache:dynamic:*').then(keys => keys.length),
      redisUtils.keys('user:*').then(keys => keys.length),
      redisUtils.memoryInfo().catch(() => 'Not available')
    ]);

    cacheStats = {
      totalKeys,
      staticKeys,
      semiDynamicKeys,
      dynamicKeys,
      userKeys,
      memoryInfo
    };
  } catch (error) {
    console.error('Failed to get cache stats:', error);
  }

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-foreground">
              Redis Cache Management
            </h2>
            <p className="text-sm text-muted-foreground">
              View cache statistics and clear cached data
            </p>
          </div>

          {/* Cache Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-surface rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-foreground">
                {cacheStats.totalKeys}
              </div>
              <div className="text-sm text-muted-foreground">
                Total Keys
              </div>
            </div>

            <div className="bg-surface rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {cacheStats.staticKeys}
              </div>
              <div className="text-sm text-muted-foreground">
                Static Cache
              </div>
            </div>

            <div className="bg-surface rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                {cacheStats.semiDynamicKeys}
              </div>
              <div className="text-sm text-muted-foreground">
                Semi-Dynamic Cache
              </div>
            </div>

            <div className="bg-surface rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {cacheStats.dynamicKeys}
              </div>
              <div className="text-sm text-muted-foreground">
                Dynamic Cache
              </div>
            </div>
          </div>

          {/* Cache Operations */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-foreground mb-4">
              Cache Operations
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Clear All Cache */}
              <form action={clearAllCache}>
                <button
                  type="submit"
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Clear All Cache
                </button>
              </form>

              {/* Clear Static Cache */}
              <form action={clearStaticCache}>
                <button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Clear Static Cache
                </button>
              </form>

              {/* Clear Semi-Dynamic Cache */}
              <form action={clearSemiDynamicCache}>
                <button
                  type="submit"
                  className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Clear Semi-Dynamic Cache
                </button>
              </form>

              {/* Clear Dynamic Cache */}
              <form action={clearDynamicCache}>
                <button
                  type="submit"
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Clear Dynamic Cache
                </button>
              </form>

              {/* Clear User Cache */}
              <form action={clearUserCache}>
                <button
                  type="submit"
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Clear User Cache
                </button>
              </form>

              {/* Clear Agent Cache */}
              <form action={clearAgentCache}>
                <button
                  type="submit"
                  className="w-full bg-muted-foreground hover:bg-muted-foreground/80 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Clear Agent Cache
                </button>
              </form>
            </div>
          </div>

          {/* Additional Stats */}
          <div className="mt-6 bg-surface rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-foreground mb-4">
              Additional Information
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  User Keys: {cacheStats.userKeys}
                </div>
                <div className="text-xs text-muted-foreground">
                  Session and authentication data
                </div>
              </div>
              
              <div>
                <div className="text-sm font-medium text-foreground">
                  Memory Info: {typeof cacheStats.memoryInfo === 'string' ? 'Available' : 'Not available'}
                </div>
                <div className="text-xs text-muted-foreground">
                  Redis memory usage statistics
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
} 