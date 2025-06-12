import { NextResponse } from 'next/server';
import { YahooOAuth } from '@/lib/yahoo-oauth';
import { redisUtils } from '@/lib/redis';
import { randomBytes } from 'crypto';

export async function GET() {
  try {
    const yahooOAuth = new YahooOAuth();
    
    // Generate state for CSRF protection
    const state = randomBytes(32).toString('hex');
    
    // Store state in Redis for later validation (expires in 10 minutes)
    const stateKey = `oauth_state:${state}`;
    await redisUtils.set(stateKey, 'valid', 600);
    
    // Generate authorization URL
    const authorizationUrl = yahooOAuth.getAuthorizationUrl(state);
    
    // Redirect to Yahoo OAuth
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    const baseUrl = process.env.APP_URL || 'https://dev-tunnel.skibri.us';
    console.error('OAuth login error:', error);
    return NextResponse.redirect(new URL('/auth/error?error=login_failed', baseUrl));
  }
} 