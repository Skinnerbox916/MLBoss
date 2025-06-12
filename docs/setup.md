# Setup & Configuration

➜ [product-spec.md](./product-spec.md) – project overview

This document is the single source of truth for all environment variables and the Yahoo OAuth setup required to run MLBoss.

## Required Environment Variables

Environment variable schema is defined in TypeScript at `src/constants/envSchema.ts`. This provides type-safe validation and auto-generated examples.

**Quick reference:**
- `APP_URL` — Public base URL for OAuth redirects
- `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` — Yahoo Developer app credentials  
- `REDIS_URL` — Redis connection string
- `SESSION_SECRET` — 64-character cookie encryption key

**Generate .env.local template:**
```typescript
import { generateEnvExample } from '@/constants/envSchema';
console.log(generateEnvExample());
```

**Runtime validation:**
```typescript
import { validateEnvVars } from '@/constants/envSchema';
validateEnvVars(); // throws if required vars missing
```

## OAuth Flow (Yahoo)

MLBoss uses a custom OAuth 2.0 integration (no NextAuth). Below is a condensed overview.

1. **Login** – `GET /api/auth/login` generates a CSRF `state`, stores it in Redis (10 min TTL), and redirects to Yahoo's authorize URL.
2. **Callback** – `GET /api/auth/callback/yahoo` validates `state`, exchanges the code for tokens, fetches or decodes user info, writes the user/session to Redis + iron-session, then redirects to the dashboard.
3. **Logout** – `POST /api/auth/logout` destroys the session and user cache.

### Token Management

* Access tokens last ~1 hour and are auto-refreshed by `YahooFantasyAPI` with a 5-minute buffer.
* Refresh tokens are stored securely in both the encrypted session and Redis.

### Yahoo App Checklist

1. Create an app at <https://developer.yahoo.com/apps/>.
2. Enable **Fantasy Sports – Read/Write** permission.
3. Set the redirect URI to `${APP_URL}/api/auth/callback/yahoo`.
4. (Optional) enable OpenID Connect Profile/Email scopes for richer user data.

## Security Notes

* All sensitive variables must be supplied via environment configuration – never hard-code them.
* Use HTTPS in development (ngrok or similar) so Yahoo will redirect properly.

## Quick Start Recap

```bash
# 1. Install dependencies
npm install

# 2. Start Redis (Docker example)
docker run -d -p 6379:6379 redis:alpine

# 3. Run the dev server
npm run dev
```

Once the server is running, open `http://localhost:3000` and click "Login with Yahoo" to begin the OAuth flow. 