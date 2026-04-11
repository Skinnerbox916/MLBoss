# Fantasy Data Layer

The fantasy data layer (`src/lib/fantasy/`) sits between page/API-route code and the raw Yahoo Fantasy API client. It adds caching, token management, type safety, and domain-specific logic.

## Module Structure

```
src/lib/fantasy/
├── cache.ts    — Redis caching: withCache, TTL tiers, invalidation
├── auth.ts     — Token validation and refresh via Redis
├── stats.ts    — Stat categories, enrichment, league-specific categories
├── leagues.ts  — League/team discovery, user team identification
└── index.ts    — Barrel re-exports (import everything from @/lib/fantasy)
```

### How it fits together

```
Page / API route
  └── @/lib/fantasy  (this layer — caching, types, composition)
        └── YahooFantasyAPI  (raw HTTP client — src/lib/yahoo-fantasy-api.ts)
              └── YahooOAuth  (token exchange — src/lib/yahoo-oauth.ts)
                    └── Redis  (token storage, cache backend — src/lib/redis.ts)
```

Consumer code should import from `@/lib/fantasy`, never from the raw client directly.

## Caching

### Tiers

All cache values are stored in Redis under keys with the format `cache:{tier}:{resource}:{identifier}`.

| Tier | TTL | Use case | Redis key pattern |
|------|-----|----------|-------------------|
| **STATIC** | 24–48 h | Game metadata, stat categories | `cache:static:*` |
| **SEMI_DYNAMIC** | 5 min – 1 h | Leagues, teams, league settings | `cache:semi-dynamic:*` |
| **DYNAMIC** | 30 s – 1 min | Scoreboards, live stats | `cache:dynamic:*` |

> **Important:** The `CACHE_CATEGORIES.{TIER}.prefix` constants (`"static"`, `"semi-dynamic"`, `"dynamic"`) are the *tier* segment only. `withCache` / `cacheResult` add the `cache:` namespace prefix automatically. When scanning Redis directly (e.g. in `KEYS` commands or cache-clearing scripts) always use the full `cache:{tier}:*` pattern.

### `withCache`

Every cached function uses the `withCache` wrapper instead of manual check/fetch/store:

```typescript
import { withCache, CACHE_CATEGORIES } from './cache';

export async function getUserLeagues(userId: string): Promise<League[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:leagues:${userId}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
    () => new YahooFantasyAPI(userId).getUserLeagues(),
  );
}
```

### Invalidation

After mutations (roster moves, waiver claims), bust stale data:

```typescript
import { invalidateCache, invalidateCachePattern } from '@/lib/fantasy';

// Single key
await invalidateCache('semi-dynamic:teams:458.l.12345');

// All keys with a prefix
await invalidateCachePattern('semi-dynamic:teams:458.l.12345');
```

## Error Handling

### `Result<T>` union

Functions that can fail in expected ways return a discriminated union instead of throwing or returning `null`:

```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
```

Usage in consumers:

```typescript
const result = await analyzeUserFantasyLeagues(userId, [gameKey]);
if (!result.ok) {
  // handle error — result.error is a string
  throw new Error(result.error);
}
// result.data is fully typed as LeagueAnalysis
```

Functions that fetch a single cacheable resource (like `getStatCategories`) throw on failure — they have no meaningful partial-success case. `Result<T>` is used where an operation has multiple steps that can individually fail (like analyzing leagues).

## Token Management

`YahooFantasyAPI` handles token refresh internally (with a 5-minute buffer before expiry). The data layer does **not** pre-validate tokens before API calls — this avoids redundant Redis round-trips.

User auth data (`user:{id}` hash and `token:{accessToken}` lookup) is stored in Redis as a backup, but the **iron-session cookie is the source of truth**. If Redis is cleared, `getValidAccessToken` falls back to the session cookie automatically — no re-login required.

> **Never use `redis.flushdb()` to clear cache** — it wipes `user:*` and `token:*` keys alongside the cache data, breaking all Yahoo API calls until the user re-logs in. Use the `/admin/cache` page or target `cache:*` keys directly.

`auth.ts` provides utilities for pages that need to check or display token status (e.g., the admin debug page):

| Function | Purpose |
|----------|---------|
| `isTokenValid(userId)` | Check if token is expired (Redis lookup) |
| `refreshUserTokens(userId)` | Force a token refresh |
| `getUserFromRedis(userId)` | Get full user record from Redis |
| `getUserIdFromToken(token)` | Reverse lookup: token → userId |

## Types

### Exported from `yahoo-fantasy-api.ts`

| Type | Description |
|------|-------------|
| `League` | Yahoo league metadata (key, name, scoring_type, etc.) |
| `Team` | Yahoo team with managers, roster adds, waiver priority |
| `Manager` | Team manager with guid, login status, commissioner flag |
| `StatCategory` | Raw stat category (stat_id, name, display_name, sort_order, position_types) |

### Exported from `@/lib/fantasy`

| Type | Source | Description |
|------|--------|-------------|
| `Result<T>` | `leagues.ts` | Discriminated success/failure union |
| `LeagueAnalysis` | `leagues.ts` | Full analysis result (summary + league entries) |
| `LeagueAnalysisEntry` | `leagues.ts` | Per-league data with user team info |
| `LeagueAnalysisSummary` | `leagues.ts` | Counts: total, active, finished, with teams |
| `EnrichedStat` | `stats.ts` | Raw stat + category metadata |
| `RawStat` | `stats.ts` | `{ stat_id, value }` |
| `EnrichedLeagueStatCategory` | `stats.ts` | League-specific category with `betterIs` |

## Full API Reference

### `stats.ts`

```typescript
getStatCategories(gameKey, userId?): Promise<StatCategory[]>
getStatCategoryMap(gameKey, userId?): Promise<Record<number, StatCategory>>
enrichStats(gameKey, stats, userId?): Promise<EnrichedStat[]>
getEnrichedLeagueStatCategories(userId, leagueKey): Promise<EnrichedLeagueStatCategory[]>
```

See [stats.md](./stats.md) for detailed usage and disambiguation patterns.

### `leagues.ts`

```typescript
getCurrentMLBGameKey(userId?): Promise<{ game_key, season, is_active }>
getUserLeagues(userId): Promise<League[]>
getLeagueTeams(userId, leagueKey): Promise<Team[]>
checkUserFantasyAccess(userId): Promise<{ hasAccess, error? }>
analyzeUserFantasyLeagues(userId, gameKeys?): Promise<Result<LeagueAnalysis>>
```

### `auth.ts`

```typescript
isTokenValid(userId): Promise<boolean>
refreshUserTokens(userId): Promise<boolean>
getUserFromRedis(userId): Promise<UserRecord | null>
getUserIdFromToken(accessToken): Promise<string | null>
```

### `cache.ts`

```typescript
withCache<T>(key, ttl, fetchFn): Promise<T>
cacheResult(key, result, ttl?): Promise<void>
getCachedResult<T>(key): Promise<T | null>
invalidateCache(key): Promise<void>
invalidateCachePattern(prefix): Promise<number>
CACHE_CATEGORIES  // { STATIC, SEMI_DYNAMIC, DYNAMIC } with ttl values and prefixes
```
