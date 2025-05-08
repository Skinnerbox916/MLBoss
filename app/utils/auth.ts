// Minimal Yahoo OAuth client-side helpers
// App ID: 2yZewwq0 (NOT used in OAuth flow)
export const YAHOO_CLIENT_ID = 'dj0yJmk9dWZ4NW1yb1lsVXJ6JmQ9WVdrOU1ubGFaWGQzY1RBbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTRi';
export const YAHOO_CLIENT_SECRET = '3ec2cbb9c20965cdaf99f98c2d8cd9e558cd9d8c';
export const YAHOO_REDIRECT_URI = 'https://dev-tunnel.skibri.us/api/auth/callback';

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
  `https://api.login.yahoo.com/oauth2/request_auth?client_id=${YAHOO_CLIENT_ID}&redirect_uri=${encodeURIComponent(YAHOO_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('fspt-w')}&state=${state}${forceLogin ? '&prompt=login' : ''}`; 