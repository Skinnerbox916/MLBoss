# For AI Developers

➜ [product-spec.md](./product-spec.md) – project overview

This guide is specifically written for LLMs working on the MLBoss codebase. It contains documentation strategy and key patterns to follow.

## Quick Links

- **Data Layer Architecture** - See [data-architecture.md](./data-architecture.md)
- **Scoring Conventions** - See [scoring-conventions.md](./scoring-conventions.md)
- **Statistical Architecture** - See [stats.md](./stats.md)
- **Yahoo API Reference** - See [yahoo-api-reference.md](./yahoo-api-reference.md)
- **Dashboard Components** - See [dashboard-components.md](./dashboard-components.md)

## Documentation Strategy

### Core Principles

1. **Keep docs near code** - Documentation lives next to the code it describes
   - `docs/data-architecture.md` for data layer
   - `docs/scoring-conventions.md` for stat-level conventions
   - Component-level docs in their directories

2. **One README per package root** - Don't over-nest documentation
   - Main concepts at package level
   - Implementation details in code comments

3. **Reality over aspiration** - Document what exists, not what's planned
   - This file tracks actual implementation status
   - No roadmap promises

4. **LLM-first, human-friendly** - Optimize for machine parsing
   - Clear structure and headings
   - Code examples with context
   - Error patterns and solutions

## Common Patterns

Authentication, caching, and stat enrichment patterns are documented in **[data-architecture.md](./data-architecture.md)**. Per-stat conventions (which fields are regressed, calibration knobs) live in **[scoring-conventions.md](./scoring-conventions.md)**.

## Navigation Tips

1. **Check the data layer** - See [data-architecture.md](./data-architecture.md) for the three-layer model, fetch+cache contract, and identity contract
2. **Reference scoring conventions** - [scoring-conventions.md](./scoring-conventions.md) for stat levels and calibration knobs
3. **Reference Yahoo API guide** - [yahoo-api-reference.md](./yahoo-api-reference.md) for API details
4. **Dashboard architecture** - [dashboard-components.md](./dashboard-components.md) for card system

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

# Check Redis connection
npm run test-redis
```

## Where to Find Things

- **OAuth logic**: `/src/lib/yahoo-oauth.ts`
- **Fantasy API**: `/src/lib/yahoo-fantasy-api.ts`
- **Fantasy data layer**: `/src/lib/fantasy/`
- **API routes**: `/src/app/api/`
- **Session config**: `/src/lib/session.ts`
- **Redis client**: `/src/lib/redis.ts`
- **UI Components**: 
  - Icon system: `/src/components/Icon.tsx` (wrapper for react-icons)
  - Layout: `/src/components/layout/AppLayout.tsx`
  - Utils: `/src/lib/utils.ts` (cn helper for className concatenation) 