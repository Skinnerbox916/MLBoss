# Pitching Page Architecture

The `/pitching` page is MLBoss's dedicated pitcher decision tool. It has two tabs:

- **Today** — sit/start decisions for rostered pitchers against today's game context
- **Tomorrow** (default) — streaming board that cross-references Yahoo free-agent pitchers with MLB probable starters to surface pickup candidates

A **Matchup Pulse** panel (live pitching-category scores vs this week's opponent) sits above both tabs and is always visible, so streaming decisions can be made with full awareness of which categories you're winning, losing, or tied in.

➜ Data layer: [data-layer.md](data-layer.md) | MLB API: [mlb-api-reference.md](mlb-api-reference.md)

## Entry Point

`src/components/pitching/PitchingManager.tsx` is the single component that implements the entire page. It's deliberately kept as one file so the streaming logic (pills, scoring, matching) lives next to the rendering code — the logic is highly specific to this surface and isn't shared.

The page is mounted at `src/app/pitching/page.tsx`.

## Data Pipeline (Four Sources)

The streaming board fuses data from four independent sources. Each has its own SWR hook and cache tier:

| Source | Hook | Endpoint | TTL | What it gives us |
|--------|------|----------|-----|------------------|
| **Yahoo free agents** | `useAvailablePitchers` | `/api/fantasy/players` | 5 min | Eligible FA/waiver pitchers with `editorial_team_abbr`, `ownership_type`, `image_url` |
| **MLB schedule** | `useGameDay(tomorrow)` | `/api/mlb/games` | 5 min | Tomorrow's games with probable pitchers, venue, park factors, weather |
| **MLB team offense** | `useTeamOffense(teamIds)` | `/api/mlb/team-offense` | 1 hour | Season batting + vs-LHP/RHP splits for every team appearing in tomorrow's games |
| **League pitching categories** | `useLeagueCategories` + `useScoreboard` | `/api/fantasy/*` | 10 min / 1 min | Drives the Matchup Pulse panel |

The fusion happens entirely client-side in a `useMemo` inside `StreamingBoard`, keyed on `[games, freeAgents, teamOffense]`.

### Why `teamOffense` is fetched separately

Instead of baking team offense into `useGameDay`, we collect the set of opposing team MLB IDs from the schedule in a `useMemo`, then hand them to `useTeamOffense`:

```typescript
const opposingTeamIds = useMemo(() => {
  const ids = new Set<number>();
  for (const g of tomorrowGames) {
    ids.add(g.homeTeam.mlbId);
    ids.add(g.awayTeam.mlbId);
  }
  return Array.from(ids);
}, [tomorrowGames]);
```

This keeps the schedule endpoint hot (5-min TTL) without dragging a 30-team offense fetch into it, and lets team offense ride its own 1-hour TTL since it's much more stable.

## Yahoo Free Agent Pitcher Pagination

The most important non-obvious detail on this page: **Yahoo's `position=P` filter returns a narrow slice** in leagues with split SP/RP slots, missing many streamable starters. `src/lib/fantasy/players.ts` bypasses this by querying SP and RP separately and merging:

```typescript
const [sp, rp] = await Promise.all([
  api.getLeaguePlayers(leagueKey, { position: 'SP', status: 'A', maxPages: 16 }), // up to ~400
  api.getLeaguePlayers(leagueKey, { position: 'RP', status: 'A', maxPages: 4 }),  // up to ~100
]);
// Dedupe by player_key — SP/RP-eligible pitchers appear in both
```

The SP list gets the bulk of pagination because that's what the streaming board cares about. RP is included at 100-deep for completeness — some streamable long-relievers and openers show up only under the RP filter.

**Why this matters:** Before the split-query fix, the board was only finding ~4 of ~12 free-agent probable starters on a given day. With the fix, coverage is effectively complete.

## Free Agent → Probable Starter Matching

`matchFreeAgentToGame` in `PitchingManager.tsx` cross-references a Yahoo FA against MLB probable pitchers. Two layers of normalization handle the drift between the two APIs:

### Team abbreviation aliasing

```typescript
const TEAM_ABBR_ALIASES: Record<string, string> = {
  AZ: 'ARI', ARI: 'ARI',
  CHW: 'CWS', CWS: 'CWS',
  WAS: 'WSH', WSH: 'WSH',
  KCR: 'KC', KC: 'KC',
  SDP: 'SD', SD: 'SD',
  SFG: 'SF', SF: 'SF',
  TBR: 'TB', TB: 'TB',
};
```

Yahoo uses `KCR` / `SDP` / `SFG` / `TBR` / `CHW` / `WAS`; MLB uses the shorter forms. `normalizeTeamAbbr` collapses both sides to a canonical key.

### Name normalization

```typescript
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')    // strip diacritics (Peña → Pena)
    .toLowerCase()
    .replace(/[.,']/g, '')               // strip punctuation (J.T. → JT, O'Neill → ONeill)
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, '') // strip suffixes
    .trim();
}
```

Match priority in `matchFreeAgentToGame`:
1. Team abbreviation must match (after aliasing)
2. Normalized last name equality, OR
3. Full normalized name equality, OR
4. Full name containment either direction (handles "J.T. Brubaker" ↔ "JT Brubaker")

**Note:** This is intentionally looser than the dashboard's batter matching. For pitchers, the team+last-name combination is essentially unique on any given day (two same-last-name probable starters on the same team would be a historic edge case), so we don't need MLB-ID disambiguation here.

## Per-Pitcher Stream Pills

Instead of a global "Stream for: [QS|K|W|ERA|WHIP]" sort selector, each pitcher row carries its own pills showing which fantasy categories that start is likely to **help (strong, green)** or **hurt (weak, red)**. Pills not shown = neutral/unknown.

This mirrors the batter-row `VerdictPill` pattern from `src/components/lineup/PlayerRow.tsx` — each row tells its own story instead of forcing the user to pivot the whole board.

The pill evaluator (`getStreamPills` in `PitchingManager.tsx`) takes `{ pp, oppOffense, park, weather, isHome }` and produces pills per category:

### QS (Quality Start)

- **Strong:** `IP/GS ≥ 5.8` AND `ERA ≤ 4.00` AND `pitchesPerInning ≤ 16` (efficient) AND opponent OPS ≤ .750
- **Weak:** `IP/GS < 5.0` (can't get deep enough), OR ERA > 5.00 with `IP/GS < 5.5`

### K (Strikeouts)

Opponent-aware: even elite-K pitchers against contact-heavy lineups are downgraded, and mediocre-K pitchers against K-prone lineups are upgraded.

- **Strong:** `K/9 ≥ 9.5` (elite, opponent-agnostic), OR
- **Strong:** `K/9 ≥ 8.5` AND opponent K-rate ≥ .210 (most opponents), OR
- **Strong:** `K/9 ≥ 7.5` AND opponent K-rate ≥ .230 (K-prone lineup)
- **Weak:** `K/9 < 5.5` (low-K pitcher, regardless), OR
- **Weak:** `K/9 < 7.5` AND opponent K-rate < .200 (contact-heavy opponent)

Opponent K-rate is handedness-split when available (uses `vsLeft.strikeOutRate` or `vsRight.strikeOutRate` keyed on pitcher throws).

### W (Win)

- **Strong:** `ERA ≤ 3.75` AND opponent OPS ≤ .720 AND home field, OR
- **Strong:** `ERA ≤ 3.50` AND opponent OPS ≤ .740 (regardless of home/road)
- **Weak:** `ERA > 5.00` AND opponent OPS ≥ .770

### ERA

- **Strong:** `ERA ≤ 3.50` AND opponent OPS ≤ .730 AND `parkFactor ≤ 97` AND no bad wind, OR
- **Strong:** `ERA ≤ 3.25` (unconditional — great pitchers get the pill regardless of park/weather)
- **Weak:** `ERA ≥ 5.00`, OR hitter park (`parkFactor ≥ 105`) with wind blowing out ≥ 10 mph

### WHIP

- **Strong:** `WHIP ≤ 1.15` AND opponent OPS ≤ .730, OR
- **Strong:** `WHIP ≤ 1.10` (unconditional)
- **Weak:** `WHIP ≥ 1.45`

### What counts as "bad wind"

```typescript
const windOut = weather.windDirection?.toLowerCase().includes('out') ?? false;
const windBad = windOut && (weather.windSpeed ?? 0) >= 10;
```

## Row Tint & Composite Score

The pills drive individual category decisions, but the board also needs a **sort order** and a **quick "is this a good stream" visual cue**. That comes from `overallScore`, a weighted composite of normalized values (each mapped to 0-1 where 1 = best):

| Signal | Range | Weight |
|--------|-------|--------|
| ERA (inverted) | 1.5 – 6.0 | 30% |
| WHIP (inverted) | 0.8 – 1.6 | 20% |
| Opponent OPS (inverted, handedness-split) | .600 – .850 | 25% |
| Park factor (inverted) | 85 – 115 | 15% |
| Wind penalty | 0 – 20 mph out | 10% |

Rows sort by this score descending. Background tint:

- `sortScore ≥ 0.70` → `bg-success/5` (green — favorable stream)
- `0.50 ≤ sortScore < 0.70` → no tint (neutral)
- `sortScore < 0.50` → `bg-error/5` (red — rough matchup)

## Row Layout

Each candidate card is laid out like the batter `PlayerRow` from the lineup page — avatar on the left, stacked info on the right:

**Left column:** Rank number (`1`, `2`, ...) + avatar (uses `player.image_url` with an initial-bubble fallback when the image fails to load)

**Right column (4 lines):**

1. **Name · throws · tier · team/position · WW** — name, `(LHP)`/`(RHP)` in handedness-coded color (accent for L, primary for R), tier label (ACE/Tough/Avg/Weak/Bad) in tier color, team + display position, WW badge if ownership is on waivers
2. **Matchup context** — `vs OPP` / `@ OPP` · Opp OPS (handedness-split) · PF pill · weather block (temp, wind, condition icon — only rendered if at least one weather field is populated)
3. **Stat line** — `ERA X.XX · WHIP X.XX · K/9 X.X · IP/GS X.X`
4. **Stream pills** — the QS/K/W/ERA/WHIP verdict chips

The WW badge is the only ownership marker shown — the FA label was removed because "free agent" is implicit on the streaming board.

## Weather Gotcha

MLB's `weather` hydrate is only populated ~2 hours before first pitch. For tomorrow's games, all of `temp`, `condition`, `wind` are null. Without a guard, every card would show a fallback cloud icon and appear "cloudy."

`hasWeatherData(w)` returns true iff any of `condition`, `temperature`, `windSpeed` is non-null. The entire weather block is omitted otherwise, which is the normal state for the Tomorrow tab until game day.

`weatherIcon(condition)` also returns `null` (not a default icon) when condition is missing, so we never render a placeholder.

## Today Tab

Simpler surface — just three groups of rostered pitchers with today's game info:

- **Active** — pitchers in non-BN/IL slots. Starting-today pitchers get a green `Starting` badge (`isStartingToday` matches by last name)
- **Bench** — BN slots
- **Injured** — IL / IL+ / NA slots, red-tinted

No streaming logic, pills, or composite score — the decision is simpler (sit or start a player you already own). The team abbreviation match in `findPitcherGame` is direct (uppercased), not aliased — today's tab never had the same cross-API drift issues the streaming board has.

## Matchup Pulse

Always visible above both tabs. Shows your team's vs. opponent's stat for each pitching category in the current week's matchup, color-coded by whether you're winning, losing, or tied, with a `W-L-T` tally badge in the header.

Data comes from `useScoreboard` (1-minute TTL, live stats) and `useLeagueCategories` (10-minute TTL, filtered by `is_pitcher_stat`). Renders as a flex-wrap row of small cards — one per category — so users don't have to navigate away to know whether picking up a strikeout-heavy streamer actually helps them this week.
