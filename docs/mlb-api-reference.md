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

**Mitigation:** `getGameDay` in `schedule.ts` enriches each probable pitcher in two phases:

```typescript
const enrichPitcher = async (p: ProbablePitcher) => {
  const [currentLine, priorLine, currentSavant, priorSavant, appearances] = await Promise.all([
    getPitcherSeasonLines(p.mlbId, currentSeason),     // current Stats-API line
    getPitcherSeasonLines(p.mlbId, priorSeason),       // prior Stats-API line
    /* Savant skills + arsenal merge from the schedule fanout */,
    /* prior-season Savant from the same merge */,
    getPitcherAppearances(p.mlbId, currentSeason),     // gamelog with opponent + PA
  ]);
  p.talent = computePitcherTalent({
    mlbId: p.mlbId, throws: p.throws,
    currentLine, priorLine, currentSavant, priorSavant,
    appearances, teamOffense: /* prefetched team-offense map */,
  });
};
```

`getPitcherSeasonLines` and `getPitcherAppearances` (in `players.ts`) both fall back to the prior season when current data is empty.

### 2. Current-season sample handled by Bayesian regression

The old IP-gated tier classifier (`classifyPitcherTier` with IP ≥ 25 cutoffs and an `'unknown'` bucket) is gone. Thin current-season samples are now handled by the talent layer's Bayesian regression: current-season K%/BB%/xwOBACON-allowed are blended against prior-season values (capped at a fraction of current PA) and against league means, weighted by their respective sample sizes. A pitcher with 27 IP gets pulled hard toward the prior; a pitcher with 150 IP gets pulled mostly toward themselves. There is no `'unknown'` state — every pitcher gets a regressed estimate plus a `confidence` cue (`high`/`medium`/`low`) based on `effectivePA`. See [pitcher-evaluation.md](pitcher-evaluation.md).

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

Tiers are derived from the rating score, not classified by stat thresholds. `tierFromScore(score: number)` in [src/lib/pitching/rating.ts](../src/lib/pitching/rating.ts):

| Tier | Score range |
|------|-------------|
| `ace` | ≥ 78 |
| `tough` | 62–77 |
| `average` | 42–61 |
| `weak` | 28–41 |
| `bad` | < 28 |

The score itself comes out of the three-layer pipeline: `PitcherTalent` (context-free) → `GameForecast` (talent + opponent/park/weather/platoon) → `PitcherRating` (forecast projected onto the user's scored categories with their focus weights). There is no `'unknown'` bucket — pitchers with thin samples get a `confidence: 'low'` cue but still place where their data suggests. See [pitcher-evaluation.md](pitcher-evaluation.md).

Tiers drive the batter-row "Facing Ace" / "Weak SP" pills and the streaming board's row tint and composite scoring (see [streaming-page.md](streaming-page.md)).

## Park Factors

`src/lib/mlb/parks.ts` holds static per-venue park data keyed by `mlbVenueId`, which matches the `venue.id` returned by the `/schedule` hydrate. All numeric factors are scraped from [Baseball Savant's Statcast Park Factors leaderboard](https://baseballsavant.mlb.com/leaderboard/statcast-park-factors) — see `scripts/scrape-park-factors.mjs` for the reproducible pull. The default window is 3-year rolling (28 of 30 parks); Sutter Health uses 2025-only (no 3y history yet) and Tropicana uses 3y through 2023 (Rays were displaced 2024–2025). 100 = league average. Refresh preseason.

The `ParkData` shape exposes:

| Field | What it captures |
|---|---|
| `parkFactor` | Overall wOBA index — used by the composite (pitcher rating) and as the AVG/R/RBI fallback when batter handedness is unknown |
| `parkFactorL` / `parkFactorR` | Overall index split by batter handedness — drives the AVG/R/RBI per-hand modifier |
| `parkFactorHR` | HR-specific index, collapsed across handedness — used as the HR fallback |
| `parkFactorHrL` / `parkFactorHrR` | HR index split by batter handedness — captures asymmetric porches (Camden ~126 vs L, ~88 vs R; Citizens Bank ~128 vs L; Dodger ~134 vs R) |
| `parkFactor2B` / `parkFactor3B` | Doubles / triples factors — Fenway boosts 2B via the Monster carom (122), Kauffman boosts 3B via spacious alleys (182) |
| `parkFactorBACON` | Batting Average ON Contact (Savant's `index_bacon`, includes HR). Closest published park-level proxy for "did this park's environment turn balls in play into hits?". **Not BABIP** — BABIP excludes HR and isn't published as a park factor |
| `windSensitivity: 'high' \| 'normal'` | Marks parks whose run environment swings materially with sustained wind (Wrigley, Oracle, Sutter Health). Drives the wind-amplification term inside `getParkAdjustment` — the static 3y factor averages over wind variance, this flag fires only on the day-of weather |

**Reading these fields directly from feature code is forbidden.** All math goes through `getParkAdjustment` in [src/lib/mlb/parkAdjustment.ts](../src/lib/mlb/parkAdjustment.ts) — the single canonical primitive shared by the lineup side (`batterRating`) and the streaming/pitcher side (`forecast`). The primitive:

- Selects the right field for the stat (`statId`)
- Resolves the batter side. `'L'` and `'R'` pick directly. Switch hitters (`'S'`) resolve against `pitcherThrows` to the side they'll actually bat from (opposite the pitcher); when the pitcher's hand is unknown, switch hitters fall back to the overall factor — never to a 50/50 blend, which always overstates a park's hand-skew effect.
- Applies the wind amplification when `park.windSensitivity === 'high'` and sustained game-day wind is parallel to home plate
- Clamps to the per-stat band

The composite (pitcher rating, no `statId`) uses **overall `parkFactor` only** and is bats-agnostic. The HR-park amplification is already applied at the per-PA HR-rate path in `forecast.ts` and propagates into the ERA / WHIP / W sub-scores; multiplying the composite by an HR-derived factor on top would double-count.

`getParkByVenueId(id)` is the lookup helper. `formatParkBadge(park)` produces the badge value (number + isHR flag) for the park column on row UIs — note this badge intentionally picks the more-extreme of `parkFactor` and `parkFactorHR` for at-a-glance UI use, even though the math layer's composite uses overall PF only.

The `tendency` bucket (`extreme-hitter`/`hitter`/`neutral`/`pitcher`/`extreme-pitcher`) is computed from the max-magnitude across the four primary factors so a park that's neutral overall but extreme on one dimension (e.g. Yankee Stadium: 100 overall, 119 HR) lands in the right bucket for the dimension that matters.

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
getPitcherSeasonLines(mlbId, season?): Promise<PitcherSeasonLine | null>
getPitcherAppearances(mlbId, season?): Promise<PitcherAppearance[]>
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
/* getPitcherQualityPill removed in Phase 4d — tier reads come from the
 * rating layer (`PitcherRating.tier`), not from a standalone classifier. */
getFormTrend(splits): FormLabel
getWeatherFlag(game, park): WeatherFlag
```

All verdict helpers return `{ verdict: 'strong' | 'neutral' | 'weak' | 'unknown', label, detail? }` and are the source of the batter-row pills in `PlayerRow.tsx`.
