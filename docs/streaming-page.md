# Streaming Page Architecture

The `/streaming` page is MLBoss's dedicated pitcher-pickup tool. It is **not** a daily lineup surface — daily pitcher sit/start lives on the Today page (`/lineup`, Pitchers tab). Streaming is about rotating through the ~6 moves-per-week budget on the 1-2 bench pitcher slots that rotate, with visibility multiple days ahead.

➜ Architecture: [unified-rating-model.md](unified-rating-model.md) (canonical) | Data layer: [data-architecture.md](data-architecture.md) | MLB API: [mlb-api-reference.md](mlb-api-reference.md) | Today page: split between `src/components/lineup/TodayPitchers.tsx` and `src/components/lineup/TodayManager.tsx`

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

Match priority in `matchFreeAgentToGame` (and the parallel rostered-pitcher matcher in `probableMatch.ts` / `TodayPitchers.tsx`):
1. Team abbreviation must match (after aliasing)
2. Either:
   - Full normalized name equality, OR
   - Normalized last name equality **AND** first-initial agreement

The first-initial gate is what stops the same-team-same-surname collision: when the Athletics carry both Jacob and Otto López (or — historically — two Ureñas), last-name-only matching attached the probable starter's projection to BOTH players, surfacing two streamers for one game. The `isLikelySamePlayer` helper in `display.tsx` is the single canonical matcher; both the streaming page and the today/dashboard probable-starter matchers route through it.

**Future improvement:** if we ever sync Yahoo `player_id` ↔ MLB `id`, this name-based matching becomes unnecessary and we should switch to ID-based matching.

## Per-Category Sub-Scores

Every pitcher row is rated by `scorePitcher` in `src/lib/pitching/scoring.ts` (UI-shaped wrapper around `getPitcherRating` in `src/lib/pitching/rating.ts`), which builds a 0-1 sub-score per fantasy category the league actually scores (default cats: QS, K, W, ERA, WHIP). The sub-scores drive both:

- The **category-fit pills** on each row (strong / weak / punted), and
- The **composite score** — a focus-weighted average of the active sub-scores, multiplied at the composite by **only** velocity and platoon. Park, weather, and opp lineup quality live at the per-PA layer (in `forecast.ts`) — they shape `expectedPerPA` directly so different stats respond differently to the same stadium (Coors suppresses K and inflates HR; a flat composite multiplier would conflate the two). See [unified-rating-model.md](unified-rating-model.md) for the layered architecture.

The park multiplier comes from `getParkAdjustment` in [src/lib/mlb/parkAdjustment.ts](../src/lib/mlb/parkAdjustment.ts) — the same primitive the lineup-side batter rating consumes, so a pitcher rating @ Coors and a batter rating @ Coors agree on the underlying park math.

Sub-scores are produced by [`PitcherRating`](../src/lib/pitching/rating.ts) (Layer 3). Each Yahoo-scored category gets projected from the `GameForecast.expectedPerGame` and normalised against a per-stat league window. The category-to-projection map:

| Sub-score | Projection source (from `GameForecast.expectedPerGame`) | Normalisation window |
|-----------|---------------------------------------------------------|----------------------|
| **QS** | `probabilities.qs` (function of IP and ERA) | 0.10 → 0.70 |
| **K** | `expectedPerGame.k` | 3.5 → 9.0 |
| **W** | `probabilities.w` (talent diff vs opp SP, bullpen, home/away) | 0.20 → 0.65 |
| **ERA** | `expectedERA` | 5.50 → 2.30 (lower is better) |
| **WHIP** | derived from `expectedPerPA.bbPerPA` and `expectedPerPA.baa` | 1.55 → 0.95 (lower is better) |

There is no longer a separate "pitcher talent score" function — the canonical talent vector lives in `PitcherTalent` (`src/lib/pitching/talent.ts`) and is consumed by `buildGameForecast` to produce the per-game projections above. See [pitcher-evaluation.md](pitcher-evaluation.md).

### Opposing-starter signal in W

`MLBGame` carries both probables (the schedule pipeline enriches both in lockstep, stamping `pp.talent` on each). `buildGameForecast` reads the opposing pitcher's `PitcherTalent` and uses the talent-vs-talent xwOBA differential to dampen P(W) — facing an ace collapses W odds regardless of how good our guy is.

### Bullpen signal in W

Bullpen quality only feeds the W probability, not the composite. Uses **team staff ERA** (`MLBGame.homeTeam.staffEra` / `awayTeam.staffEra`) as a proxy — overall pitching ERA, not relief-only. Correlates ~0.7 with true bullpen ERA. The contribution is halved before applying to P(W), since the bullpen only pitches ~3 of every 9 innings. Upgrade path: fetch sitCodes=rp split if the proxy isn't sharp enough.

### Pills

`getStreamPills` (in `scoring.ts`) reads the rating's category contributions: **strong** when normalized ≥ 0.72, **weak** when ≤ 0.35. One hard gate: a pitcher with projected IP < 5.0 always gets the QS-weak pill regardless of sub-score (a 4.6-IP opener simply can't QS). Confidence is surfaced separately as a UI cue but does NOT gate pills — we don't hide low-confidence pitchers, we mark them.

### Multipliers

**Composite-level** (applied to the score):

- **Velocity** (year-over-year fastball delta): ±2 mph → asymmetric ±6% (losses 4%/mph, gains 3%/mph). Asymmetry is empirically motivated — velo loss is a stronger negative predictor than velo gain is a positive one.
- **Platoon vulnerability** (weak-side OPS allowed): clean split → +5%, vulnerable → -5%.

**Surface-level** (already in per-cat numbers; shown for breakdown transparency):

- **Park** — feeds per-cat via parkSO (K), parkBB (BB), parkHR with gbRate gating (HR), and overall parkFactor (non-HR contact value).
- **Weather** — folds into HR rate (±8%) and non-HR contact value (±4%) at per-PA. K/BB/SB are weather-independent.
- **Opp lineup** — drives per-cat K rate (log5 against opp K-rate-vs-hand), BB rate (× oppOpsFactor), and contact quality.

The breakdown panel labels these "Context (already in cats above)" so the user doesn't think they were multiplied a second time.

Sample-size handling has moved from a runtime "credibility multiplier" applied after scoring to a Bayesian regression applied upstream at the talent layer. Thin-sample pitchers are pulled toward the prior via the `effectivePA`-weighted blend in `computePitcherTalent`, and the resulting `confidence` cue (`high`/`medium`/`low`) is surfaced in the UI as a label PLUS a numeric ± band on the score (e.g. `62 ± 8`). The score band renders next to the number when ≥ 5 score points; large bands (≥ 10) flag in error tone.

## Compare Tray

Each row has a checkbox column on the left for adding the candidate to a side-by-side comparison tray that renders above the row list when at least one candidate is selected. The tray surfaces:

- Player name + team / opponent
- Composite score with optional ± band
- Tier label (ACE / Tough / Avg / Weak / Bad)
- Per-cat sub-score cells colored by fit (strong / neutral / weak / punted)
- Top risk phrases (up to 2)

The component is engine-agnostic — `src/components/shared/CompareTray.tsx` consumes a `CompareTraySlot[]`, and the streaming page builds slots via `streamSlotsFromCandidates` (in `StreamingBoard.tsx`). The same component is reusable on the lineup pages with a different slot adapter.

## Row Tint

Background tint comes from the final composite score:

- `score ≥ 0.70` → `bg-success/5` (green — favorable stream)
- `0.50 ≤ score < 0.70` → no tint (neutral)
- `score < 0.50` → `bg-error/5` (red — rough matchup)

## Weather Gotcha

MLB's `weather` hydrate is only populated ~2 hours before first pitch. For future dates, all of `temp`, `condition`, `wind` are null. Without a guard, every card would show a fallback cloud icon and appear "cloudy."

`hasWeatherData(w)` in `src/lib/pitching/display.tsx` returns true iff any of `condition`, `temperature`, `windSpeed` is non-null. The entire weather block is omitted otherwise, which is the normal state for D+1+ until game day.

`weatherIcon(condition)` also returns `null` (not a default icon) when condition is missing, so we never render a placeholder.

## What lives on Today, not Streaming

The Today page (`/lineup`, Pitchers tab — `src/components/lineup/TodayPitchers.tsx`) handles the simpler sit/start decision for **rostered** pitchers. No streaming logic, pills, composite score, or date strip — those belong here. That page shows Active / Bench / Injured groups with today's matchup context and an expandable score breakdown.
