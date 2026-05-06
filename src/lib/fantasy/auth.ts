import { redis, redisUtils } from '@/lib/redis';
import { YahooOAuth } from '@/lib/auth';

/**
 * Get user information from Redis backup storage
 */
export async function getUserFromRedis(userId: string): Promise<any | null> {
  const userKey = `user:${userId}`;
  const userData = await redisUtils.hgetall(userKey);

  if (Object.keys(userData).length === 0) {
    return null;
  }

  return {
    id: userData.id,
    email: userData.email,
    name: userData.name,
    accessToken: userData.accessToken,
    refreshToken: userData.refreshToken,
    expiresAt: parseInt(userData.expiresAt),
    profile: userData.profile ? JSON.parse(userData.profile) : null,
    lastLogin: parseInt(userData.lastLogin)
  };
}

/**
 * Check if a user's token is still valid
 */
export async function isTokenValid(userId: string): Promise<boolean> {
  const user = await getUserFromRedis(userId);
  if (!user) return false;
  return Date.now() < user.expiresAt;
}

/**
 * Refresh user tokens if needed.
 *
 * Single MULTI so the user-hash field updates, the 7-day TTL refresh, the
 * old token-lookup deletion, and the new token-lookup write all land
 * atomically. Without this, a concurrent request can read the new
 * `accessToken` against an already-deleted `token:{old}` lookup. The
 * EXPIRE re-up keeps the user hash from silently expiring 7 days after
 * the original login even when the user is actively refreshing.
 */
export async function refreshUserTokens(userId: string): Promise<boolean> {
  try {
    const user = await getUserFromRedis(userId);
    if (!user || !user.refreshToken) return false;

    const yahooOAuth = new YahooOAuth();
    const newTokens = await yahooOAuth.refreshAccessToken(user.refreshToken);

    const userKey = `user:${userId}`;
    const expiresAt = Date.now() + (newTokens.expires_in * 1000);
    const oldTokenKey = `token:${user.accessToken}`;
    const newTokenKey = `token:${newTokens.access_token}`;

    await redis.multi()
      .hset(userKey, {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        expiresAt: expiresAt.toString(),
      })
      .expire(userKey, 7 * 24 * 60 * 60)
      .del(oldTokenKey)
      .set(newTokenKey, userId, 'EX', newTokens.expires_in)
      .exec();

    return true;
  } catch (error) {
    console.error('Failed to refresh tokens for user:', userId, error);
    return false;
  }
}

/**
 * Get user ID from access token
 */
export async function getUserIdFromToken(accessToken: string): Promise<string | null> {
  const tokenKey = `token:${accessToken}`;
  return await redisUtils.get(tokenKey);
}
