# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MLBoss is a fantasy baseball decision-support tool built with Next.js 15 (App Router, Turbopack). It integrates Yahoo Fantasy Sports via custom OAuth 2.0 (no NextAuth) and uses Redis for session/cache storage.

## Commands

```bash
npm run dev          # Start dev server (Turbopack) — MUST be on port 3000
npm run build        # Production build
npm run lint         # ESLint (next lint)
npm start            # Start production server
docker run -d -p 6379:6379 redis:alpine  # Redis (required dependency)
pkill -f "next-server"                   # Kill stale dev servers before restart
```

No test framework is configured.

**Port 3000 is required.** A Cloudflare tunnel maps `mlboss-dev.skibri.us` → `localhost:3000` for Yahoo OAuth (which requires HTTPS). Never leave multiple dev servers running.

**Dev server ownership:** Any `next dev` process running in this repo was started by Claude. At the start of each session, assume responsibility for it. If the user reports a 500 or the server is in a bad state, kill all Next.js processes by PID and restart — do not ask the user to do it. Use `pgrep -a -f next` to find PIDs, kill them explicitly, then `npm run dev` in the background. Verify it comes up on port 3000 before moving on.

**After every `npm run build`:** Kill the server and restart it with `npm run dev`. The build command leaves stale Next.js processes that cause 500s when the tunnel routes to the wrong one.

## Architecture

### Authentication & Sessions
- Custom Yahoo OAuth 2.0 flow: login (`/api/auth/login`) -> callback (`/api/auth/callback/yahoo`) -> logout (`/api/auth/logout`)
- Sessions use `iron-session` with encrypted cookies (`src/lib/session.ts`)
- Middleware (`src/middleware.ts`) protects routes: `/dashboard`, `/admin`, `/matchup`, `/lineup`, `/roster`, `/league`, `/api/fantasy`, `/api/test-stats`
- Token auto-refresh handled by `YahooFantasyAPI` (`src/lib/yahoo-fantasy-api.ts`)

### Data Layer
- Redis (`src/lib/redis.ts`) used for caching and session backup
- Three-tier TTL caching: static (24-48h), semi-dynamic (5min-1h), dynamic (30s-1min)
- Yahoo Fantasy API wrapper: `src/lib/yahoo-fantasy-api.ts` (raw client, ESLint-ignored until fully typed)
- Yahoo OAuth client: `src/lib/yahoo-oauth.ts`
- Stats use `stat_id` as canonical identifier (see `src/constants/statCategories.ts`, `docs/stats.md`)

### Fantasy Domain Layer (`src/lib/fantasy/`)
- `cache.ts` — Redis caching utilities with tiered TTL constants (STATIC / SEMI_DYNAMIC / DYNAMIC)
- `auth.ts` — Token validation, refresh, and user lookup from Redis
- `stats.ts` — Stat category fetching, enrichment, league-specific scored categories
- `leagues.ts` — League/team discovery, user team identification, `analyzeUserFantasyLeagues`
- `standings.ts` — League standings (ranks, records, points)
- `matchups.ts` — Scoreboard (weekly matchup scores) and team schedule
- `teamStats.ts` — Team stats (season-to-date and weekly)
- `roster.ts` — Team roster (players, positions, injury status)
- `transactions.ts` — League transactions (adds, drops, trades)
- `index.ts` — Barrel re-exports; consumer code imports from `@/lib/fantasy`

### Dashboard
- Card-based architecture: `src/components/dashboard/`
- `FantasyProvider` (`src/components/dashboard/FantasyProvider.tsx`) wraps cards, provides league/team keys via React context
- Data flow: Fantasy domain layer -> API route (`/api/fantasy/*`) -> SWR hook (`src/lib/hooks/`) -> Card component -> `DashboardCard` wrapper -> `GridLayout` -> Page
- Hooks are shared between dashboard cards and dedicated pages (same data, different presentation)
- Add cards by creating in `src/components/dashboard/cards/`, registering in `src/app/dashboard/page.tsx`

### UI System
- Tailwind CSS v4 with custom design tokens defined as CSS variables in `src/app/globals.css`
- Brand colors: primary (Prussian blue `#132F43`), accent (dark goldenrod `#C89222`), success (green), error (red) — all with 50-900 intensity scales
- Three fonts: Pacifico (display/headings), Quicksand (body), JetBrains Mono (code/data)
- Typography components: `src/components/typography/` (`Heading`, `Text`)
- Icon wrapper: `src/components/Icon.tsx` — use Game Icons (`react-icons/gi`) for baseball, Feather Icons (`react-icons/fi`) for UI
- Layout shell: `src/components/layout/AppLayout.tsx`

### Path Aliases
`@/*` maps to `./src/*` (configured in `tsconfig.json`)

## Environment Variables

Required: `APP_URL`, `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `REDIS_URL`, `SESSION_SECRET`

Schema and validation: `src/constants/envSchema.ts`

## Documentation

All docs live in `docs/`. Index: `docs/README.md`. Key files:
- `docs/product-spec.md` — product vision and features
- `docs/design-system.md` — colors, typography, component patterns
- `docs/setup.md` — environment setup and OAuth configuration
- `docs/for-ai-developers.md` — LLM contributor guide with gotchas
- `docs/yahoo-api-reference.md` — Yahoo Fantasy API reference
- `docs/dashboard-components.md` — dashboard card architecture
- `docs/data-layer.md` — data layer architecture, caching, types, full API reference
- `docs/stats.md` — stat_id architecture and disambiguation patterns

## Gotchas

- **Dev server must be on port 3000** — Cloudflare tunnel (`mlboss-dev.skibri.us` → `localhost:3000`) provides the HTTPS that Yahoo OAuth requires. Kill stale servers before restarting.
- Yahoo rate limit: ~60-100 requests/hour — rely on tiered caching
- Yahoo JSON responses use numeric keys; XML may be more reliable
- Dev tunnel origin allowed: `mlboss-dev.skibri.us` (see `next.config.ts`)
