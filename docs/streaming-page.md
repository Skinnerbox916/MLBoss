# Streaming Page Architecture

The `/streaming` page is MLBoss's dedicated pickup tool — pitchers and batters in tabs. It is **not** a daily lineup surface; daily pitcher sit/start lives on the Today page (`/lineup`, Pitchers tab). Streaming is about rotating through the ~6 moves-per-week budget on the 1-2 bench slots that rotate, with visibility multiple days ahead.

➜ Architecture: [unified-rating-model.md](unified-rating-model.md) (canonical) | Data layer: [data-architecture.md](data-architecture.md) | Recommendation engine: [recommendation-system.md](recommendation-system.md) | MLB API: [mlb-api-reference.md](mlb-api-reference.md) | Today page: split between `src/components/lineup/TodayPitchers.tsx` and `src/components/lineup/TodayManager.tsx`

## Entry Point

`src/components/streaming/StreamingManager.tsx` orchestrates the page. Two tabs:

- **Pitchers** — multi-day probable starts ranked by week-aggregate projected output. The two-start bias falls out of the math: a 2-start streamer sums two per-start scores, naturally outranking single-start pitchers of equal per-start quality.
- **Batters** — rest-of-week batter pickups ranked by slot-aware streaming value against a corrected matchup margin.

Both tabs share a top-level `GamePlanPanel` (per side) that contains the chase/hold/punt grouping and the inline focus pills. There is no longer a standalone `CategoryFocusBar` or `MatchupPulse` on this page — both retired in favor of the consolidated Game Plan view (see [Game Plan Card](#game-plan-card) below).

The page is mounted at `src/app/streaming/page.tsx`.

## Pickup Window

Both tabs operate over the same time horizon: **the pickup-playable window**. Any pickup made now lands on a roster *tomorrow*, so today is excluded from value calculations.

```typescript
// src/lib/dashboard/weekRange.ts
getPickupPlayableDays() // Mon-Sat: tomorrow → Sunday. Sunday: full next Mon-Sun.
getStreamingGridDays()  // Same shape, always 7 days for stable hook order.
```

Window length implications for pitcher streaming:

- Sun/Mon picks see ~7 days — plenty of two-start coverage.
- Wed picks see ~4 days — at most one start per pitcher (rotation gap > remaining window).
- Engine just iterates the window; two-start coverage falls out naturally without special-casing.

## Pitcher Tab Pipeline

Three engines compose the pitcher tab. None are bolt-ons; they share the per-start primitive at the bottom of the stack.

```
              ┌─────────────────────────────────────────┐
              │       buildGameForecast (per start)     │  Layer 2 — talent + context
              │       getPitcherRating  (per start)     │  Layer 3 — fantasy-cat scoring
              └────────────────────┬────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌────────────────┐         ┌────────────────┐         ┌────────────────┐
│ scorePitcher   │         │ projectPitcher │         │ projectPitcher │
│   (single)     │         │   Player       │         │   Team         │
│                │         │   (multi-start)│         │ (roster-wide)  │
├────────────────┤         ├────────────────┤         ├────────────────┤
│ Single-start   │         │ FA week scores │         │ Corrected      │
│ breakdown      │         │ for ranking    │         │ pitcher-cat    │
│ panel          │         │ (sum across    │         │ matchup margin │
│ (expanded row) │         │  starts)       │         │ (counting cats)│
└────────────────┘         └────────────────┘         └────────────────┘
```

| Layer | File | Role |
|-------|------|------|
| Per-start forecast | `src/lib/pitching/forecast.ts` | Talent + game → expected K/IP/ER/BB/H + P(QS), P(W) |
| Per-start rating | `src/lib/pitching/rating.ts` | `GameForecast` → 0-100 score + per-cat sub-scores |
| Multi-start FA score | `src/lib/projection/pitcherTeam.ts` (`projectPitcherPlayer`) | Aggregates per-start ratings + counting cats over the pickup window |
| Roster-wide team projection | same file (`projectPitcherTeam`) | Sums FA primitives over a team's roster for the corrected pitcher-cat margin |
| Single-start breakdown | `src/lib/pitching/scoring.ts` (`scorePitcher`) | UI-shaped per-start scoring; consumed by `ScoreBreakdownPanel` on row expand |

The streaming board's per-FA ranking signal is `projection.weeklyScore` — the **sum** of per-start rating scores within the pickup window. Summing (not averaging) is what privileges two-start pitchers. Per-cat counting projections (`byCategory`) sum across starts the same way; ratio cats record numerator/denominator but pass through unchanged on the corrected margin (see [Ratio cats are YTD only](#ratio-cats-are-ytd-only)).

## Data Pipeline

| Source | Hook | Endpoint | TTL | What it gives us |
|--------|------|----------|-----|------------------|
| **Yahoo free agents** | `useAvailablePitchers` | `/api/fantasy/players` | 5 min | Eligible FA/waiver pitchers with `editorial_team_abbr`, `ownership_type`, `image_url` |
| **MLB schedule (per day, ×7)** | `useGameDay(date)` | `/api/mlb/game-day` | 5 min | Probable starters (with talent stamped), venue, park, weather, lineups |
| **MLB team offense** | `useTeamOffense(teamIds)` | `/api/mlb/team-offense` | 1 hour | Season batting + vs-LHP/RHP splits |
| **League pitching categories** | `useLeagueCategories` + `useScoreboard` | `/api/fantasy/*` | 10 min / 1 min | Drives the Game Plan Panel chase/hold/punt grouping |
| **Pitcher-team projections (mine + opp)** | `usePitcherTeamProjection` | `/api/projection/pitcher-team` | 5 min | Counting-cat projections that feed `useCorrectedMatchupAnalysis` |

The fan-out happens in `useWeekPitcherScores`: seven `useGameDay` calls (stable hook order; SWR de-dupes), then per-FA `projectPitcherPlayer` over the playable window. The FA pool is filtered to those with at least one probable start; pitchers with zero starts in the window are dropped before reaching the board.

### Team-offense lookup approximation

The pitcher tab fetches `useTeamOffense` keyed by tomorrow's slate (D+1) team ids — usually 28-30 teams when all play. Multi-day starts against teams not on tomorrow's slate degrade the forecast to neutral opp context. The trade is simpler wiring vs. fetching team offense for the union across the 7-day grid; revisit if rankings feel off mid-week.

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

Pitchers tagged `ownership_type === 'waivers'` are dropped from the streaming board entirely. This is intentionally conservative: Yahoo doesn't expose a per-player `waiver_date` on the player-listing endpoint, so we can't surface a player on dates ≥ their clear date.

**Upgrade path** if we want date-aware waiver gating: cross-reference `/league/{key}/transactions` for each waiver player's drop timestamp with the league's waiver-period setting from `/league/{key}/settings` to compute the clear date, and revert the board filter to `waiver_date > date → skip`.

## Free Agent → Probable Starter Matching

`projectPitcherPlayer` uses `isLikelySamePlayer` (in `src/lib/pitching/display.tsx`) to cross-reference a Yahoo FA against the day's probable pitchers. Same matcher used by:

- `matchFreeAgentToGame` (single-start FA matcher, kept for back-compat)
- `matchProbableStarts` (rostered-pitcher matcher in `probableMatch.ts`)

### Team abbreviation aliasing

The single canonical alias table is in `src/lib/mlb/teamAbbr.ts` — every cross-source matcher (Yahoo↔MLB FA matching, MLB↔ESPN scoreboard splice in `schedule.ts`) reads from it. Centralizing here closes the drift hazard that previously caused PIT @ ARI's probable starter to silently disappear when only one of two duplicate tables had the AZ/ARI entry.

```typescript
// src/lib/mlb/teamAbbr.ts
const ALIASES: Record<string, string> = {
  AZ: 'ARI', ARI: 'ARI',
  CHW: 'CWS', CWS: 'CWS',
  WAS: 'WSH', WSH: 'WSH',
  KCR: 'KC',  KC:  'KC',
  SDP: 'SD',  SD:  'SD',
  SFG: 'SF',  SF:  'SF',
  TBR: 'TB',  TB:  'TB',
};
```

Yahoo uses `KCR` / `SDP` / `SFG` / `TBR` / `CHW` / `WAS`; MLB uses the shorter forms; ESPN agrees with Yahoo on most (with the notable AZ/ARI exception that hits MLB-side keys). `normalizeTeamAbbr` collapses every variant to a canonical form, idempotently.

### Name normalization

```typescript
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')    // strip diacritics (Peña → Pena)
    .toLowerCase()
    .replace(/[.,']/g, '')               // strip punctuation (J.T. → JT, O'Neill → ONeill)
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, '') // strip suffixes
    .trim();
}
```

Match priority:
1. Team abbreviation match (after canonicalization)
2. Either:
   - Full normalized name equality, OR
   - Normalized last name equality **AND** first-initial agreement

The first-initial gate stops same-team-same-surname collisions (the Athletics carrying both Jacob and Otto López; historically two Ureñas). Last-name-only matching attached the probable starter's projection to BOTH players, surfacing two streamers for one game.

**Future improvement:** if we ever sync Yahoo `player_id` ↔ MLB `id`, this name-based matching becomes unnecessary.

## Streaming Board

`src/components/streaming/StreamingBoard.tsx` renders the ranked candidate list. Two view modes via the segmented toggle in the panel header:

### Week view (default)

One row per pitcher with at least one probable start in the window, ranked by `projection.weeklyScore` descending. Each row shows:

- Header line: name, throwing-hand pill, tier label, team/position, two-start badge if `expectedStarts >= 2`, waiver badge if applicable
- **Day pills**: a chip per probable start (`MON @ ARI 65` shape) — color-coded by per-start score (success ≥70, neutral 50-69, error <50)
- Aggregated category strip (per-cat fit averaged across starts)
- Score column: the **summed** weekly score + Strong/Fair/Avoid verdict (verdict is computed from per-start average so two-start pitchers don't auto-promote on volume alone)

### By-Day view

Sections per date in the pickup window. Within each section, candidates are filtered to those with a start that day and sorted by **that day's per-start score**. Two-start pitchers naturally appear in both their start-day sections; the section's active date pill gets a primary ring so it reads as "this start" vs. "also pitches another day."

By-day's score column shows the per-day score (not the week sum), and the verdict is the per-start band directly. This is the lens for "best Mon options, best Tue options…" sequencing — pick one per day you want covered.

### Expanded row

Either view, expanding a row stacks `ScoreBreakdownPanel` for each probable start in the window. The panel was originally per-start (single-day model) and is reused unchanged — the `gameRef` and `ppRef` carried on each `PerStartProjection` populate the breakdown context.

### Row tint

Per-start average score drives the row's background tint:
- `≥ 70` → `bg-success/5` (green — favorable)
- `50–69` → no tint (neutral)
- `< 50` → `bg-error/5` (red — rough)

In by-day view, the tint reflects that day's score; in week view, the average across the pitcher's starts.

## Game Plan Card

`src/components/streaming/GamePlanPanel.tsx` is shared between the two tabs (`side: 'batting' | 'pitching'` prop). Renders chase/hold/punt sections grouped by MLBoss's *suggested* focus, with each row showing:

```
[pill] | CAT | values | reason
```

The leftmost cell is a `RowFocusPill` — single-letter chase/punt/neutral toggle, override dot when the user differs from the suggested focus. Clicks cycle `neutral → chase → punt → neutral`. Reset-to-suggested lives in the panel header next to the W/L projected badge.

Section placement follows the *suggestion* (so "MLBoss thinks chase X" stays put); the inline pill reflects the user's *effective* override. The override dot keeps the manual choice legible. This replaces both:

1. The old standalone `CategoryFocusBar` panel (above the board)
2. The old `MatchupPulse` panel (also above the board on the pitcher tab)

Both retired — same data, fewer panels.

### Pitcher-side helper text

When the corrected analysis has resolved (`isCorrected === true`), the pitcher tab Game Plan helper notes: "Counting cats use projection · ratio cats (ERA, WHIP) stay YTD." See [Ratio cats are YTD only](#ratio-cats-are-ytd-only).

## Per-Start Sub-Scores

Sub-scores are produced by `getPitcherRating` (Layer 3, `src/lib/pitching/rating.ts`). Each Yahoo-scored category gets projected from the `GameForecast.expectedPerGame` and normalised against a per-stat league window. The category-to-projection map:

| Sub-score | Projection source (from `GameForecast.expectedPerGame`) | Normalisation window |
|-----------|---------------------------------------------------------|----------------------|
| **QS** | `probabilities.qs` (function of IP and ERA) | 0.10 → 0.70 |
| **K** | `expectedPerGame.k` | 3.5 → 9.0 |
| **W** | `probabilities.w` (talent diff vs opp SP, bullpen, home/away) | 0.20 → 0.65 |
| **ERA** | `expectedERA` | 5.50 → 2.30 (lower is better) |
| **WHIP** | derived from `expectedPerPA.bbPerPA` and `expectedPerPA.baa` | 1.55 → 0.95 (lower is better) |

The week-aggregate engine consumes these per-start sub-scores in two ways: scores are **summed** into `weeklyScore`; counting-cat `expected` values are summed into `byCategory.expectedCount`. Ratio cats record `expectedCount` (numerator) and `expectedDenom` (IP) for completeness but the corrected-margin pipeline ignores them per [Ratio cats are YTD only](#ratio-cats-are-ytd-only).

The canonical talent vector lives in `PitcherTalent` (`src/lib/pitching/talent.ts`) and is consumed by `buildGameForecast` to produce the per-game projections above. See [pitcher-evaluation.md](pitcher-evaluation.md).

### Opposing-starter signal in W

`MLBGame` carries both probables (the schedule pipeline enriches both in lockstep, stamping `pp.talent` on each). `buildGameForecast` reads the opposing pitcher's `PitcherTalent` and uses the talent-vs-talent xwOBA differential to dampen P(W) — facing an ace collapses W odds regardless of how good our guy is.

### Bullpen signal in W

Bullpen quality only feeds the W probability, not the composite. Uses **team staff ERA** (`MLBGame.homeTeam.staffEra` / `awayTeam.staffEra`) as a proxy — overall pitching ERA, not relief-only. Correlates ~0.7 with true bullpen ERA. The contribution is halved before applying to P(W), since the bullpen only pitches ~3 of every 9 innings. Upgrade path: fetch `sitCodes=rp` split if the proxy isn't sharp enough.

### Multipliers

**Composite-level** (applied to the per-start score):

- **Velocity** (year-over-year fastball delta): now informational only — the ±6% asymmetric multiplier was retired when the velo signal moved into the talent-layer regime-shift probe. The display value remains for breakdown transparency.
- **Platoon vulnerability** (weak-side OPS allowed): clean split → +5%, vulnerable → -5%.

**Surface-level** (already in per-cat numbers; shown for breakdown transparency):

- **Park** — feeds per-cat via parkSO (K), parkBB (BB), parkHR with gbRate gating (HR), and overall parkFactor (non-HR contact value).
- **Weather** — folds into HR rate (±8%) and non-HR contact value (±4%) at per-PA. K/BB/SB are weather-independent.
- **Opp lineup** — drives per-cat K rate (log5 against opp K-rate-vs-hand), BB rate (× oppOpsFactor), and contact quality.

The breakdown panel labels these "Context (already in cats above)" so the user doesn't think they were multiplied a second time.

Sample-size handling lives in the talent layer's Bayesian regression. Thin-sample pitchers are pulled toward the prior via the `effectivePA`-weighted blend in `computePitcherTalent`, and the resulting `confidence` cue (`high`/`medium`/`low`) is surfaced in the UI as a label PLUS a numeric ± band on the score (e.g. `62 ± 8`). The score band renders next to the number when ≥ 5 score points; large bands (≥ 10) flag in error tone.

## Ratio cats are YTD only

The corrected pitcher-cat margin (`useCorrectedMatchupAnalysis` → `composeCorrectedRows`) handles **counting cats only** — K, W, QS, IP. Ratio cats (ERA, WHIP, K/9, BB/9 etc.) pass through YTD on the Game Plan margin.

**Why:** projecting forward ERA/WHIP requires blending YTD numerator/denominator with projected numerator/denominator, which in turn requires recovering YTD IP from the scoreboard (most leagues don't score IP as a category). The blender is non-trivial and the failure mode is silent. Per the design discussion: ratio fidelity stays at the per-FA `scorePitcher` per-start view (where the user reads "this guy will torch my WHIP" as a per-start pill), and the matchup-margin Game Plan reads ratio cats as YTD-only. Counting cats — where the projection is mechanical — get the full correction.

This is enforced inside `composeCorrectedRows` so future use sites can't accidentally project ratio cats. The Game Plan Pitching helper text surfaces this asymmetry to the user.

## What lives elsewhere

- **Today page** (`/lineup`, Pitchers tab — `src/components/lineup/TodayPitchers.tsx`) handles the daily sit/start decision for **rostered** pitchers. No streaming logic, pills, composite score, or date strip — those belong here. That page shows Active / Bench / Injured groups with today's matchup context and an expandable score breakdown.
- **Roster page** (`/roster`) handles long-term batter roster construction (`RosterManager`). Pitcher-side roster optimization is follow-up work.
- **BossCard** (dashboard) reads the same `useCorrectedMatchupAnalysis` for the leverage bar — both pages now see counting pitcher cats corrected forward.

## Weather Gotcha

MLB's `weather` hydrate is only populated ~2 hours before first pitch. For future dates, all of `temp`, `condition`, `wind` are null. Without a guard, every card would show a fallback cloud icon and appear "cloudy."

`hasWeatherData(w)` in `src/lib/pitching/display.tsx` returns true iff any of `condition`, `temperature`, `windSpeed` is non-null. The entire weather block is omitted otherwise, which is the normal state for D+1+ until game day.

`weatherIcon(condition)` also returns `null` (not a default icon) when condition is missing, so we never render a placeholder.

## Open follow-ups

- **Sequence planner.** A "Plan" mode that lets the user select 1–2 pickups and shows a coverage strip ("Mon: covered by X, Tue: open, Wed: covered by Y…"). The by-day view today gives the read manually; an explicit planner would close the loop.
- **Persisted focus overrides per league.** Currently the inline-pill override resets per session. Persisting in localStorage keyed on `leagueKey + statId` would make "always punt SV" a one-time setup rather than a per-session re-toggle. Three-state mental model (suggested / overridden / persisted) needs a "Reset all overrides for this league" affordance.
- **CompareTray.** Was per-start-shaped on the prior single-day board; dropped on the week-aggregate rewrite. Reintroducing requires a week-aggregate slot adapter.
- **Pitcher cap awareness.** Some leagues set `max_weekly_innings_pitched` / `max_weekly_games_started`. The hooks (`useLeagueLimits`) exist and BossCard already consumes them; the streaming engine could fold a cap discount into the FA week score. Not currently wired (per design call: leagues without caps don't need it).
