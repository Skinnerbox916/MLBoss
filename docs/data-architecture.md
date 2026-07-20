## Data Architecture

The reference for how MLBoss fetches, models, and composes data. Read this before touching anything in `src/lib/fantasy/`, `src/lib/mlb/`, `src/lib/roster/`, `src/lib/pitching/`, or `src/lib/lineup/`. This doc covers the **data layer** — for the engines that consume the data, see [engines.md](./engines.md).

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
  │   ├── playerStats.ts      — parsers + aggregators (parseSplitLine, aggregateLastN, parsePitcherAppearances, etc.)
  │   ├── pitcherEnrichment.ts — applyPitcherStatsLine, applySavantSignals, etc.
  │   └── index.ts            — barrel re-export
  ├── players.ts      — orchestrator: identity + source + model + savant
  ├── schedule.ts     — orchestrator: schedule + pitcher enrichment
  ├── savant.ts       — Savant CSV ingest (source-flavoured)
  ├── teams.ts        — team aggregates (mixed; migration target)
  ├── talentModel.ts  — Bayesian talent component model (pure)
  └── types.ts        — canonical entity types
src/lib/roster/       — model layer for roster decisions
src/lib/pitching/     — three-layer pitcher evaluation engine
  ├── talent.ts       — Layer 1: context-free PitcherTalent vector (per-PA outcomes, velocity, regime-shift-aware prior, confidence)
  ├── forecast.ts     — Layer 2: GameForecast (talent + opp/park/weather → expectedPerPA, expectedPerGame, P(QS), P(W))
  ├── rating.ts       — Layer 3: PitcherRating (forecast → 0-100 score, score-derived tier, focus-weighted contributions)
  ├── scoring.ts      — public API consumed by UI (composes forecast + rating; named to match the original site of the legacy shim)
  └── display.tsx     — UI helpers (tier color, weather icon, pill summary, etc.)
src/lib/projection/   — forward projection engines (batter + pitcher)
  ├── batterTeam.ts   — projectBatterPlayer / projectBatterTeam (per-PA × PA aggregation across the matchup week)
  ├── pitcherTeam.ts  — projectPitcherPlayer / projectPitcherTeam (per-start aggregation; shares PerCategoryProjection shape)
  └── slotAware.ts    — batter-only: per-day assignStarters with/without each FA → streaming value
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

## The three storage legs

| Leg | Store | Holds | Contract |
|---|---|---|---|
| **Cache + sessions** | Redis (`cache:*`, `user:*`, `token:*`) | Anything rebuildable from upstream APIs | Tiered TTLs via `withCache` (below); safe to flush by tier |
| **Observations** | Redis (`obs:*`) | Small witnessed signals that decay to "no signal" | See [Observation stores](#observation-stores) |
| **Durable ledger** | Postgres (Drizzle, `src/lib/db/`) | What can't be refetched and must accumulate: users + roles, per-user preferences, forecast snapshots + graded actuals | Migrations via `npm run db:generate` / `db:migrate`; schema is user-scoped (multi-tenant) from day one |

Rule of thumb: if losing it means waiting for the world to repeat itself, it's ledger (or an `obs:` key when it's a small decaying signal); if you can refetch it, it's cache. Feature code never talks to `pg` directly — go through the modules in `src/lib/db/` (users, prefs) and `src/lib/ledger/` (forecast verification, see [forecast-verification.md](./forecast-verification.md)).

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

Two rules learned the hard way (2026-07 all-star week, see [history.md](./history.md)):

- **"Empty" is not "failed."** A gate like `result.length > 0` turns a legitimately-empty result (a no-game date, an empty waiver pool) into a permanent cache miss that rebuilds on every request. Make failure paths *throw* (nothing caches, next request retries) and let valid-but-empty results cache. `getGameDay` is the cautionary tale: it used this gate and rebuilt the all-star break's empty slates on every points/lineup/streaming request.
- **Every input must be able to succeed.** A coverage-ratio gate is only meaningful if 100% coverage is achievable. Sending pitchers into the hitting-only `getRosterSeasonStats` capped coverage at ~50%, so the gate rejected every run and the batch refetched forever. Filter inputs to what the fetcher can actually resolve (the caller owns this — the `{name, team}` input shape carries no position info).

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

### Observation stores

Some Redis data is **observed, not fetched** — recorded from something we witnessed (a posted lineup card) that no upstream API can re-serve after the fact. Deleting an observation loses it until the world happens to repeat itself. That makes it categorically not cache, so:

- Observation keys live under the **`obs:` namespace**, outside `cache:*`, where the `/admin/cache` tier-clear and Clear All buttons cannot reach them.
- They are written via `redisUtils` directly from a dedicated store module — the one sanctioned exception to "all Redis writes go through `withCache`/`cacheResult`", because those helpers force the `cache:` prefix.
- They still carry a TTL when going stale is the desired behavior (decay to "no signal"), chosen by the store, not by the cache tiers.

Current stores: `obs:batter-lineup-spot:{mlbId}` in [src/lib/mlb/lineupSpots.ts](../src/lib/mlb/lineupSpots.ts) — last-observed batting-order slot per batter, 7-day decay, feeds the future-day opportunity multiplier. Before adding a second store, confirm the data truly can't be refetched; "expensive to refetch" is a cache-tier problem, not an observation. Observations that must accumulate forever rather than decay (forecast snapshots) belong in the Postgres ledger instead — see [The three storage legs](#the-three-storage-legs).

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
- On success, `bats` and `throws` are `'L' | 'R' | 'S' | null` — `null` when the MLB record carried no `batSide`/`pitchHand`. **Never default these to `'R'`.** Unknown handedness must propagate as `null`; the platoon, park, SB, and opponent-multiplier paths all treat `null` as neutral. Defaulting to `'R'` is a confident-wrong guess that silently mis-platoons half the league (see [history.md](./history.md) "Handedness is honestly nullable").
- Every outcome is recorded against an in-process counter as one of:
  `hit | no-search-results | no-active-candidates | hydrate-empty | team-mismatch-fallback | fetch-error`.
- Misses are logged as `[identity] resolve missed: name="…" team="…" reason=… candidates=N` so the dev log can be `grep`d for fragile joins.

### Observability

- `getIdentityResolutionMetrics()` returns a snapshot of `{ total, hits, misses, byReason, recentMisses[] }`.
- `resetIdentityResolutionMetrics()` clears the counters (used to take a fresh sample before reproducing a bug).
- Both surface in `/admin/debug` via the **Identity Resolution** panel.

Cache key shape: `cache:static:mlb:identity:resolve-v2:{lowercased-name}:{lowercased-team}`. Bump the `-vN` suffix whenever the resolution rules change.

## Canonical implementations

For the registry of all engines and where they live, see [engines.md](./engines.md). For the rule that prohibits second implementations, see [architecture.md](./architecture.md#2-single-source-of-truth-per-concept). Two specific entries that fit naturally with the data-layer concerns:

| Concept | Canonical location |
|---------|-------------------|
| Bayesian rate blender | `blendRate` (returns `BlendOutput`) and `blendRateOrNull` (returns `number | null` for Savant secondaries) in [src/lib/mlb/talentModel.ts](../src/lib/mlb/talentModel.ts) |
| Team-abbreviation canonicalization (Yahoo / MLB / ESPN) | `normalizeTeamAbbr` in [src/lib/mlb/teamAbbr.ts](../src/lib/mlb/teamAbbr.ts) — single alias table for every cross-source matcher |

For forward projection engines (`projectBatterPlayer` / `projectBatterTeam` / `projectPitcherPlayer` / `projectPitcherTeam` / slot-aware streaming / lineup optimization), see [projection.md](./projection.md).

## Yahoo fantasy layer

The Yahoo half of the source layer is mature and stable. Modules live under `src/lib/fantasy/`:

```
src/lib/fantasy/
├── cache.ts         — withCache, withCacheGated, listCacheKeys, TTL tiers, SCAN-backed invalidation
├── auth.ts          — token validation and refresh via Redis
├── stats.ts         — stat categories, enrichment, league-specific categories
├── leagues.ts       — league/team discovery, user team identification
├── gameWeeks.ts     — matchup-week calendar (game_weeks), WeekBounds resolution
├── standings.ts     — league standings (ranks, records, points)
├── matchups.ts      — scoreboard (weekly matchup scores) and team schedule
├── teamStats.ts     — team stats (season-to-date and weekly)
├── roster.ts        — team roster (players, positions, injury status)
├── players.ts       — available players (free agents + waivers) by position
├── transactions.ts  — league transactions (adds, drops, trades)
└── index.ts         — barrel re-exports (import everything from @/lib/fantasy)
```

Consumer code imports from `@/lib/fantasy`, never from the raw client directly.

### Matchup-week calendar

Yahoo matchup weeks are **usually Mon–Sun but not always**: week 1 is short (2026: Mar 25–29) and the all-star break is one combined ~14-day matchup week (2026 week 17: Jul 13–26). The authoritative per-week date ranges come from Yahoo's `game_weeks` resource, fetched once per season into `static:game-weeks:{gameKey}` ([gameWeeks.ts](../src/lib/fantasy/gameWeeks.ts), coverage-gated so an empty parse isn't pinned).

The unit that flows everywhere is a `WeekBounds` — the current week's real `start`/`end` plus the next week's (`nextStart`/`nextEnd`, **null on the season's final week**). One resolver, two transports:

- **Server**: `getWeekBounds(userId, leagueKey)` (league's `current_week` × the calendar) — route handlers pass it into the `weekRange` helpers and fold `weekBounds.end` into their cache keys so windows roll when the calendar resolves.
- **Client**: `/api/fantasy/context` ships `week_start`/`week_end`/`next_week_start`/`next_week_end` per league; `useLeagueWeekBounds(leagueKey)` / `useActiveLeague().weekBounds` build the (memoized) bounds object.

Every helper in [dashboard/weekRange.ts](../src/lib/dashboard/weekRange.ts) accepts optional bounds and **falls back to the legacy local Mon–Sun derivation without them** — first paint and calendar-fetch failures degrade gracefully rather than break. Scoreboard matchups also carry `week_start`/`week_end` per matchup (parsed into `MatchupData`). Nothing downstream may assume 7-day weeks; see [history.md](./history.md#2026-07--local-monsun-week-math-replaced-by-yahoos-game_weeks-calendar).

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

For per-stat level discipline (raw counting / raw rate / regressed talent / matchup-adjusted) see [stat-levels.md](./stat-levels.md). For cross-engine calibration constants see [league-baselines.md](./league-baselines.md).

## Common gotchas

- **Dev server must run on port 3000.** The Cloudflare tunnel maps `mlboss-dev.skibri.us` to `localhost:3000` for HTTPS (Yahoo OAuth requires it).
- **Yahoo rate limit ~60-100 req/hr.** Lean hard on tiered caching; never bypass it for "just one quick check".
- **Yahoo JSON has numeric keys.** XML is sometimes more reliable for nested structures.
- **`position_types` from Yahoo JSON is unreliable.** The field can be absent, a plain string (`"B"`), a nested object (`{"position_type":"B"}`), or a numeric-key object (`{"position_type":{"0":"B","count":1}}`). Always parse it through `normalizePositionTypes()` in `yahoo-fantasy-api.ts`. `getEnrichedLeagueStatCategories` falls back to `COMMON_MLB_STATS` (`src/constants/statCategories.ts`) as a last resort.
- **`hydrate=currentTeam` omits `abbreviation`.** Always match same-name MLB players (the two Max Muncys, etc.) on `currentTeam.id`, not on the abbreviation string.
- **Per-host concurrency is low (~8).** Don't fan out unbounded `Promise.all` over hundreds of player IDs — `mlbFetch` will queue them, but request bursts can still time out individual entries. Use `withCacheGated` so partial outages don't poison the cache.

### Live discipline rules

- **Don't import `model/` from `source/` or vice versa.** This rule isn't enforced by a lint rule; it's enforced by code review. If you find yourself reaching across the line, the helper probably belongs in `compose/` (the orchestrator file).
- **`withCacheGated` predicates are silent on success and noisy on failure.** When a coverage check fails, the helper logs `[cache-gated] rejected …` and returns the result without writing. If you see this log fire repeatedly for the same key, the upstream API is degraded — don't loosen the predicate to "make it cache" without diagnosing why coverage is bad.

For migration history (Phase 4 `PlayerStatLine` adapter, `blendSavant` → `blendRateOrNull`, pitcher-evaluation rebuild), see [history.md](./history.md).
