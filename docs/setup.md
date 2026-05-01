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

## Local Development

### Port & Tunnel Requirements

The dev server **must run on port 3000**. A Cloudflare tunnel maps `mlboss-dev.skibri.us` → `localhost:3000`, and the Yahoo OAuth redirect URI is configured against that domain. If the server starts on a different port, OAuth callbacks will fail silently.

Next.js will auto-increment to port 3001, 3002, etc. if 3000 is already in use (e.g., from a stale process). If you see a port-in-use warning at startup:

```bash
# Find and kill stale Next.js processes on ports 3000-3002
ss -tlnp | grep -E '300[0-2]'           # see what's listening
kill <pid>                                # kill stale processes

# Then restart
npm run dev
```

Confirm the output says `Local: http://localhost:3000` before testing.

### Cloudflare Tunnel

The Cloudflare tunnel (`cloudflared`) must be running alongside the dev server. It maps `mlboss-dev.skibri.us` → `localhost:3000` and provides the HTTPS that Yahoo OAuth requires.

**Check if running:**
```bash
pgrep -f cloudflared || echo "Not running"
```

**Start manually:**
```bash
cloudflared tunnel run mlboss
```

**Auto-start on WSL boot (one-time setup):**

A user systemd service is already installed at `~/.config/systemd/user/cloudflared.service`. To make it start automatically whenever WSL boots (without a login shell), enable user lingering once with:

```bash
sudo loginctl enable-linger truehoax
```

After that, `systemctl --user start cloudflared` will also survive WSL restarts. Without linger, you must start it manually each session or rely on the AI agent to start it.

**Diagnose a Cloudflare 1033 error:**

Error 1033 means the tunnel is configured but `cloudflared` is not running or cannot reach `localhost:3000`. Check both:
1. `pgrep -f cloudflared` — tunnel process running?
2. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` — dev server responding?

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start Redis
# One-time setup — creates a persistent container with a data volume that
# auto-starts with Docker Desktop on boot:
docker run -d \
  --name mlboss-redis \
  --restart unless-stopped \
  -p 6379:6379 \
  -v mlboss-redis-data:/data \
  redis:alpine redis-server --appendonly yes

# After the initial setup, if the container is ever stopped:
docker start mlboss-redis

# 3. Kill any stale dev servers first
pkill -f "next-server" 2>/dev/null

# 4. Run the dev server (must be on port 3000)
npm run dev

# 5. Start the Cloudflare tunnel (if not already running)
pgrep -f cloudflared || cloudflared tunnel run mlboss
```

Once the server and tunnel are running, open `https://mlboss-dev.skibri.us` and click "Login with Yahoo" to begin the OAuth flow. 