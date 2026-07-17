import { getIronSession, IronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  user?: {
    id: string;
    email: string;
    name: string;
    /**
     * Authorization role, resolved at login (users table + operator env
     * allowlist). Optional because sessions minted before roles existed
     * lack it — middleware treats missing as 'user', so pre-role cookies
     * must re-login to reach /admin.
     */
    role?: 'operator' | 'user';
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'mlboss-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 1 week in seconds
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
} 