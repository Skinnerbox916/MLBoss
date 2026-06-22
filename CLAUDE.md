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
docker start mlboss-redis                # Start Redis (persistent container, auto-starts on boot)
pkill -f "next-server"                   # Kill stale dev servers before restart
```

No test framework is configured.

**Port 3000 is required.** A Cloudflare tunnel maps `mlboss-dev.skibri.us` → `localhost:3000` for Yahoo OAuth (which requires HTTPS). Never leave multiple dev servers running.

**Dev server ownership:** Any `next dev` process running in this repo was started by Claude. At the start of each session, assume responsibility for it. If the user reports a 500 or the server is in a bad state, kill all Next.js processes by PID and restart — do not ask the user to do it. Use `pgrep -a -f next` to find PIDs, kill them explicitly, then `npm run dev` in the background. Verify it comes up on port 3000 before moving on.

**Never `rm -rf .next` while a dev server is running.** Turbopack reads manifest files out of `.next/` on every request; deleting them under a live process makes every request 500 with `ENOENT` on `.next/server/app/page/app-build-manifest.json` (and similar). `npx tsc --noEmit` does **not** require clearing `.next/` — only do so for stale errors that explicitly reference `.next/types/`, and only after killing the dev server first. The dev server's stdout/stderr is at `/tmp/mlboss-dev.log` (or read it via `/proc/<pid>/fd/{1,2}`) — check there before assuming a code-level bug.

**Cloudflare tunnel ownership:** The tunnel (`cloudflared`) must also be running for the app to be reachable via HTTPS. At the start of each session, check with `pgrep -f cloudflared`. If it's not running, start it with `cloudflared tunnel run mlboss` in the background and wait for "Registered" in the output before moving on. This runs in WSL — it does not survive WSL restarts unless user linger is enabled (see `docs/setup.md`).

**After every `npm run build`:** Kill the server and restart it with `npm run dev`. The build command leaves stale Next.js processes that cause 500s when the tunnel routes to the wrong one.

## Architecture

### Authentication & Sessions
- Custom Yahoo OAuth 2.0 flow: login (`/api/auth/login`) -> callback (`/api/auth/callback/yahoo`) -> logout (`/api/auth/logout`)
- Sessions use `iron-session` with encrypted cookies (`src/lib/auth/session.ts`)
- Middleware (`src/middleware.ts`) protects routes: `/dashboard`, `/admin`, `/lineup`, `/streaming`, `/roster`, `/league`, `/api/fantasy`, `/api/admin/test-stats`
- Token auto-refresh handled by `YahooFantasyAPI` (`src/lib/yahoo-fantasy-api.ts`)

### Data Layer
- Redis (`src/lib/redis.ts`) used for caching and session backup
- Three-tier TTL caching: static (24-48h), semi-dynamic (5min-1h), dynamic (30s-1min)
- All cached fetches go through `withCache` / `withCacheGated` (`src/lib/fantasy/cache.ts`); never write to Redis directly from feature code
- **Every cache key must start with a tier prefix** — build it via `${CACHE_CATEGORIES.{TIER}.prefix}:{resource}:{id}`. The tier you pick must match the data's volatility (rubric in `docs/data-architecture.md` "Tier discipline"). `cacheResult` warns on non-tier-prefixed keys; treat the warning as a bug
- Multi-fanout fetchers (anything that does `Promise.all` over a list of IDs) must use `withCacheGated` with a coverage predicate so a partial outage isn't pinned for the full TTL
- Yahoo Fantasy API wrapper: `src/lib/yahoo-fantasy-api.ts` (raw client, ESLint-ignored until fully typed)
- Yahoo OAuth client: `src/lib/auth/yahoo-oauth.ts` (barrel re-exports via `@/lib/auth`)
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
- `players.ts` — Available players (free agents + waivers) by position
- `transactions.ts` — League transactions (adds, drops, trades)
- `index.ts` — Barrel re-exports; consumer code imports from `@/lib/fantasy`

### Navigation & Page Model
Five primary routes, organized by the time horizon of the decisions they support:

- `/dashboard` — **Reference.** Mixed-horizon snapshot: lineup issues, player updates, current-week scoreboard (`CurrentScoreCard`), opponent status, season comparison, waivers, activity.
- `/lineup` — **Lineup.** Daily sit/start. Uses `LineupShell` (`src/components/lineup/LineupShell.tsx`) with segment tabs `[Batters | Pitchers]`. Each tab renders its own `GamePlanPanel` (`side="batting"` / `side="pitching"`) above its content for the chase/hold/punt framing.
  - Batters tab: `LineupManager` with `mode="batting"`
  - Pitchers tab: `TodayPitchers` (`src/components/lineup/TodayPitchers.tsx`) for rostered pitchers + today's game context
- `/streaming` — **This-week pickups.** `StreamingManager` + `StreamingBoard` (pitchers) / `BatterStreamingBoard` (batters) with a `DateStrip` covering D+1 through D+5. Each tab leads with `GamePlanPanel` matching the side. Points leagues route to `PointsStreamingManager` instead: a week-plan header (moves budget, open slot-days, day coverage strip) over boards ranking FA pitcher starts by expected points and FA bats by marginal lineup gain; weekly-lineup leagues (Yahoo `weekly_deadline`) flip the window to next week and the framing to locked-in idle days (see `docs/streaming-page.md#points-league-view`).
- `/roster` — **ROS roster construction (matchup vacuum).** `RosterManager` with segment tabs `[Batters | Pitchers]`. Page leads with `RosterFocusPanel` (per-side chase/hold/punt tile grid), then `DepthChart`, then `Suggested Moves` (swaps + pure adds when open slots exist), then the per-player tables. Focus suggestions come from talent-only neutral-week projection ranked across the league, RUPM-based closeability, and a manager-engagement multiplier — no this-week schedule, no opp SP, no park. There is intentionally no marquee rank summary — every signal on the page is forward-looking talent + roster shape, and a YTD rank strip would contradict the suggestions; go to `/league` for YTD league-wide rankings. Batters tab runs the full depth-chart + move optimizer; the pitchers tab lists rostered + available pitchers (full pitcher optimizer is follow-up work). See [docs/roster-strategy.md](docs/roster-strategy.md).
- `/league` — **Reference.** Standings, stat rankings, league-wide context.

Both the Lineup and Streaming pages share the lineup component library (`src/components/lineup/`) via a `LineupMode` type (`'batting' | 'pitching'`). They also share `GamePlanPanel` (`src/components/shared/GamePlanPanel.tsx`) — the chase/hold/punt tile grid with inline focus segmented control — and `useMatchupHeader` for the panel's week/opponent header inputs.

### Dashboard
- Card-based architecture: `src/components/dashboard/`
- `FantasyProvider` (`src/components/dashboard/FantasyProvider.tsx`) wraps cards, provides league/team keys via React context
- Data flow: Fantasy domain layer -> API route (`/api/fantasy/*`) -> SWR hook (`src/lib/hooks/`) -> Card component -> `DashboardCard` wrapper -> `GridLayout` -> Page
- Hooks are shared between dashboard cards and dedicated pages (same data, different presentation)
- Add cards by creating in `src/components/dashboard/cards/`, registering in `src/app/dashboard/page.tsx`

### UI System
- **Before creating new UI components, read `docs/ui-patterns.md`** — it lists every shared component and display pattern. Reuse before inventing.
- Tailwind CSS v4 with custom design tokens defined as CSS variables in `src/app/globals.css`
- Brand colors: primary (Prussian blue `#132F43`), accent (dark goldenrod `#C89222`), success (green), error (red) — all with 50-900 intensity scales
- Three fonts: Pacifico (display/headings), Quicksand (body), JetBrains Mono (code/data)
- Typography components: `src/components/typography/` (`Heading`, `Text`)
- Icon wrapper: `src/components/Icon.tsx` — use Game Icons (`react-icons/gi`) for baseball, Feather Icons (`react-icons/fi`) for UI
- Layout shell: `src/components/layout/AppLayout.tsx`

### Path Aliases
`@/*` maps to `./src/*` (configured in `tsconfig.json`)

## Environment Variables

Required: `APP_URL`, `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `SESSION_SECRET`, plus Redis (either `REDIS_URL` or `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB`)

Schema and validation: `src/constants/envSchema.ts`

## Documentation

All docs live in `docs/`. Full index: `docs/README.md`. **For any non-trivial change, load `docs/engines.md` first to orient, then drop into the relevant per-layer doc.**

Reading order:
- `docs/engines.md` — registry of every prediction/suggestion engine, by layer. Load first.
- `docs/architecture.md` — principles, anti-patterns, rules for adding engines/docs/constants. Read once.
- `docs/history.md` — decision log of patterns we tried and stopped. Consult before reintroducing a deleted pattern.

Per-layer / per-concept reference:
- `docs/unified-rating-model.md` — L1+L2+L3 talent / forecast / rating (both engines, shared substrate)
- `docs/projection.md` — L4 team projection, lineup optimizer, slot-aware streaming
- `docs/recommendation-system.md` — L5 matchup state (`analyzeMatchup`, focus) and L7 Boss Brief
- `docs/roster-strategy.md` — L6 league forecast, forward focus, swap strategy
- `docs/stat-levels.md` — the four stat levels (raw counting / raw rate / regressed talent / matchup-adjusted)
- `docs/league-baselines.md` — cross-engine league-mean constants
- `docs/data-architecture.md` — source/model/compose, cache tiers, identity contract
- `docs/streaming-page.md` — streaming-page specifics (Yahoo pagination, FA matching, Game Plan card)
- `docs/dashboard-components.md` — dashboard card architecture
- `docs/ui-patterns.md` — shared UI components and display patterns
- `docs/design-system.md` — colors, typography, container intent rubric
- `docs/stats.md` — `stat_id` architecture
- `docs/setup.md`, `docs/yahoo-api-reference.md`, `docs/mlb-api-reference.md`, `docs/product-spec.md` — setup and API refs

### Documentation discipline

These rules exist because the doc set previously fractured into multiple "canonical" tables of the same content (calibration anchors in 3 docs, canonical-implementations tables in 4 docs). LLMs treat conflicting docs as authoritative on both sides; drift is the cardinal sin.

- **One concept = one home.** Don't add a canonical table or rationale that already lives elsewhere — link to the existing home. If the existing home is wrong, fix it there.
- **Source owns values; doc owns rationale.** Calibration constants live in `.ts` files. Comment is a one-line pointer to the doc section (e.g. `// see docs/unified-rating-model.md#calibration-anchors`). Doc tables list file path + anchor, never the value itself.
- **When you delete a canonical engine / function / pattern, add a `docs/history.md` entry.** Date, what changed, why we stopped. Bar: "an LLM might propose to re-introduce this; without context they'd be right to try."
- **When you tune a calibration constant, read the linked doc section first.** Confirm the rationale still holds. If the rationale changed, update the doc. If the change is wide-blast (touches a league mean or prior strength), add a history.md entry and run the smoke harness (`/api/admin/test-pitcher-eval`).
- **When you add a new engine or doc**, see `docs/architecture.md#rules-for-adding-a-new-engine` and register it in `docs/engines.md` (engines) or `docs/README.md` (docs).

## Gotchas

- **Dev server must be on port 3000** — Cloudflare tunnel (`mlboss-dev.skibri.us` → `localhost:3000`) provides the HTTPS that Yahoo OAuth requires. Kill stale servers before restarting.
- Yahoo rate limit: ~60-100 requests/hour — rely on tiered caching
- Yahoo JSON responses use numeric keys; XML may be more reliable
- Dev tunnel origin allowed: `mlboss-dev.skibri.us` (see `next.config.ts`)
