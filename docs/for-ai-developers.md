# For AI Developers

➜ [product-spec.md](./product-spec.md) – project overview

This guide is specifically written for LLMs working on the MLBoss codebase. It contains documentation strategy and key patterns to follow.

## Quick Links

- **Engine registry** - [engines.md](./engines.md) — load this first to orient
- **Strategy / principles** - [architecture.md](./architecture.md) — read this once
- **Decision log** - [history.md](./history.md) — patterns we tried and stopped
- **Data Layer Architecture** - [data-architecture.md](./data-architecture.md)
- **Statistical Architecture** - [stats.md](./stats.md)
- **Yahoo API Reference** - [yahoo-api-reference.md](./yahoo-api-reference.md)
- **Dashboard Components** - [dashboard-components.md](./dashboard-components.md)

## Documentation Strategy

### Reading order for LLMs

1. **Top-level index first** — [engines.md](./engines.md) tells you what engines exist and where they live. Load this when you don't know the codebase yet.
2. **Strategy doc next** — [architecture.md](./architecture.md) has the six principles and the anti-patterns to avoid. Read this once; consult when adding a new engine.
3. **Per-layer reference** — drop into the relevant engine doc when you're touching that code (e.g. [unified-rating-model.md](./unified-rating-model.md) for L1+L2+L3, [projection.md](./projection.md) for L4, etc.).
4. **Cross-cutting concepts** — [stat-levels.md](./stat-levels.md) and [league-baselines.md](./league-baselines.md) for the vocabulary used across engines.

### Core principles

1. **One concept = one home.** Each idea has exactly one canonical home in the docs. Other places link, never restate. Drift between two "authoritative" descriptions is the worst-case failure mode for LLM consumers.
2. **Source is authoritative for values; doc is authoritative for rationale.** Calibration constants live in `.ts` files with a one-line comment pointing to the doc section. The doc owns the *why*, not the *what*.
3. **History is separate from reference.** Live rules and dead rules go in different files. See [history.md](./history.md).
4. **Index entries are one line.** If [engines.md](./engines.md) grows multi-paragraph entries, split out a per-engine doc.

## Common Patterns

Authentication, caching, and stat enrichment patterns are documented in **[data-architecture.md](./data-architecture.md)**. Stat-level discipline (raw counting / raw rate / regressed talent / matchup-adjusted) lives in **[stat-levels.md](./stat-levels.md)**. Cross-engine calibration constants live in **[league-baselines.md](./league-baselines.md)**.

## Navigation Tips

1. **Touching engine code** - Find the engine in [engines.md](./engines.md); follow the layer pointer to the detail doc.
2. **Tuning a calibration constant** - Open the source file. The inline comment points to the doc section that owns the rationale. Update both; add a [history.md](./history.md) entry if the change is wide-blast.
3. **Adding a new engine** - Read [architecture.md](./architecture.md#rules-for-adding-a-new-engine). Place it in a layer, register in [engines.md](./engines.md).
4. **Deleting or deprecating a pattern** - Add a [history.md](./history.md) entry before merging.

## Environment Variables

Complete and up-to-date environment variable definitions live in **[Setup & Configuration](./setup.md)**. Refer to that file when updating or reviewing `.env.local`.

## Common Gotchas

1. **OAuth redirect** - Must use HTTPS (use ngrok for local dev)
2. **Token expiration** - Access tokens last ~1 hour, use refresh tokens
3. **Rate limits** - Yahoo allows ~60-100 requests/hour, implement tiered caching (Static/Semi-dynamic/Dynamic)
4. **JSON structure** - Yahoo's JSON has numeric keys, consider using XML
5. **`position_types` from Yahoo JSON is unreliable** - The field can be absent, a plain string (`"B"`), a nested object (`{"position_type":"B"}`), or a numeric-key object (`{"position_type":{"0":"B","count":1}}`). Always use `normalizePositionTypes()` in `yahoo-fantasy-api.ts` when parsing it. `getEnrichedLeagueStatCategories` also falls back to `COMMON_MLB_STATS` in `src/constants/statCategories.ts` as a last resort.
6. **Never use `flushdb` to clear cache** - It wipes `user:*` auth data alongside cache keys, breaking all Yahoo API calls. Use the `/admin/cache` page (targets `cache:*` only) or `invalidateCachePattern()`. See also the cache tier key format note in [data-architecture.md](./data-architecture.md).
7. **Cache Redis key format** - `withCache` stores keys as `cache:{tier}:{resource}:{id}` (e.g. `cache:static:stat_category_map:458`). The `CACHE_CATEGORIES` prefix constants are the tier segment only — you must include the `cache:` namespace when querying Redis directly.

## Quick Command Reference

```powershell
# Start Redis (persistent container, auto-starts with Docker Desktop)
docker start mlboss-redis

# Start development server
npm run dev

# Check Redis connection (requires auth — visit in browser while logged in)
# GET /api/admin/health
```

## Where to Find Things

- **OAuth logic**: `/src/lib/auth/yahoo-oauth.ts` (re-exported from `@/lib/auth`)
- **Fantasy API**: `/src/lib/yahoo-fantasy-api.ts`
- **Fantasy data layer**: `/src/lib/fantasy/`
- **API routes**: `/src/app/api/`
- **Session config**: `/src/lib/auth/session.ts` (re-exported from `@/lib/auth`)
- **Redis client**: `/src/lib/redis.ts`
- **UI Components**: 
  - Icon system: `/src/components/Icon.tsx` (wrapper for react-icons)
  - Layout: `/src/components/layout/AppLayout.tsx`
  - Utils: `/src/lib/utils.ts` (cn helper for className concatenation) 