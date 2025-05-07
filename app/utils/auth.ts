// Minimal Yahoo OAuth client-side helpers
export const YAHOO_CLIENT_ID = 'dj0yJmk9eUFSWTNWZW9GWFFVJmQ9WVdrOWRYVkVaazF3TWswbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTk5';
export const YAHOO_CLIENT_SECRET = '5dba8ae54c5ff474f54f511047ef48fab1084a35';
export const YAHOO_REDIRECT_URI = 'https://e657-45-29-68-219.ngrok-free.app/api/auth/callback';

// Generate a random state parameter for CSRF protection
export function generateState() {
  return Math.random().toString(36).substring(2, 15);
}

// Client-side cookie management
export function getClientCookie(name: string) {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export function setClientCookie(name: string, value: string, options: { [key: string]: any } = {}) {
  if (typeof document === 'undefined') return;
  let cookie = `${name}=${value}`;
  if (options.path) cookie += `; path=${options.path}`;
  if (options.maxAge) cookie += `; max-age=${options.maxAge}`;
  if (options.secure) cookie += '; secure';
  if (options.sameSite) cookie += `; samesite=${options.sameSite}`;
  document.cookie = cookie;
}

export function deleteClientCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Max-Age=0; path=/;`;
}

export const YAHOO_AUTH_URL = (state: string, forceLogin: boolean = false) =>
  `https://api.login.yahoo.com/oauth2/request_auth?client_id=${YAHOO_CLIENT_ID}&redirect_uri=${encodeURIComponent(YAHOO_REDIRECT_URI)}&response_type=code&scope=openid%20fspt-w&state=${state}${forceLogin ? '&prompt=login' : ''}`; 