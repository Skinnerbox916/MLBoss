// Auth barrel — user-facing authentication & session management.
//
// Yahoo OAuth handles the login flow; iron-session stores the resulting tokens
// in an encrypted cookie. Domain-specific token validation/refresh for the
// Yahoo Fantasy API itself lives in `@/lib/fantasy/auth` since it depends on
// fantasy cache + Redis state.

export { YahooOAuth } from './yahoo-oauth';
export type { YahooUserInfo } from './yahoo-oauth';

export { getSession, sessionOptions } from './session';
export type { SessionData } from './session';
