'use client';

import { getCookie, setCookie, deleteCookie } from 'cookies-next';
import { AuthInterface } from '../shared/types';

export const YAHOO_CLIENT_ID = 'dj0yJmk9dWZ4NW1yb1lsVXJ6JmQ9WVdrOU1ubGFaWGQzY1RBbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTRi';
export const YAHOO_CLIENT_SECRET = '3ec2cbb9c20965cdaf99f98c2d8cd9e558cd9d8c';
export const YAHOO_REDIRECT_URI = 'https://dev-tunnel.skibri.us/api/auth/callback';

/**
 * Client-side auth implementation
 */
export const clientAuth: AuthInterface = {
  /**
   * Get the access token from cookies (client-side)
   */
  getAccessToken(): string | undefined {
    return getCookie('yahoo_access_token')?.toString();
  },

  /**
   * Get the refresh token from cookies (client-side)
   */
  getRefreshToken(): string | undefined {
    return getCookie('yahoo_refresh_token')?.toString();
  },

  /**
   * Get the stored state parameter from cookies (client-side)
   */
  getStoredState(): string | undefined {
    return getCookie('yahoo_state')?.toString();
  },

  /**
   * Clear all Yahoo-related cookies (client-side)
   */
  clearCookies(): void {
    deleteCookie('yahoo_access_token');
    deleteCookie('yahoo_refresh_token');
    deleteCookie('yahoo_state');
  }
};

// Export functions directly for convenience
export const {
  getAccessToken,
  getRefreshToken,
  getStoredState,
  clearCookies
} = clientAuth;

// Additional client-side auth helpers

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Generate Yahoo Auth URL with state parameter
 */
export const generateYahooAuthUrl = (state: string, forceLogin: boolean = false): string =>
  `https://api.login.yahoo.com/oauth2/request_auth?client_id=${YAHOO_CLIENT_ID}&redirect_uri=${encodeURIComponent(YAHOO_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('fspt-w')}&state=${state}${forceLogin ? '&prompt=login' : ''}`;

/**
 * Set access token
 */
export function setAccessToken(token: string): void {
  setCookie('yahoo_access_token', token, {
    maxAge: 60 * 60, // 1 hour
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}

/**
 * Set refresh token
 */
export function setRefreshToken(token: string): void {
  setCookie('yahoo_refresh_token', token, {
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}

/**
 * Set state parameter
 */
export function setState(state: string): void {
  setCookie('yahoo_state', state, {
    maxAge: 60 * 10, // 10 minutes
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
} 