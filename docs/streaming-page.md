## Streaming Page

Page-specific concerns for `/streaming` — Yahoo pagination quirks, free-agent matching, the Game Plan card, and weather/waiver edge cases. This doc does **not** describe the rating math (see [unified-rating-model.md](./unified-rating-model.md)) or the projection aggregation (see [projection.md](./projection.md)) or the matchup-state layer (see [recommendation-system.md](./recommendation-system.md)) — it covers what's true *here* and nowhere else.

## What the page is

`/streaming` is MLBoss's dedicated pickup tool — pitchers and batters in tabs. It is **not** a daily lineup surface; daily pitcher sit/start lives on the Today page (`/lineup`, Pitchers tab). Streaming is about rotating through the ~6 moves-per-week budget on the 1-2 bench slots that rotate, with visibility multiple days ahead.

Entry point: [src/components/streaming/StreamingManager.tsx](../src/components/streaming/StreamingManager.tsx). Mounted at [src/app/streaming/page.tsx](../src/app/streaming/page.tsx).

Two tabs:

- **Pitchers** — multi-day probable starts ranked by week-aggregate projected output. The two-start bias falls out of the math: a 2-start streamer sums two per-start scores, naturally outranking single-start pitchers of equal per-start quality.
- **Batters** — rest-of-week batter pickups ranked by slot-aware streaming value against a corrected matchup margin.

Both tabs share a top-level [GamePlanPanel](../src/components/shared/GamePlanPanel.tsx) (per side) that contains the chase/hold/punt grouping and inline focus pills. There is no longer a standalone `CategoryFocusBar` or `MatchupPulse` on this page — both retired in favor of the Game Plan view; see [history.md](./history.md#2026-05--streaming-page-matchuppulse-and-categoryfocusbar-retired).

The pitcher tab additionally leads with a [`VolumeGap`](../src/components/streaming/VolumeGap.tsx) panel above the Game Plan — the "should I stream?" question that comes before "which streamer?" See [Volume Gap panel](#volume-gap-panel) below.

## Pickup window

Both tabs operate over the same time horizon: the **pickup-playable window**. Any pickup made now lands on a roster *tomorrow*, so today is excluded from value calculations. Window primitives live in [dashboard/weekRange.ts](../src/lib/dashboard/weekRange.ts); see [projection.md](./projection.md#pickup-window).

Implications for pitcher streaming:

- Sun/Mon picks see ~7 days — plenty of two-start coverage.
- Wed picks see ~4 days — at most one start per pitcher.

The engine just iterates the window; two-start coverage falls out naturally.

## Sunday pivot

On Sunday the current matchup is closed for streaming purposes — any pickup lands on next week's roster and contributes only to next week's matchup. The streaming page pivots the entire upper UI (Volume Gap, Game Plan chase/hold/punt, opponent label, W/L projection) to describe **next week** instead of the closing one. The streaming grid and per-FA week scores already point at next Mon–Sun via [`getStreamingGridDays`](../src/lib/dashboard/weekRange.ts), so the pivot brings the matchup framing into alignment.

Vocabulary: a `WeekTarget = 'current' | 'next'` flows from [`StreamingManager`](../src/components/streaming/StreamingManager.tsx) through every consumer (analysis hook, projection hooks, panels). The Sunday rule itself lives in one place — `isSundayPivot()` in [weekRange.ts](../src/lib/dashboard/weekRange.ts) — and is consulted by both `StreamingManager` (to derive the target) and the streaming-grid helpers (to roll the date strip).

Mechanism — one canonical hook, one option, two explicit modes:

- [`useCorrectedMatchupAnalysis`](../src/lib/hooks/useCorrectedMatchupAnalysis.ts) accepts `opts.targetWeek: WeekTarget`. When `'next'`, the hook:
  - Routes both projection fetches to `?targetWeek=next` on `/api/projection/{batter,pitcher}-team`; the routes call `getWeekDays(now, 'next')` to project next Mon–Sun.
  - Fetches next-week scoreboard solely to resolve the next-week opponent (stat values for a not-yet-started week are not load-bearing here).
  - Calls [`composeCorrectedRows`](../src/lib/matchup/correctedRows.ts) in **`mode: 'projection-only'`** — a dedicated code path that writes pure-projection values for every projectable cat and passes un-projectable rows (K/9, BB/9, H/9) through unchanged. No MTD blending math is invoked; the rate-blend formulas in `blendAvg` / `blendPitcherRatio` are not on this path at all.
  - Passes empty maps to `buildMatchupRows` (every base row is em-dash) and lets the projection-only mode overwrite each with its corrected value. Em-dash rows that lack a projection are filtered out of consuming panels via `rowHasComparablePair`.
  - Skips `withSwing` — there is no MTD baseline to swing from. Rows lack `rawMargin` / `rawMyVal` / `rawOppVal`, so consumer tiles render the projected value with no "before → after" arrow.
  - Passes `daysElapsed = 0` to `analyzeMatchup`, which softens rate-stat confidence (correct — pure-projection ERA/WHIP shouldn't read as locked).

**Why not a parallel hook?** Same engine, same row shape, same focus vocabulary — only the time window differs. Per [architecture.md](./architecture.md#2-single-source-of-truth-per-concept), parameterize the canonical engine; don't fork it.

**Why an explicit projection-only mode?** An earlier iteration synthesized 0/0 MTD maps and relied on `blendAvg` / `blendPitcherRatio` reducing to pure projection when the MTD denominator was zero. That was an emergent property of the formulas, not a contract — any future tuning of the blenders (a regularization term, a floor on `elapsedShare`, etc.) would have silently corrupted pivot-mode rate stats. The explicit mode in `composeCorrectedRows` makes pure-projection a first-class path with its own helpers (`buildCountingCorrectedRow`, `buildAvgCorrectedRow`, `buildPitcherRatioCorrectedRow`), reused by both modes for formatting and the winning-flag computation.

## Yahoo free-agent pitcher pagination

A non-obvious quirk of Yahoo's player-listing endpoint. `getAvailablePitchers` in [src/lib/fantasy/players.ts](../src/lib/fantasy/players.ts) issues four queries instead of one consolidated `status=A`:

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

**Why split FA/W:** the row-level `ownership` block is empty on this endpoint — `;out=ownership` is silently ignored — so we can't tell from a row whether the player is on waivers. The only signal is *the query they came from*. Querying `status=W` separately and tagging at the merge layer is how we know which players to gate. See [yahoo-api-reference.md](./yahoo-api-reference.md) for the underlying quirk.

## Waiver pool is hidden

Pitchers tagged `ownership_type === 'waivers'` are dropped from the streaming board entirely. This is intentionally conservative: Yahoo doesn't expose a per-player `waiver_date` on the player-listing endpoint, so we can't surface a player on dates ≥ their clear date.

**Upgrade path** for date-aware waiver gating: cross-reference `/league/{key}/transactions` for each waiver player's drop timestamp with the league's waiver-period setting from `/league/{key}/settings` to compute the clear date, and revert the board filter to `waiver_date > date → skip`.

## Free-agent → probable-starter matching

`projectPitcherPlayer` uses `isLikelySamePlayer` (in [pitching/display.tsx](../src/lib/pitching/display.tsx)) to cross-reference a Yahoo FA against the day's probable pitchers. Same matcher used by:

- `matchFreeAgentToGame` (single-start FA matcher, kept for back-compat)
- `matchProbableStarts` (rostered-pitcher matcher in `probableMatch.ts`)

See [history.md](./history.md#2026-05--islikelysameplayer-consolidation) for the consolidation that created the single matcher.

### Team abbreviation aliasing

The single canonical alias table is in [teamAbbr.ts](../src/lib/mlb/teamAbbr.ts) — every cross-source matcher (Yahoo↔MLB FA matching, MLB↔ESPN scoreboard splice in `schedule.ts`) reads from it. Centralizing here closes the drift hazard that previously caused PIT @ ARI's probable starter to silently disappear when only one of two duplicate tables had the AZ/ARI entry.

```typescript
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
    .replace(/[̀-ͯ]/g, '')      // strip diacritics (Peña → Pena)
    .toLowerCase()
    .replace(/[.,']/g, '')                 // strip punctuation (J.T. → JT, O'Neill → ONeill)
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, '') // strip suffixes
    .trim();
}
```

Match priority:
1. Team abbreviation match (after canonicalization)
2. Either:
   - Full normalized name equality, OR
   - Normalized last name equality **AND** first-initial agreement

The first-initial gate stops same-team-same-surname collisions (Lopez × 2, Ureña × 2). Last-name-only matching attached the probable starter's projection to BOTH players, surfacing two streamers for one game.

**Future improvement:** if we ever sync Yahoo `player_id` ↔ MLB `id`, this name-based matching becomes unnecessary.

## Data pipeline

| Source | Hook | Endpoint | TTL | What it gives us |
|---|---|---|---|---|
| Yahoo free agents | `useAvailablePitchers` | `/api/fantasy/players` | 5 min | Eligible FA/waiver pitchers with `editorial_team_abbr`, `ownership_type`, `image_url` |
| MLB schedule (per day, ×7) | `useGameDay(date)` | `/api/mlb/game-day` | 5 min | Probable starters (with talent stamped), venue, park, weather, lineups |
| MLB team offense | `useTeamOffense(teamIds)` | `/api/mlb/team-offense` | 1 hour | Season batting + vs-LHP/RHP splits |
| League pitching categories | `useLeagueCategories` + `useScoreboard` | `/api/fantasy/*` | 10 min / 1 min | Drives the Game Plan Panel chase/hold/punt grouping |
| Pitcher-team projections (mine + opp) | `usePitcherTeamProjection` | `/api/projection/pitcher-team` | 5 min | Counting-cat projections that feed `useCorrectedMatchupAnalysis` |

The fan-out happens in `useWeekPitcherScores`: seven `useGameDay` calls (stable hook order; SWR de-dupes), then per-FA `projectPitcherPlayer` over the playable window. The FA pool is filtered to those with at least one probable start; pitchers with zero starts in the window are dropped before reaching the board.

### Team-offense lookup approximation

The pitcher tab fetches `useTeamOffense` keyed by tomorrow's slate (D+1) team ids — usually 28-30 teams when all play. Multi-day starts against teams not on tomorrow's slate degrade the forecast to neutral opp context. The trade is simpler wiring vs. fetching team offense for the union across the 7-day grid; revisit if rankings feel off mid-week.

## Streaming Board

[StreamingBoard.tsx](../src/components/streaming/StreamingBoard.tsx) renders the ranked candidate list. Two view modes via the segmented toggle in the panel header.

### Week view (default)

One row per pitcher with at least one probable start in the window, ranked by `projection.weeklyScore` descending. Each row shows:

- Header line: name, throwing-hand pill, tier label, team/position, two-start badge if `expectedStarts >= 2`, waiver badge if applicable
- **Day pills**: a chip per probable start (`MON @ ARI 65` shape) — color-coded by per-start score (success ≥70, neutral 50-69, error <50)
- Aggregated category strip (per-cat fit averaged across starts)
- Score column: the **summed** weekly score + Strong/Fair/Avoid verdict (verdict is computed from per-start average so two-start pitchers don't auto-promote on volume alone)

### By-Day view

Sections per date in the pickup window. Within each section, candidates are filtered to those with a start that day and sorted by **that day's per-start score**. Two-start pitchers naturally appear in both their start-day sections; the section's active date pill gets a primary ring so it reads as "this start" vs "also pitches another day."

By-day's score column shows the per-day score (not the week sum), and the verdict is the per-start band directly. This is the lens for "best Mon options, best Tue options…" sequencing — pick one per day you want covered.

### Expanded row

Either view, expanding a row stacks `ScoreBreakdownPanel` for each probable start in the window. The panel was originally per-start (single-day model) and is reused unchanged — the `gameRef` and `ppRef` carried on each `PerStartProjection` populate the breakdown context.

### Row tint

Per-start average score drives the row's background tint:

- `≥ 70` → `bg-success/5` (green — favorable)
- `50–69` → no tint (neutral)
- `< 50` → `bg-error/5` (red — rough)

In by-day view, the tint reflects that day's score; in week view, the average across the pitcher's starts.

## Volume Gap panel

The pitcher tab leads with a "Stream this week?" panel that answers the volume decision: given my rotation's remaining starts and the opponent's, am I projected to fall behind on the counting stats (IP / K / W / QS)? If yes, streaming is worth doing; the Game Plan below answers WHICH streamer.

Lives in [`VolumeGap.tsx`](../src/components/streaming/VolumeGap.tsx). No new engine — reads:

- **Matchup-to-date (MTD) totals** from the scoreboard stats map (same `userTeam.stats` source BossCard uses). Empty in pivot mode — `myProj` / `oppProj` carry the full picture.
- **Remaining projections** from `useCorrectedMatchupAnalysis`'s `myPitcherProjection` / `oppPitcherProjection` — already loaded for the Game Plan below, so this panel adds no extra fetch.
- **Cap headroom** from `useLeagueLimits` via the shared [`CapPill`](../src/components/shared/CapPill.tsx) (extracted from BossCard's `WeekProgress`; same visual grammar in both places).

Layout: standard box-score-style transposed table. Categories across (IP / K / W / QS), sides down (You / Opp / Gap), gap as the punchline row. YOU row uses accent tone (same "me=accent" convention BossCard uses). Verdict band above the table is the headline; the table is the supporting detail. `Panel`'s `helper` prop carries the "Projected end-of-week totals" framing so users don't mistake these for matchup-to-date scoreboard numbers.

Verdict heuristic:

| Condition | Tone | Copy |
|---|---|---|
| GS or IP cap reached | error | "X cap reached — no room to stream this week." |
| 0 counting cats projected behind | success | "Pace looks fine — streaming is optional." |
| 1-2 cats behind | accent | "Behind on \<labels\> — stream selectively." |
| 3-4 cats behind | error | "Behind on N of 4 counting cats — stream aggressively." |

The "behind" threshold is per-cat: 1.0 IP/K, 0.5 W/QS. Half-unit deadband on small-magnitude cats so a tied projection doesn't read as a contested chase.

## Game Plan Card

[GamePlanPanel.tsx](../src/components/shared/GamePlanPanel.tsx) is shared between the two tabs (`side: 'batting' | 'pitching'` prop). Renders chase/hold/punt sections grouped by MLBoss's *suggested* focus, with each row showing:

```
[pill] | CAT | values | reason
```

The leftmost cell is a [`FocusSegmentedControl`](../src/components/shared/focusPanel.tsx) — chase/neutral/punt toggle with an override dot when the user differs from the suggested focus. Clicks cycle `neutral → chase → punt → neutral`. Reset-to-suggested lives in the panel header next to the W/L projected badge.

**Section placement uses the always-jump rule** — defined in [`focusPanel`](../src/components/shared/focusPanel.tsx) as `deriveFocusSection`. Each row places by the user's *effective* focus (`focusMap[statId]`). When the user toggles a tile to PUNT, the tile moves immediately. The override dot on the segmented control still surfaces "engine disagreed" for transparency, but layout reflects the user's decision.

`focusMap` defaults to the engine's suggestion (via `useSuggestedFocus`, which composes as `{...suggested, ...overrides}`), so untouched cats still appear in the engine-suggested section — only manual overrides cause a jump. The chrome itself (`FocusSectionTrio`, `FocusSegmentedControl`, `FocusResetButton`) is shared with `RosterFocusPanel` so behavior is identical across the Lineup, Streaming, and Roster pages.

The previous hybrid rule — signal-bearing rows stayed where the engine put them, no-signal rows placed by user focus — preserved a stable "MLBoss thinks X" reading anchor but left manual overrides visually disconnected from the rows they clicked on. The always-jump rule trades that anchor for direct UX (what you click is where it goes).

### Pitcher-side helper text

When the corrected analysis has resolved (`isCorrected === true`), the pitcher tab Game Plan helper varies by `targetWeek`: mid-week describes the MTD-plus-projection blend; pivot mode describes the pure-projection outlook. See [Pitcher K/9 / BB/9 / H/9 are matchup-to-date only](#pitcher-k9--bb9--h9-are-matchup-to-date-only).

## Pitcher K/9 / BB/9 / H/9 are matchup-to-date only

In the blend mode of the corrected matchup margin: **counting pitcher cats** (K, W, QS, IP) get rest-of-week projection treatment; **ERA and WHIP** also blend (IP-weighted recovery from the scoreboard); **K/9, BB/9, H/9** pass through unchanged so `rawMargin === margin` and `swing === 0` for them.

The reason: we don't project K/9 / BB/9 / H/9 separately. Ratio fidelity for those stays at the per-FA `scorePitcher` per-start view — where the user reads "this guy will torch my K/9" as a per-start pill — rather than risk wrong rate stats in the matchup margin.

**Sunday-pivot path.** Projection-only mode skips the MTD blend entirely. ERA and WHIP get pure-projection values (`projected ER / projected IP × 9`, `projected (H+BB) / projected IP`). K/9 / BB/9 / H/9 still aren't projected, so their rows pass through em-dash and are filtered out of the panel — no synthetic rate-cat row.

For batter AVG, the blend works in mid-week (batters' AB is recoverable from H / AVG) and reduces to a clean projected AVG in pivot mode (`projected H / projected AB`). See [recommendation-system.md](./recommendation-system.md) for the matchup-margin engine details.

## What lives elsewhere

- **Today page** ([TodayPitchers.tsx](../src/components/lineup/TodayPitchers.tsx)) handles the daily sit/start decision for **rostered** pitchers. No streaming logic, pills, composite score, or date strip — those belong here.
- **Roster page** (`/roster`) handles long-term batter roster construction. Pitcher-side roster optimization is follow-up work.
- **BossCard** (dashboard) reads the same `useCorrectedMatchupAnalysis` for the leverage bar — both pages see counting pitcher cats corrected forward.
- Rating internals (per-start sub-score windows, opposing-pitcher signal in P(W), bullpen signal, composite vs surface multipliers, BB compounding penalty) → [unified-rating-model.md](./unified-rating-model.md).
- Projection aggregation (per-player, team, slot-aware) → [projection.md](./projection.md).
- Matchup-state recommendation engine → [recommendation-system.md](./recommendation-system.md).

## Weather gotcha

MLB's `weather` hydrate is only populated ~2 hours before first pitch. For future dates, all of `temp`, `condition`, `wind` are null. Without a guard, every card would show a fallback cloud icon and appear "cloudy."

`hasWeatherData(w)` in [pitching/display.tsx](../src/lib/pitching/display.tsx) returns true iff any of `condition`, `temperature`, `windSpeed` is non-null. The entire weather block is omitted otherwise, which is the normal state for D+1+ until game day.

`weatherIcon(condition)` also returns `null` (not a default icon) when condition is missing, so we never render a placeholder.

## Open follow-ups

- **Sequence planner.** A "Plan" mode that lets the user select 1–2 pickups and shows a coverage strip ("Mon: covered by X, Tue: open, Wed: covered by Y…"). The by-day view today gives the read manually; an explicit planner would close the loop.
- **Persisted focus overrides per league.** Currently the inline-pill override resets per session. Persisting in localStorage keyed on `leagueKey + statId` would make "always punt SV" a one-time setup rather than a per-session re-toggle.
- **Pitcher cap awareness.** Some leagues set `max_weekly_innings_pitched` / `max_weekly_games_started`. The hooks (`useLeagueLimits`) exist and BossCard already consumes them; the streaming engine could fold a cap discount into the FA week score. Not currently wired (per design call: leagues without caps don't need it).
