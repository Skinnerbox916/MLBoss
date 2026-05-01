# Streaming Page Architecture

The `/streaming` page is MLBoss's dedicated pitcher-pickup tool. It is **not** a daily lineup surface — daily pitcher sit/start lives on the Today page (`/lineup`, Pitchers tab). Streaming is about rotating through the ~6 moves-per-week budget on the 1-2 bench pitcher slots that rotate, with visibility multiple days ahead.

➜ Data layer: [data-architecture.md](data-architecture.md) | MLB API: [mlb-api-reference.md](mlb-api-reference.md) | Today page: split between `src/components/lineup/TodayPitchers.tsx` and `src/components/lineup/TodayManager.tsx`

## Entry Point

`src/components/streaming/StreamingManager.tsx` orchestrates the page. It renders:

1. A `MatchupPulse` with `side="pitching"` so pickup decisions know which pitching categories you need to help this week.
2. A `DateStrip` that selects the target date — D+1 (default) through D+5. See [Multi-day probables](#multi-day-probables).
3. The `StreamingBoard` in `src/components/streaming/StreamingBoard.tsx`, which fuses Yahoo FA pitchers with MLB probable starters for the selected date.

The page is mounted at `src/app/streaming/page.tsx`.

## Multi-day probables

Yahoo only publishes probable pitchers for tomorrow. MLB's `/schedule?date=...&hydrate=probablePitcher` works for any date (see `src/lib/mlb/schedule.ts`), and reliably hydrates D+1 through ~D+3. D+4 and D+5 become progressively thinner — most clubs haven't announced that far out. This is surfaced in-page via a helper note on the `StreamingBoard` panel.

The `DateStrip` component renders a simple horizontal strip of day buttons. The board re-fetches `useGameDay(selectedDate)` when the strip changes, so each date has its own SWR cache entry. Team offense (`useTeamOffense`) is fetched once per unique team set and reused across dates.

## Data Pipeline (Four Sources)

The streaming board fuses data from four independent sources. Each has its own SWR hook and cache tier:

| Source | Hook | Endpoint | TTL | What it gives us |
|--------|------|----------|-----|------------------|
| **Yahoo free agents** | `useAvailablePitchers` | `/api/fantasy/players` | 5 min | Eligible FA/waiver pitchers with `editorial_team_abbr`, `ownership_type`, `image_url` |
| **MLB schedule** | `useGameDay(date)` | `/api/mlb/games` | 5 min | Games for the selected date with probable pitchers, venue, park factors, weather |
| **MLB team offense** | `useTeamOffense(teamIds)` | `/api/mlb/team-offense` | 1 hour | Season batting + vs-LHP/RHP splits for every team appearing in the games |
| **League pitching categories** | `useLeagueCategories` + `useScoreboard` | `/api/fantasy/*` | 10 min / 1 min | Drives the Matchup Pulse panel |

The fusion happens entirely client-side in a `useMemo` inside `StreamingBoard`, keyed on `[games, freeAgents, teamOffense]`.

### Why `teamOffense` is fetched separately

Instead of baking team offense into `useGameDay`, we collect the set of opposing team MLB IDs from the schedule in a `useMemo`, then hand them to `useTeamOffense`:

```typescript
const opposingTeamIds = useMemo(() => {
  const ids = new Set<number>();
  for (const g of games) {
    ids.add(g.homeTeam.mlbId);
    ids.add(g.awayTeam.mlbId);
  }
  return Array.from(ids);
}, [games]);
```

This keeps the schedule endpoint hot (5-min TTL) without dragging a 30-team offense fetch into it, and lets team offense ride its own 1-hour TTL since it's much more stable.

## Yahoo Free Agent Pitcher Pagination

Two non-obvious details from Yahoo's player-listing endpoint shape `getAvailablePitchers` in `src/lib/fantasy/players.ts`. We issue four queries instead of one consolidated `status=A`:

```typescript
const [spFa, rpFa, spW, rpW] = await Promise.all([
  api.getLeaguePlayers(leagueKey, { position: 'SP', status: 'FA', maxPages: 16 }), // ~400
  api.getLeaguePlayers(leagueKey, { position: 'RP', status: 'FA', maxPages: 4 }),  // ~100
  api.getLeaguePlayers(leagueKey, { position: 'SP', status: 'W', maxPages: 4 }),
  api.getLeaguePlayers(leagueKey, { position: 'RP', status: 'W', maxPages: 2 }),
]);
// Tag W rows as ownership_type='waivers' at the merge layer.
// Dedupe by player_key — FA wins over W when a player appears in both.
```

**Why split SP/RP:** Yahoo's `position=P` filter returns a narrow slice in leagues with split SP/RP slots, missing many streamable starters. Before the split-query fix the board was finding only ~4 of ~12 free-agent probable starters on a given day.

**Why split FA/W:** the row-level `ownership` block is empty on this endpoint — `;out=ownership` is silently ignored — so we can't tell from a row whether the player is on waivers. The only signal is *the query they came from*. Querying `status=W` separately and tagging at the merge layer is how we know which players to gate. See `docs/yahoo-api-reference.md` for the underlying quirk.

## Waiver pool is hidden

Pitchers tagged `ownership_type === 'waivers'` are dropped from the streaming board entirely. This is intentionally conservative: Yahoo doesn't expose a per-player `waiver_date` on the player-listing endpoint, so we can't surface a player on dates ≥ their clear date the way we'd ideally want to (e.g. show a Saturday-clear pitcher on a D+3 view that lands on Saturday).

**Upgrade path** if we want date-aware waiver gating: cross-reference `/league/{key}/transactions` for each waiver player's drop timestamp with the league's waiver-period setting from `/league/{key}/settings` to compute the clear date, and revert the board filter to `waiver_date > date → skip`.

## Free Agent → Probable Starter Matching

`matchFreeAgentToGame` in `src/lib/pitching/display.tsx` cross-references a Yahoo FA against MLB probable pitchers. Two layers of normalization handle the drift between the two APIs:

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

**Note:** This is intentionally looser than the dashboard's batter matching. For pitchers, the team+last-name combination is essentially unique on any given day, so we don't need MLB-ID disambiguation here.

## Per-Category Sub-Scores

Every pitcher row is rated by `getPitcherRating` in `src/lib/pitching/scoring.ts`, which builds a 0-1 sub-score per fantasy category the league actually scores (default cats: QS, K, W, ERA, WHIP). The sub-scores drive both:

- The **category-fit pills** on each row (strong / weak / punted), and
- The **composite score** — a focus-weighted average of the active sub-scores, multiplied by global matchup multipliers (velocity trend, platoon vulnerability) and a sample-size credibility multiplier.

Sub-scores are **causally motivated** — each one only moves when its real drivers move. The K sub-score doesn't care about IP/GS, and the QS sub-score doesn't care about K/9. Inputs:

| Sub-score | Inputs (with weights) |
|-----------|-----------------------|
| **QS** | IP/GS (35%), pitcher talent (25%), ERA proxy (15%), opp OPS-vs-hand (25%) |
| **K** | K/9 (50%), pitcher talent (25%), opp K-rate-vs-hand (25%) |
| **W** | Pitcher talent (35%), opposing starter talent inverted (25%), opp OPS-vs-hand (20%), own bullpen ERA (10%), home/away (10%) |
| **ERA** | Pitcher talent (35%), ERA proxy (25%), opp OPS-vs-hand (15%), park HR factor (15%), weather (10%), GB-arm bonus in HR parks (up to +4%) |
| **WHIP** | BB/9 (35%), WHIP (25%), pitcher talent (20%), opp OPS-vs-hand (20%) |

### Pitcher talent — hierarchical resolution

The streaming module delegates to the canonical `pitcherTalentScore` in `src/lib/pitching/quality.ts` (via a thin `resolveTalent` projection). The resolution order is:

1. **Run Value per 100 (Savant pitch-model proxy)** — used when the pitcher has ≥40 current-season IP. Below that, the blended RV/100 leans too hard on prior year.
2. **Component xwOBA-allowed** from `talentModel.ts` (regressed K%/BB%/xwOBACON).
3. **Tier fallback** (`ace`/`tough`/`average`/`weak`/`bad` → 0.90/0.70/0.50/0.30/0.10).
4. Neutral 0.5 with `available: false`.

### Opposing-starter signal in W

`MLBGame` carries both probables (the schedule pipeline enriches them in lockstep). For each candidate we resolve the opposing starter's talent the same way and invert it inside `scoreW` — facing an ace collapses W odds regardless of how good our guy is.

### Bullpen signal in W

Currently uses **team staff ERA** (`MLBGame.homeTeam.staffEra` / `awayTeam.staffEra`) as a proxy for bullpen quality — overall pitching ERA, not relief-only. Correlates ~0.7 with true bullpen ERA. Upgrade path: fetch sitCodes=rp split if the proxy isn't sharp enough.

### Pills

`getStreamPills` reads the same sub-scores: **strong** at sub-score ≥ 0.72, **weak** at ≤ 0.35. One hard gate: a pitcher with `IP/GS < 5.0` always gets the QS-weak pill regardless of sub-score (a 4.6-IP opener simply can't QS). Pills are suppressed entirely below `MIN_CRED_FOR_PILLS` (0.60) — no confident category claims when we don't trust the underlying score.

### Multipliers

Applied on top of the weighted sub-score sum:

- **Velocity** (year-over-year fastball delta): ±2 mph → asymmetric ±7% (losses 4%/mph, gains 3%/mph). Top-quartile early-season decline predictor.
- **Platoon vulnerability** (weak-side OPS allowed): clean split → +5%, vulnerable → -5%.
- **Credibility** (sample-size downweight, ≤ 1.0): proven tier → 1.0; unclassified ramp on current IP; debut cap of 0.40 below 20 IP.

## Row Tint

Background tint comes from the final composite score (post-multipliers, post-credibility):

- `score ≥ 0.70` → `bg-success/5` (green — favorable stream)
- `0.50 ≤ score < 0.70` → no tint (neutral)
- `score < 0.50` → `bg-error/5` (red — rough matchup)

## Weather Gotcha

MLB's `weather` hydrate is only populated ~2 hours before first pitch. For future dates, all of `temp`, `condition`, `wind` are null. Without a guard, every card would show a fallback cloud icon and appear "cloudy."

`hasWeatherData(w)` in `src/lib/pitching/display.tsx` returns true iff any of `condition`, `temperature`, `windSpeed` is non-null. The entire weather block is omitted otherwise, which is the normal state for D+1+ until game day.

`weatherIcon(condition)` also returns `null` (not a default icon) when condition is missing, so we never render a placeholder.

## What lives on Today, not Streaming

The Today page (`/lineup`, Pitchers tab — `src/components/lineup/TodayPitchers.tsx`) handles the simpler sit/start decision for **rostered** pitchers. No streaming logic, pills, composite score, or date strip — those belong here. That page shows Active / Bench / Injured groups with today's matchup context and an expandable score breakdown.
