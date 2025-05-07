import { cookies } from 'next/headers';

// Clear all Yahoo-related cookies
export function clearYahooCookies() {
  const cookieStore = cookies();
  cookieStore.delete('yahoo_access_token');
  cookieStore.delete('yahoo_refresh_token');
  cookieStore.delete('yahoo_state');
}

// Get the current access token from cookies
export function getAccessToken() {
  const cookieStore = cookies();
  return cookieStore.get('yahoo_access_token')?.value;
}

// Get the current refresh token from cookies
export function getRefreshToken() {
  const cookieStore = cookies();
  const token = cookieStore.get('yahoo_refresh_token')?.value;
  console.log('Auth Server: Refresh token present:', !!token);
  return token;
}

// Get the stored state parameter from cookies
export function getStoredState() {
  const cookieStore = cookies();
  return cookieStore.get('yahoo_state')?.value;
} 