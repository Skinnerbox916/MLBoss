// Server-side auth implementation
import { cookies } from 'next/headers';
import { AuthInterface } from '../shared/types';

/**
 * Server-side auth implementation using Next.js cookies API
 */
export const serverAuth: AuthInterface = {
  /**
   * Get the access token from cookies (server-side)
   */
  getAccessToken(): string | undefined {
    const cookieStore = cookies();
    const value = cookieStore.get('yahoo_access_token')?.value;
    return value ? String(value) : undefined;
  },

  /**
   * Get the refresh token from cookies (server-side)
   */
  getRefreshToken(): string | undefined {
    const cookieStore = cookies();
    const token = cookieStore.get('yahoo_refresh_token')?.value;
    console.log('Auth Server: Refresh token present:', !!token);
    return token ? String(token) : undefined;
  },

  /**
   * Get the stored state parameter from cookies (server-side)
   */
  getStoredState(): string | undefined {
    const cookieStore = cookies();
    const state = cookieStore.get('yahoo_state')?.value;
    return state ? String(state) : undefined;
  },

  /**
   * Clear all Yahoo-related cookies (server-side)
   */
  clearCookies(): void {
    const cookieStore = cookies();
    cookieStore.delete('yahoo_access_token');
    cookieStore.delete('yahoo_refresh_token');
    cookieStore.delete('yahoo_state');
  }
};

// Export functions directly for convenience
export const {
  getAccessToken,
  getRefreshToken,
  getStoredState,
  clearCookies
} = serverAuth; 