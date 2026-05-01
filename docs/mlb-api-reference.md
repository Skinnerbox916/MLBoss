# MLB Stats API Reference

The MLB Stats API (`https://statsapi.mlb.com/api/v1`) is the public, unauthenticated data source MLBoss uses for everything the Yahoo Fantasy API can't give us: probable pitchers, player stats, handedness splits, team offense profiles, venues, weather, and player identity.

All MLBoss access goes through `src/lib/mlb/` — consumers should never hit `statsapi.mlb.com` directly.

➜ Data layer: [data-architecture.md](data-architecture.md) | Streaming page: [streaming-page.md](streaming-page.md)

## Module Structure

```
src/lib/mlb/
├── client.ts      — Base fetcher + three cached wrappers (schedule/splits/identity)
├── schedule.ts    — getGameDay, getTeamGame (probable pitchers + venue + weather)
├── players.ts     — resolveMLBId, getBatterSplits, getPitcherQuality, fetchPitcherFullLine
├── teams.ts       — getTeamOffense (season totals + vs-LHP/RHP splits)
├── analysis.ts    — Verdict helpers (handedness, venue, day/night, park, form, weather)
├── parks.ts       — Static park factors keyed by venue ID
├── types.ts       — Shared TypeScript types
└── index.ts       — Barrel re-exports
```

## Client Layer — Cached Fetchers

`client.ts` exposes three wrappers over `withCache`. Pick by **how fast the data actually changes**, not by endpoint.

| Fetcher | TTL | Redis key prefix | Use for |
|---------|-----|------------------|---------|
| `mlbFetchSchedule` | 5 min (`SEMI_DYNAMIC.ttl`) | `mlb:schedule:*` | `/schedule` calls — probable pitchers get confirmed throughout the day |
| `mlbFetchSplits` | 1 h (`SEMI_DYNAMIC.ttlLong`) | `mlb:splits:*` | `/people/{id}/stats`, `/teams/{id}/stats` — splits update daily at most |
| `mlbFetchIdentity` | 24 h (`STATIC.ttl`) | `mlb:identity:*` | `/people/search`, `/people/{id}?hydrate=currentTeam` — IDs never change |

All three wrap `mlbFetch<T>(path)`, which is a plain `fetch` with `next: { revalidate: 0 }` — we deliberately bypass Next.js's fetch cache because Redis is the source of truth and we need explicit TTL control.

## Hydrate Parameters

The `/schedule` endpoint returns a skeletal payload by default — teams, times, final scores. Everything MLBoss needs (probable pitchers, venue, weather) must be requested via `hydrate=`.

`getGameDay` uses:

```
hydrate=probablePitcher(note,stats(type=season,group=pitching)),venue,weather,team
```

Breakdown:

- **`probablePitcher(note,stats(type=season,group=pitching))`** — pulls the probable pitcher's current-season pitching line (ERA, WHIP, K/9, GS, IP, W/L) inline with the schedule response, avoiding a per-pitcher `/people/{id}/stats` round-trip on the happy path. The nested `stats(type=season,group=pitching)` is required — omitting it returns just the player record with no stats.
- **`venue`** — gives us `venue.id`, which keys into `src/lib/mlb/parks.ts` for park factors.
- **`weather`** — exposes `teams.home.probablePitcher` peers (`raw.weather`) with `temp`, `condition`, `wind`. **Gotcha:** weather is only populated ~2 hours before first pitch. For tomorrow's games, all three fields are null. See "Weather availability" below.
- **`team`** — fleshes out team records beyond bare IDs.

Hydrate parameters compose with commas; nested parens scope sub-hydrates. **Always URL-encode the full hydrate string** (schedule.ts uses `encodeURIComponent`).

## Stats Endpoint — `/people/{id}/stats`

The player stats endpoint is parameterized by two axes that control what you get back:

| Param | Values used | Effect |
|-------|-------------|--------|
| `stats` | `season`, `statSplits`, `lastXGames`, `vsPlayer` | Chooses the response group(s) |
| `group` | `hitting`, `pitching` | Picks which side's stats to return |
| `season` | e.g. `2026` | Scopes to a specific year |
| `gameType` | `R` (regular) | Excludes spring training, playoffs |
| `sitCodes` | `vl,vr,h,a,d,n` | Split filters (statSplits only) |
| `numberOfGames` | e.g. `14` | Window size (lastXGames only) |
| `opposingPlayerId` | MLB ID | Hitter vs. specific pitcher (vsPlayer only) |

Multiple `stats` values can be combined in one call: `stats=statSplits,season` returns both groups in a single response under `stats[]`, distinguished by `stats[n].type.displayName`.

### Split codes (`sitCodes`)

Passed alongside `stats=statSplits`. MLBoss uses:

| Code | Meaning |
|------|---------|
| `vl` | vs. LHP |
| `vr` | vs. RHP |
| `h`  | Home |
| `a`  | Away |
| `d`  | Day games |
| `n`  | Night games |

Splits for a batter vs. LHP + RHP + home/away/day/night come in one call:
```
/people/{id}/stats?stats=statSplits,season&group=hitting&season=2026&sitCodes=vl,vr,h,a,d,n&gameType=R
```

### Parsing the response

Responses always take this shape:

```json
{
  "stats": [
    { "type": { "displayName": "statSplits" }, "splits": [ { "split": { "code": "vl", ... }, "stat": { ... } }, ... ] },
    { "type": { "displayName": "season" },     "splits": [ { "stat": { ... } } ] }
  ]
}
```

`players.ts` uses two helpers:

- `findGroup(resp, 'statSplits')` — pulls the splits array for a given type
- `findByCode(splits, 'vl')` — pulls the stat line for a specific split code

Numeric stat fields are returned as **strings** in JSON (`"avg": "0.275"`) and must be parsed with the `n()` helper (`parseFloat`, null-safe).

## Early-Season Stats Gap

Two related gotchas that both manifest in the first few weeks of a season:

### 1. Schedule hydration returns no stats

When the season is young, `hydrate=probablePitcher(...stats...)` sometimes returns the pitcher record with `stats: []` or missing fields. The pitcher has thrown real innings but the hydrate pipeline hasn't caught up.

**Mitigation:** `getGameDay` in `schedule.ts` back-fills with a second call:

```typescript
const enrichPitcher = async (p: ProbablePitcher) => {
  const [quality, line] = await Promise.all([
    getPitcherQuality(p.mlbId),
    p.era === null ? fetchPitcherFullLine(p.mlbId) : Promise.resolve(null),
  ]);
  // ... merges `line` into `p` for any null fields
};
```

`fetchPitcherFullLine` (in `players.ts`) tries the current season first, then falls back to the prior season if current IP is 0.

### 2. Current-season sample too thin for tiering

`getPitcherQuality` gates on **IP ≥ 25** before classifying a pitcher by their current line. Below that, it falls back to the prior season (gated on **IP ≥ 60**). Below both gates, the pitcher is tagged `tier: 'unknown'` and the UI omits the quality pill.

The same pattern applies to batters: `getBatterSplits` swaps the splits source to the prior season when current PA < 30, but always preserves the **current calendar year line** as `currentSeason` so the UI can still show "how this player is hitting THIS year" prominently (via the `RawStat` parsed line on the root response).

Recent-form windows (`last7`, `last14`, `last30`) always use the current season — stale form data would be worse than no form data.

## Same-Name Disambiguation

MLB has had multiple active same-name players (the canonical example: the two Max Muncys — 571970 on LAD and 691777 on ATH). `/people/search?names=Max%20Muncy` returns both, **without team info**.

`resolveMLBId` (in `players.ts`) disambiguates in this order:

1. Search: `/people/search?names={encoded}&sportIds=1`
2. Filter to `active !== false` candidates
3. **Hydrate every surviving candidate in parallel** via `/people/{id}?hydrate=currentTeam` — this is the only way to get the `currentTeam.abbreviation` needed to match
4. Pick the candidate whose team matches the supplied `teamAbbr`
5. Fall back to the first active candidate if no team match

The second round-trip is unavoidable: the search endpoint doesn't surface team data. Both calls go through `mlbFetchIdentity` (24-hour TTL), so disambiguation happens once per player per day.

## Team Abbreviation Drift

MLB and Yahoo don't always agree on team abbreviations, and MLB's own API uses different ones in different contexts. The abbreviations that need aliasing:

| Canonical | Aliases seen |
|-----------|--------------|
| AZ | ARI |
| CHW | CWS |
| WSH | WAS |
| KC | KCR |
| SD | SDP |
| SF | SFG |
| TB | TBR |
| ATH | OAK (legacy) |

The matching code in `PitchingManager.tsx` (`TEAM_ABBR_ALIASES` + `normalizeTeamAbbr`) handles this when cross-referencing Yahoo free-agent teams against MLB probable-pitcher teams.

## Weather Availability

The `weather` hydrate returns `{ temp, condition, wind }` — but **only when the game is imminent**. Empirically:

- **Today's games (pre-first-pitch, same day):** usually populated
- **Tomorrow's games:** all three fields null
- **Games in progress or final:** populated (last snapshot)

This matters on the Pitching page's Tomorrow tab — every card would otherwise show a placeholder cloud icon. `PitchingManager.tsx` gates the weather block on a `hasWeatherData()` check that requires at least one of temp/condition/wind to be non-null.

`parseWind` in `schedule.ts` parses the MLB API's string format (`"12 mph, Out To CF"` or `"Calm"`) into `{ speed, direction }`. Note the field is `temp` in the raw response, not `temperature` — the parser renames it.

## Pitcher Tier Classification

`classifyPitcherTier(era, whip)` in `players.ts`:

| Tier | Condition |
|------|-----------|
| `ace` | ERA ≤ 2.75 AND WHIP ≤ 1.05 |
| `tough` | ERA ≤ 3.50 AND WHIP ≤ 1.20 |
| `bad` | ERA ≥ 5.00 AND WHIP ≥ 1.45 |
| `weak` | ERA ≥ 4.25 OR WHIP ≥ 1.36 |
| `average` | everything in between |
| `unknown` | either stat is null |

Tiers drive both the batter-row "Facing Ace" / "Weak SP" pills (via `getPitcherQualityPill` in `analysis.ts`) and the streaming board's row tint and composite scoring (see [streaming-page.md](streaming-page.md)).

## Park Factors

`src/lib/mlb/parks.ts` holds static per-venue park data keyed by `mlbVenueId`, which matches the `venue.id` returned by the `/schedule` hydrate. Park factors (parkFactor, parkFactorL, parkFactorR, parkFactorHR) are sourced from Baseball Savant's Statcast 3-year rolling window.

`getParkByVenueId(id)` is the lookup helper. `analysis.ts` uses handedness-aware thresholds (`parkFactor ≥ 108` = extreme hitter, `≤ 92` = extreme pitcher) so only true outliers (Coors, Fenway for LHB, T-Mobile for RHB) surface as pills.

## Full Function Reference

### `client.ts`

```typescript
mlbFetch<T>(path): Promise<T>                         // Uncached
mlbFetchSchedule<T>(path, cacheKey): Promise<T>       // 5 min
mlbFetchSplits<T>(path, cacheKey): Promise<T>         // 1 hour
mlbFetchIdentity<T>(path, cacheKey): Promise<T>       // 24 hours
```

### `schedule.ts`

```typescript
getGameDay(date): Promise<MLBGame[]>                  // All games on YYYY-MM-DD
getTeamGame(teamAbbr, date): Promise<MLBGame | null>  // One team's game
```

### `players.ts`

```typescript
resolveMLBId(fullName, teamAbbr?): Promise<MLBPlayerIdentity | null>
getBatterSplits(mlbId, season?): Promise<BatterSplits | null>
getPitcherQuality(mlbId, season?): Promise<PitcherQuality>
fetchPitcherFullLine(mlbId, season?): Promise<PitcherSeasonLine | null>
getCareerVsPitcher(batterId, pitcherId): Promise<SplitLine | null>
```

### `teams.ts`

```typescript
getTeamOffense(mlbTeamId, season?): Promise<TeamOffense | null>
```

Returns season batting totals plus vs-LHP / vs-RHP splits. Used by the pitching streaming board to grade opponent strength and by the lineup page to surface team offense context.

### `analysis.ts`

```typescript
resolveMatchup(games, park, teamAbbr): MatchupContext | null
getHandednessSplit(splits, pitcherThrows): { split, label }
getHandednessVerdict(splits, pitcherThrows): VerdictLabel
getVenueVerdict(splits, isHome): VerdictLabel
getDayNightVerdict(splits, gameDateIso): VerdictLabel
getParkVerdict(park, bats): { verdict, label } | null
getPitcherQualityPill(pitcher): { verdict, label } | null
getFormTrend(splits): FormLabel
getWeatherFlag(game, park): WeatherFlag
```

All verdict helpers return `{ verdict: 'strong' | 'neutral' | 'weak' | 'unknown', label, detail? }` and are the source of the batter-row pills in `PlayerRow.tsx`.
