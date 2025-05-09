// Authentication types

/**
 * Authentication provider types
 */
export type AuthProvider = 'yahoo' | 'espn';

/**
 * Authentication token interface
 */
export interface AuthToken {
  token: string;
  refreshToken?: string;
  expiresAt: number;
  provider: AuthProvider;
}

/**
 * Authentication options for cookies
 */
export interface AuthCookieOptions {
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
}

/**
 * Authentication state interface
 */
export interface AuthState {
  isAuthenticated: boolean;
  user?: {
    id: string;
    name: string;
    email?: string;
    provider: AuthProvider;
  };
  error?: string;
}

/**
 * Yahoo OAuth token response
 */
export interface YahooOAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  xoauth_yahoo_guid: string;
} 