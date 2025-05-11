import { cookies } from 'next/headers';

// Clear all Yahoo-related cookies
export function clearYahooCookies() {
  const cookieStore = cookies();
  cookieStore.delete('yahoo_access_token');
  cookieStore.delete('yahoo_refresh_token');
  cookieStore.delete('yahoo_state');
}

// Get the current access token from cookies
export function getAccessToken(): string | undefined {
  const cookieStore = cookies();
  const value = cookieStore.get('yahoo_access_token')?.value;
  return value ? String(value) : undefined;
}

// Get the current refresh token from cookies
export function getRefreshToken(): string | undefined {
  const cookieStore = cookies();
  const token = cookieStore.get('yahoo_refresh_token')?.value;
  console.log('Auth Server: Refresh token present:', !!token);
  return token ? String(token) : undefined;
}

// Get the stored state parameter from cookies
export function getStoredState(): string | undefined {
  const cookieStore = cookies();
  const state = cookieStore.get('yahoo_state')?.value;
  return state ? String(state) : undefined;
} 