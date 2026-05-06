import { NextResponse, NextRequest } from 'next/server';
import { YahooOAuth, YahooUserInfo, getSession } from '@/lib/auth';
import { redis, redisUtils } from '@/lib/redis';

export async function GET(request: NextRequest) {
  try {
    const baseUrl = process.env.APP_URL || 'https://dev-tunnel.skibri.us';
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Handle OAuth errors from Yahoo
    if (error) {
      console.error('Yahoo OAuth error:', error, errorDescription);
      const errorParams = new URLSearchParams({
        error: 'oauth_error',
        yahoo_error: error,
        yahoo_description: errorDescription || 'No description provided'
      });
      return NextResponse.redirect(new URL(`/auth/error?${errorParams.toString()}`, baseUrl));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      return NextResponse.redirect(new URL('/auth/error?error=missing_parameters', baseUrl));
    }

    // Validate state parameter against Redis (CSRF protection)
    const stateKey = `oauth_state:${state}`;
    const storedState = await redisUtils.get(stateKey);
    
    if (!storedState) {
      console.error('Invalid or expired state parameter:', state);
      return NextResponse.redirect(new URL('/auth/error?error=invalid_state', baseUrl));
    }

    // Remove the used state from Redis
    await redisUtils.del(stateKey);

    // Initialize Yahoo OAuth client
    const yahooOAuth = new YahooOAuth();

    // Exchange authorization code for tokens
    const tokenResponse = await yahooOAuth.getAccessToken(code);
    
    // Try to fetch user information from Yahoo
    let userInfo: YahooUserInfo | null = null;
    let userId: string;
    let userName: string = 'Yahoo User';
    let userEmail: string = '';
    
    try {
      userInfo = await yahooOAuth.getUserInfo(tokenResponse.access_token);
      userId = userInfo.sub;
      userName = userInfo.name || userInfo.preferred_username || userInfo.nickname || 'Yahoo User';
      userEmail = userInfo.email || '';
    } catch {
      // UserInfo endpoint failed, falling back to ID token and GUID
      if (tokenResponse.id_token) {
        try {
          const idTokenData = yahooOAuth.decodeIdToken(tokenResponse.id_token);
          userId = (idTokenData.sub as string) || tokenResponse.xoauth_yahoo_guid || '';
          userName = (idTokenData.name as string) || (idTokenData.preferred_username as string) || 'Yahoo User';
          userEmail = (idTokenData.email as string) || '';
        } catch {
          userId = tokenResponse.xoauth_yahoo_guid || '';
        }
      } else {
        userId = tokenResponse.xoauth_yahoo_guid || '';
      }
    }
    
    if (!userId) {
      return NextResponse.redirect(new URL('/auth/error?error=no_user_id', baseUrl));
    }

    // Calculate token expiration timestamp
    const expiresAt = Date.now() + (tokenResponse.expires_in * 1000);

    // Prepare user data for session
    const userData = {
      id: userId,
      email: userEmail,
      name: userName,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: expiresAt
    };

    // Save user data to iron-session
    const session = await getSession();
    session.user = userData;
    await session.save();

    // Store tokens in Redis as a backup of the encrypted iron-session
    // cookie (the cookie is the source of truth for auth). Single MULTI
    // so the user hash, its 7-day TTL, and the token-to-userId lookup
    // all land atomically — concurrent reads can't see partial state.
    const userRedisKey = `user:${userId}`;
    const userRedisData = {
      id: userId,
      email: userEmail,
      name: userName,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: expiresAt.toString(),
      profile: userInfo ? JSON.stringify(userInfo) : '{}',
      lastLogin: Date.now().toString()
    };
    const tokenKey = `token:${tokenResponse.access_token}`;

    await redis.multi()
      .hset(userRedisKey, userRedisData)
      .expire(userRedisKey, 7 * 24 * 60 * 60)
      .set(tokenKey, userId, 'EX', tokenResponse.expires_in)
      .exec();

    // Success log
    console.log('OAuth callback successful for user:', userId);

    // Create redirect response with proper session handling
    const redirectUrl = new URL('/dashboard', baseUrl);
    const response = NextResponse.redirect(redirectUrl);
    
    // Ensure session cookies are properly set by calling save again
    await session.save();
    
    return response;

  } catch (error) {
    const baseUrl = process.env.APP_URL || 'https://dev-tunnel.skibri.us';
    console.error('OAuth callback error:', error);

    // Handle specific Yahoo OAuth errors
    if (error instanceof Error) {
      if (error.message.includes('Yahoo OAuth error')) {
        return NextResponse.redirect(new URL('/auth/error?error=yahoo_oauth_error', baseUrl));
      }
      if (error.message.includes('Access token expired')) {
        return NextResponse.redirect(new URL('/auth/error?error=token_expired', baseUrl));
      }
      if (error.message.includes('Rate limit exceeded')) {
        return NextResponse.redirect(new URL('/auth/error?error=rate_limit', baseUrl));
      }
      if (error.message.includes('Failed to exchange authorization code')) {
        return NextResponse.redirect(new URL('/auth/error?error=token_exchange_failed', baseUrl));
      }
      if (error.message.includes('Failed to get user info')) {
        return NextResponse.redirect(new URL('/auth/error?error=user_info_failed', baseUrl));
      }
    }

    // Generic error redirect
    return NextResponse.redirect(new URL('/auth/error?error=unknown_error', baseUrl));
  }
} 