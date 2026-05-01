# Data Architecture

This is the canonical reference for how MLBoss fetches, models, and composes data. Read this before touching anything in `src/lib/fantasy/`, `src/lib/mlb/`, `src/lib/roster/`, `src/lib/pitching/`, or `src/lib/lineup/`.

The goal of this architecture is **flexibility without brittleness**: surface the insights the product needs (talent ratings, streaming verdicts, swap suggestions) without every change cascading into broken state somewhere else.

## The three-layer model

```
Page or Hook
  └── Compose layer    — view-shaped orchestration
        ├── Source layer  — I/O + cache + concurrency
        └── Model layer   — pure functions over typed entities
```

Hard rule (enforced by review):

- `model/` files must NOT import from `source/`. They are pure functions and live alongside their types.
- `source/` files must NOT import from `model/`. They fetch and parse, and that's it.
- Anything that needs both — fetch some data, then transform it — lives in `compose/` (or a per-domain orchestrator function).

This boundary is the structural fix for the "fix one thing, break another" pattern. Mixing fetching with modeling is what made the previous `getRosterSeasonStats` rewrite ship a partial cache that hid IL'd players for 10 minutes at a time.

### Folder layout

```
src/lib/fantasy/      — Yahoo-side source layer (mature, stable)
src/lib/mlb/
  ├── client.ts       — single fetch primitive (concurrency-bounded, retries)
  ├── identity.ts     — Yahoo to MLB identity service
  ├── source/         — I/O modules per resource (player stats, etc.)
  │   ├── playerStats.ts  — fetch* functions returning raw shapes
  │   └── index.ts        — barrel re-export
  ├── model/          — pure functions over raw shapes
  │   ├── playerStats.ts      — parsers + aggregators (parseSplitLine, aggregateLastN, etc.)
  │   ├── quality.ts          — classifyPitcherTier + tier constants
  │   ├── pitcherEnrichment.ts — applyPitcherStatsLine, applySavantSignals, etc.
  │   └── index.ts            — barrel re-export
  ├── players.ts      — orchestrator: identity + source + model + savant
  ├── schedule.ts     — orchestrator: schedule + pitcher enrichment
  ├── savant.ts       — Savant CSV ingest (source-flavoured)
  ├── teams.ts        — team aggregates (mixed; migration target)
  ├── talentModel.ts  — Bayesian talent component model (pure)
  └── types.ts        — canonical entity types
src/lib/roster/       — model layer for roster decisions
src/lib/pitching/     — model layer for pitcher decisions
src/lib/lineup/       — compose layer for lineup optimization
src/lib/hooks/        — client-side compose layer (SWR + page-shaped views)
```

### Worked example

`getRosterSeasonStats` in `src/lib/mlb/players.ts` is the canonical orchestrator:

```typescript
// players.ts (compose) imports from source AND model:
import { fetchStatSplitsForSeason } from './source';      // I/O
import { findGroup, parseSplitLine } from './model';      // pure
import { resolveMLBId } from './identity';

// Orchestrator: fetch raw -> hand to pure parser -> assemble entity
const raw = await fetchStatSplitsForSeason(mlbId, season);  // source
const seasonGroup = findGroup(raw, 'season');               // model
const line = parseSplitLine(seasonGroup[0].stat);           // model
```

Anti-pattern (do not do this):

```typescript
// model/playerStats.ts importing from source/ — the layer rule says no.
import { fetchStatSplitsForSeason } from '../source';   // FORBIDDEN
```

If a model-layer function needs data, the orchestrator passes it in. The model layer never reaches across the seam.

## The fetch + cache contract

### One primitive

All MLB Stats API requests go through one of two functions in [src/lib/mlb/client.ts](../src/lib/mlb/client.ts):

- `mlbFetch<T>(path, opts?)` — uncached. Use only when wrapping with `withCacheGated` yourself.
- `mlbFetchCached<T>(path, { cacheKey, ttl, retries? })` — cached. Use for any single-resource fetch.

Both apply the same machinery:

1. Acquire a slot from a per-host semaphore (`statsapi.mlb.com`: 8 in-flight, `baseballsavant.mlb.com`: 4) before issuing the network request
2. Auto-retry transient errors (network timeouts, ECONN*, 408/425/429/5xx) with exponential backoff (250ms initial, doubling, 2 retries by default)
3. Wrap `withCache` with the supplied `cacheKey` + `ttl` (cached variant only)
4. Return the parsed body or throw a normalized `MlbFetchError`
5. Log each failure with `[mlb-fetch] {host}{path} failed (attempt N/M)` so the dev log is greppable

Four group-flavoured helpers (`mlbFetchSchedule`, `mlbFetchSplits`, `mlbFetchIdentity`, `mlbFetchTeamStats`) are 1-line aliases over `mlbFetchCached` and remain the recommended entry points for their respective resource groups — they pre-namespace the cache key with both the tier and the group (`semi-dynamic:mlb:schedule:*`, `semi-dynamic:mlb:splits:*`, `static:mlb:identity:*`, `static:mlb:teamstats:*`) and fix the TTL for that resource class. If you ever call `mlbFetchCached` directly, supply a fully tier-prefixed `cacheKey` yourself — see *Tier discipline* below.

Savant CSV requests go through `externalFetchText(url, opts?)` in the same module; it shares the per-host limiter and retry policy.

### TTL tiers

All cache values live under Redis keys formatted as `cache:{tier}:{resource}:{identifier}`.

| Tier | TTL | Use case | Redis key pattern |
|------|-----|----------|-------------------|
| `STATIC` | 24-48 h | Game metadata, stat categories, Savant leaderboards | `cache:static:*` |
| `SEMI_DYNAMIC` | 5 min - 1 h | Leagues, teams, league settings, roster talent | `cache:semi-dynamic:*` |
| `DYNAMIC` | 30 s - 1 min | Scoreboards, live stats, transactions | `cache:dynamic:*` |

The `CACHE_CATEGORIES.{TIER}.prefix` constants are the *tier segment only*. `withCache` / `cacheResult` add the `cache:` namespace prefix automatically. When scanning Redis directly always use the full `cache:{tier}:*` pattern.

### Tier discipline (the rule)

**Every cache key written through `withCache` / `withCacheGated` / `cacheResult` must start with one of `static:`, `semi-dynamic:`, or `dynamic:`.** No exceptions. The tier prefix is not decoration — it's load-bearing for:

1. The `/admin/cache` panel's per-tier counts, byte totals, and "Clear *Tier*" buttons
2. The hit/miss/gate-reject counters in `getCacheStats()`, which bucket by leading prefix
3. `invalidateCachePattern('static:savant:')`-style sweeps from feature code
4. Future eviction policy or partial flushes — anything that wants to operate on "all stale-tolerant data" needs to find it by prefix

**Always build keys via the constants:**

```typescript
import { CACHE_CATEGORIES, withCache } from '@/lib/fantasy/cache';

return withCache(
  `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:fa-batters:${leagueKey}`,
  CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
  fetchFn,
);
```

Never hardcode `'semi-dynamic:'` and never write a key that starts with anything else (e.g. `mlb:` or the bare resource name). `cacheResult` logs `[cache] write to non-tier-prefixed key "…"` if you do — treat that warning as a build-blocking bug.

**Picking the tier — the rubric:**

| If the underlying data… | Use tier | Pick TTL |
|---|---|---|
| Is fixed for the season (game key, stat categories, roster positions, league limits) or recomputed nightly (Savant) | `STATIC` | `STATIC.ttl` (24 h) or `STATIC.ttlLong` (48 h) |
| Updates a few times per day (standings, league settings, schedule, splits, market signals, team season stats) | `SEMI_DYNAMIC` | `ttl` (5 m) / `ttlMedium` (10 m) / `ttlLong` (1 h) — pick the slowest the UX tolerates |
| Changes during live games or between requests (scoreboard, weekly team stats, roster, transactions) | `DYNAMIC` | `DYNAMIC.ttl` (1 m) — only loosen if the data really moves slower |

If the choice isn't obvious, **lean to the shorter TTL within the tier** rather than escalating to a higher tier — staleness in the wrong tier shows up as wrong-data bugs that are very hard to triage.

### Quality gate

Multi-fan-out fetchers (anything that calls `Promise.all` over a list of players, games, or pitchers) MUST use `withCacheGated` rather than raw `withCache`. The gate predicate decides whether the result is fit to cache.

```typescript
return withCacheGated(
  cacheKey,
  CACHE_CATEGORIES.SEMI_DYNAMIC.ttlMedium,
  fetchFn,
  result => Object.keys(result).length / players.length >= 0.7,
);
```

A run that fails to resolve at least 70% of its inputs is treated as a transient outage and not cached. The caller still receives the (degraded) result, but the next request retries instead of being stuck for the full TTL. The cache write skip is logged as `[cache] gate rejected result for key=…`. This is the structural fix for the "broken state persists" pattern.

Canonical examples (all multi-fanout, all gated):

- `getRosterSeasonStats` in [src/lib/mlb/players.ts](../src/lib/mlb/players.ts) — per-player stats fetch (70% coverage gate)
- `getAvailablePitchers` in [src/lib/fantasy/players.ts](../src/lib/fantasy/players.ts) — 4-way Yahoo fan-out across SP/RP × FA/W (≥50 merged pitchers)
- `getPlayerMarketSignals` in [src/lib/fantasy/players.ts](../src/lib/fantasy/players.ts) — per-key market signal fetch (70% coverage gate)

### Schema versioning

Cache keys carry an inline version segment (`roster-stats-v7`, `savant:pitchers:v2`) so a payload-shape change can be invalidated by bumping a number rather than by clearing Redis. Bump the version segment whenever you:

- Add or remove a field from the cached value
- Change the meaning of a field (e.g. raw vs. regressed)
- Change the cache key's input set

Old keys age out at their TTL.

### Invalidation

After mutations (roster moves, waiver claims), bust stale data:

```typescript
import { invalidateCache, invalidateCachePattern } from '@/lib/fantasy';

await invalidateCache('semi-dynamic:teams:458.l.12345');
await invalidateCachePattern('semi-dynamic:teams:458.l.12345');
```

`invalidateCachePattern` walks the keyspace via `SCAN` (not `KEYS`) so it stays safe as the cache grows; deletions happen in batches of 500. There is also `listCacheKeys(match)` exported from `@/lib/fantasy` for read-only key enumeration — use that from admin pages.

Never call `redis.flushdb()` — it wipes `user:*` and `token:*` keys alongside the cache, breaking all Yahoo API calls until the user re-logs in. The function is no longer exposed on `redisUtils`; call `invalidateCachePattern('static:')` (etc.) or use the `/admin/cache` page instead.

## Identity contract — Yahoo to MLB

The Yahoo to MLB join is the most fragile boundary in the system. It lives in [src/lib/mlb/identity.ts](../src/lib/mlb/identity.ts) — the only file allowed to do this resolution. Other modules (player stats, schedule enrichment, etc.) import `resolveMLBId` from here.

### Resolution order

1. `/people/search?names={fullName}` — returns one or more candidates
2. Filter to `active !== false` (fall back to all if none active)
3. Hydrate each remaining candidate via `/people/{id}?hydrate=currentTeam` (cached 24 h)
4. Match `currentTeam.id` against the supplied Yahoo team abbreviation, mapped through the small `YAHOO_TO_MLB_ABBR` alias table (`WAS` → `WSH`, `CHW` → `CWS`, etc.)
5. Fall back to the first active candidate if no team match (recorded as `team-mismatch-fallback`)

### Failure semantics

- `resolveMLBId` returns `null` on any failure rather than throwing. Callers are expected to skip the player and continue processing the rest of the batch.
- Every outcome is recorded against an in-process counter as one of:
  `hit | no-search-results | no-active-candidates | hydrate-empty | team-mismatch-fallback | fetch-error`.
- Misses are logged as `[identity] resolve missed: name="…" team="…" reason=… candidates=N` so the dev log can be `grep`d for fragile joins.

### Observability

- `getIdentityResolutionMetrics()` returns a snapshot of `{ total, hits, misses, byReason, recentMisses[] }`.
- `resetIdentityResolutionMetrics()` clears the counters (used to take a fresh sample before reproducing a bug).
- Both surface in `/admin/debug` via the **Identity Resolution** panel.

Cache key shape: `cache:static:mlb:identity:resolve-v2:{lowercased-name}:{lowercased-team}`. Bump the `-vN` suffix whenever the resolution rules change.

## One source of truth per concept

Each scoring concept must have exactly one canonical implementation. When we have N implementations of "how good is this pitcher?" they drift, and the same pitcher gets different verdicts on different pages. This is what's currently true:

| Concept | Canonical location |
|---------|-------------------|
| Bayesian rate blender | `blendRate` (returns `BlendOutput`) and `blendRateOrNull` (returns `number | null` for Savant secondaries) in [src/lib/mlb/talentModel.ts](../src/lib/mlb/talentModel.ts) |
| Component talent xwOBA | `computeBatterTalentXwoba` / `computePitcherTalentXwobaAllowed` (talentModel.ts) |
| Per-category baseline | `blendedBaselineForCategory` in [src/lib/mlb/categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts) |
| Pitcher talent score | `pitcherTalentScore` in [src/lib/pitching/quality.ts](../src/lib/pitching/quality.ts) |
| Batter rating | `getBatterRating` in [src/lib/mlb/batterRating.ts](../src/lib/mlb/batterRating.ts) |
| Pitcher streaming rating | `getPitcherRating` in [src/lib/pitching/scoring.ts](../src/lib/pitching/scoring.ts) |

Adding a second function that does any of the above — even "just slightly different for this one page" — is forbidden. Add a parameter, return a richer shape, or add a wrapper over the canonical function.

Historical violations and their resolution:

- ~~`blendSavant` in src/lib/mlb/savant.ts duplicates `blendRate`~~ — **resolved** by introducing `blendRateOrNull` and migrating callers (Phase 4b).
- ~~`resolveTalent` in `pitching/scoring.ts` duplicates `pitcherTalentScore`~~ — **resolved** in Phase 4c by promoting `pitcherTalentScore` to be the canonical RV/100 → xwOBA → tier → neutral resolver. `resolveTalent` is now a thin file-local projection that exists only so the streaming module's existing `ResolvedTalent` shape keeps compiling — it adds no behaviour.

## Yahoo fantasy layer

The Yahoo half of the source layer is mature and stable. Modules live under `src/lib/fantasy/`:

```
src/lib/fantasy/
├── cache.ts         — withCache, withCacheGated, listCacheKeys, TTL tiers, SCAN-backed invalidation
├── auth.ts          — token validation and refresh via Redis
├── stats.ts         — stat categories, enrichment, league-specific categories
├── leagues.ts       — league/team discovery, user team identification
├── standings.ts     — league standings (ranks, records, points)
├── matchups.ts      — scoreboard (weekly matchup scores) and team schedule
├── teamStats.ts     — team stats (season-to-date and weekly)
├── roster.ts        — team roster (players, positions, injury status)
├── players.ts       — available players (free agents + waivers) by position
├── transactions.ts  — league transactions (adds, drops, trades)
└── index.ts         — barrel re-exports (import everything from @/lib/fantasy)
```

Consumer code imports from `@/lib/fantasy`, never from the raw client directly.

### Error handling

Functions that can fail in expected ways return a discriminated union instead of throwing or returning `null`:

```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
```

Functions that fetch a single cacheable resource (like `getStatCategories`) throw on failure — they have no meaningful partial-success case. `Result<T>` is used where an operation has multiple steps that can individually fail (like analyzing leagues).

### Token management

`YahooFantasyAPI` handles token refresh internally with a 5-minute buffer before expiry. The data layer does NOT pre-validate tokens before API calls — this avoids redundant Redis round-trips.

User auth data (`user:{id}` hash and `token:{accessToken}` lookup) is stored in Redis as a backup, but the iron-session cookie is the source of truth. If Redis is cleared, `getValidAccessToken` falls back to the session cookie automatically — no re-login required.

Token refresh is wrapped in a Redis `MULTI` so the user-hash field updates, the 7-day hash TTL re-up, the stale `token:{old}` deletion, and the new `token:{new}` write all land atomically. Concurrent requests cannot observe partial state mid-rotation. The OAuth callback uses the same MULTI shape on initial login. See [src/lib/fantasy/auth.ts](../src/lib/fantasy/auth.ts) `refreshUserTokens` and [src/lib/yahoo-fantasy-api.ts](../src/lib/yahoo-fantasy-api.ts) `getValidAccessToken`.

`auth.ts` provides utilities for pages that need to check or display token status:

| Function | Purpose |
|----------|---------|
| `isTokenValid(userId)` | Check if token is expired (Redis lookup) |
| `refreshUserTokens(userId)` | Force a token refresh |
| `getUserFromRedis(userId)` | Get full user record from Redis |
| `getUserIdFromToken(token)` | Reverse lookup: token to userId |

### Yahoo source API reference

```typescript
// stats.ts
getStatCategories(gameKey, userId?): Promise<StatCategory[]>
getStatCategoryMap(gameKey, userId?): Promise<Record<number, StatCategory>>
enrichStats(gameKey, stats, userId?): Promise<EnrichedStat[]>
getEnrichedLeagueStatCategories(userId, leagueKey): Promise<EnrichedLeagueStatCategory[]>

// leagues.ts
getCurrentMLBGameKey(userId?): Promise<{ game_key, season, is_active }>
getUserLeagues(userId): Promise<League[]>
getLeagueTeams(userId, leagueKey): Promise<Team[]>
checkUserFantasyAccess(userId): Promise<{ hasAccess, error? }>
analyzeUserFantasyLeagues(userId, gameKeys?): Promise<Result<LeagueAnalysis>>

// players.ts
getAvailablePitchers(userId, leagueKey): Promise<FreeAgentPlayer[]>
getAvailableBatters(userId, leagueKey): Promise<FreeAgentPlayer[]>
getTopAvailableBatters(userId, leagueKey): Promise<FreeAgentPlayer[]>
getPlayerMarketSignals(userId, playerKeys): Promise<Record<string, PlayerMarketSignals>>

// standings.ts
getLeagueStandings(userId, leagueKey): Promise<StandingsEntry[]>

// matchups.ts
getLeagueScoreboard(userId, leagueKey, week?): Promise<MatchupData[]>
getTeamMatchups(userId, teamKey, weeks?): Promise<MatchupData[]>

// teamStats.ts
getTeamStatsSeason(userId, teamKey): Promise<TeamStats>
getTeamStatsWeek(userId, teamKey, week): Promise<TeamStats>

// roster.ts
getTeamRoster(userId, teamKey): Promise<RosterEntry[]>
getTeamRosterByDate(userId, teamKey, date): Promise<RosterEntry[]>

// transactions.ts
getLeagueTransactions(userId, leagueKey, type?): Promise<TransactionEntry[]>

// cache.ts
withCache<T>(key, ttl, fetchFn): Promise<T>
withCacheGated<T>(key, ttl, fetchFn, isAcceptable): Promise<T>
cacheResult(key, result, ttl?): Promise<void>
getCachedResult<T>(key): Promise<T | null>
invalidateCache(key): Promise<void>
invalidateCachePattern(prefix): Promise<number>
```

For per-stat conventions (which fields are regressed vs raw, which constants are calibration knobs, the four stat levels) see [scoring-conventions.md](./scoring-conventions.md).

## Common gotchas

- **Dev server must run on port 3000.** The Cloudflare tunnel maps `mlboss-dev.skibri.us` to `localhost:3000` for HTTPS (Yahoo OAuth requires it).
- **Yahoo rate limit ~60-100 req/hr.** Lean hard on tiered caching; never bypass it for "just one quick check".
- **Yahoo JSON has numeric keys.** XML is sometimes more reliable for nested structures.
- **`hydrate=currentTeam` omits `abbreviation`.** Always match same-name MLB players (the two Max Muncys, etc.) on `currentTeam.id`, not on the abbreviation string.
- **Per-host concurrency is low (~8).** Don't fan out unbounded `Promise.all` over hundreds of player IDs — `mlbFetch` will queue them, but request bursts can still time out individual entries. Use `withCacheGated` so partial outages don't poison the cache.

### Migration-era gotchas (Phase 4 learnings)

- **`PlayerStatLine` is the page-facing shape; the internal scoring engines still operate on `BatterSeasonStats`.** The polymorphic `asBatterStats` shim inside `getBatterRating` and `roster/scoring.ts` transparently adapts either input via `toBatterSeasonStats(line)`. The plan called for deleting `toBatterSeasonStats` entirely once Phase 4a shipped, but that would have required rewriting the per-category baseline pipeline and the analysis-layer `getPlatoonAdjustedTalent` helper without changing behaviour. We kept the adapter as an internal-only migration shim instead and treated "no consumer code references the legacy shape" as the practical exit criterion.
- **`PlayerStatLine` blocks are independently nullable.** A freshly-called-up rookie has `current` only, an IL'd vet has `prior` only, and a pre-debut promotion has neither. UI code that reads `line.current?.ops` should fall back to `line.prior?.ops` so IL players still render a row instead of disappearing.
- **`blendRateOrNull` is the successor to the legacy `blendSavant`.** It mirrors the "all-empty returns null" semantics that Savant secondaries (xERA, RV/100, wOBA-on-contact) need. Pass `leagueMean: 0, leaguePriorN: 0` when no league anchor exists, or a real league mean + a positive `leaguePriorN` when the consumer wants regression toward the population.
- **The pitcher-talent resolver is now in one place.** `pitcherTalentScore` (`src/lib/pitching/quality.ts`) owns the RV/100 → xwOBA-a → tier → neutral order. The streaming module's file-local `resolveTalent` is a no-op shim — don't re-implement RV/100 logic there or anywhere else.
- **Don't import `model/` from `source/` or vice versa.** This rule isn't enforced by a lint rule; it's enforced by code review. If you find yourself reaching across the line, the helper probably belongs in `compose/` (the orchestrator file).
- **`withCacheGated` predicates are silent on success and noisy on failure.** When a coverage check fails, the helper logs `[cache-gated] rejected …` and returns the result without writing. If you see this log fire repeatedly for the same key, the upstream API is degraded — don't loosen the predicate to "make it cache" without diagnosing why coverage is bad.
