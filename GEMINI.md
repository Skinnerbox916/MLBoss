# GEMINI.md

This file provides guidance and foundational mandates for development within the MLBoss repository. It takes precedence over general workflows.

## Project Overview
MLBoss is a fantasy baseball decision-support tool.
- **Tech Stack:** Next.js 15 (App Router, Turbopack), TypeScript, Tailwind CSS v4.
- **Backend/Integration:** Yahoo Fantasy Sports API (Custom OAuth 2.0), Redis (Caching & Sessions).
- **Core Vision:** Support fantasy baseball decisions across multiple time horizons (Daily, Weekly, Season-long).

---

## Critical Infrastructure & Environment
The project relies on a specific local environment setup to handle Yahoo OAuth (which requires HTTPS and a registered callback URL).

- **Port Requirement:** The development server **MUST** run on port `3000`.
- **Cloudflare Tunnel:** `cloudflared` must be running to map `mlboss-dev.skibri.us` (HTTPS) to `localhost:3000`.
- **Redis:** A local Redis instance (typically a Docker container named `mlboss-redis`) is required for caching and session management.
- **Dev Server Ownership:** You are responsible for the `next dev` process. If 500 errors occur or the server hangs, kill all Next.js processes (`pgrep -a -f next`) and restart. **Never `rm -rf .next` while the server is running.**

---

## Essential Commands
```bash
# Start infrastructure
docker start mlboss-redis
cloudflared tunnel run mlboss

# Development
npm run dev          # Starts dev server with Turbopack (Port 3000)
npm run lint         # Runs ESLint

# Maintenance
pkill -f "next-server"                   # Kill stale servers
pgrep -a -f next                         # Find Next.js PIDs
```

---

## Architecture & Data Flow

### 1. Data Layer & Caching (`src/lib/fantasy/cache.ts`)
- **Three-Tier TTL Caching:**
  - `STATIC`: 24-48h (Stat categories, league settings)
  - `SEMI_DYNAMIC`: 5min-1h (Standings, rosters)
  - `DYNAMIC`: 30s-1min (Live scores, active matchups)
- **Constraint:** Every cache key **MUST** start with a tier prefix: `${CACHE_CATEGORIES.{TIER}.prefix}:{resource}:{id}`.
- **Implementation:** Always use `withCache` or `withCacheGated`. Never write to Redis directly from feature code.

### 2. Authentication (`src/lib/auth/`)
- Custom OAuth 2.0 flow for Yahoo.
- Sessions managed via `iron-session` (`src/lib/auth/session.ts`).
- Middleware (`src/middleware.ts`) protects authenticated routes.

### 3. Domain Layer (`src/lib/fantasy/`)
Logic is organized by resource: `stats.ts`, `leagues.ts`, `roster.ts`, `players.ts`, `matchups.ts`, etc. Prefer importing from the barrel `@/lib/fantasy`.

### 4. UI System
- **Tailwind CSS v4:** Uses custom design tokens in `src/app/globals.css`.
- **Reuse Over Invention:** Before building new UI, consult `docs/ui-patterns.md`.
- **Key Components:**
  - `Panel`: Standard section container.
  - `Badge`: Inline status/verdict indicators.
  - `Tabs`: `variant="segment"` (modes) vs `variant="underline"` (peer views).
  - `DivergingRow`: Side-by-side stat comparisons.
  - `DashboardCard`: Wrapper for all dashboard cards.
  - `Icon`: Wrapper for `react-icons` (GI for baseball, FI for UI).

---

## Core Conventions

- **Path Aliases:** Use `@/*` for `src/*`.
- **Stat Identification:** Use `stat_id` (numeric string) as the canonical identifier. Map them using `src/constants/statCategories.ts`.
- **Stat Formatting:** **ALWAYS** use `formatStatValue` and `formatStatDelta` from `@/lib/formatStat`. Never format stats inline.
- **Position Normalization:** Always use `normalizePositionTypes()` when handling Yahoo's inconsistent `position_types` field.
- **Component Placement:** 
  - Generic UI primitives: `src/components/ui/`
  - Domain-specific shared components: `src/components/shared/`
  - Page-specific components: `src/components/{route}/`

---

## Documentation Index
- `docs/ui-patterns.md`: UI inventory and anti-patterns.
- `docs/data-architecture.md`: Caching, identity contract, and API reference.
- `docs/scoring-conventions.md`: Stat levels and calibration knobs.
- `docs/recommendation-system.md`: Matchup-state layer and focus suggestions.
- `docs/stats.md`: Stat ID architecture.
- `docs/for-ai-developers.md`: Specific tips for LLM contributors.

---

## Critical Gotchas
1. **Never use `flushdb`**: It wipes user session data. Use `/admin/cache` or `invalidateCachePattern()`.
2. **Yahoo JSON Numeric Keys**: Yahoo returns data with numeric keys (0, 1, 2...); be careful when parsing/mapping.
3. **Turbopack ENOENT**: Deleting `.next/` while the server is running causes 500 errors.
4. **Cloudflare Tunnel:** If the app is unreachable via HTTPS, ensure the tunnel is running.
