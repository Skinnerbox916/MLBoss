import { redisUtils } from '@/lib/redis';
import { YahooOAuth } from '@/lib/yahoo-oauth';

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
 * Refresh user tokens if needed
 */
export async function refreshUserTokens(userId: string): Promise<boolean> {
  try {
    const user = await getUserFromRedis(userId);
    if (!user || !user.refreshToken) return false;

    const yahooOAuth = new YahooOAuth();
    const newTokens = await yahooOAuth.refreshAccessToken(user.refreshToken);

    // Update tokens in Redis
    const userKey = `user:${userId}`;
    const expiresAt = Date.now() + (newTokens.expires_in * 1000);

    await redisUtils.hset(userKey, 'accessToken', newTokens.access_token);
    await redisUtils.hset(userKey, 'refreshToken', newTokens.refresh_token);
    await redisUtils.hset(userKey, 'expiresAt', expiresAt.toString());

    // Update token lookup
    const oldTokenKey = `token:${user.accessToken}`;
    const newTokenKey = `token:${newTokens.access_token}`;

    await redisUtils.del(oldTokenKey);
    await redisUtils.set(newTokenKey, userId, newTokens.expires_in);

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
