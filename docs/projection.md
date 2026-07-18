## Projection (L4)

Aggregation of per-game rating outputs over a time window. The window is usually "rest of the matchup week" or "the pickup-playable days." No new math at this layer — every projection engine calls a canonical L3 rating engine ([`getBatterRating`](../src/lib/mlb/batterRating.ts) or [`getPitcherRating`](../src/lib/pitching/rating.ts)) and sums. If the projection disagrees with the per-game score, the per-game score is what we trust.

> See [architecture.md](./architecture.md#3-one-per-game-primitive-summed-over-windows) for why this layer is intentionally math-free.

> **Verified.** The aggregated projections are graded against actuals: `batter-day` (per-day projection vs the day's box line) and `batter-week` (the neutral-week roster substrate vs the following Mon–Sun). `batter-week` is the only engine that grades the *playing-time* half — a day snapshot exists only when the player was already in a lineup. See [forecast-verification.md](./forecast-verification.md).

## The engines

| Engine | File | What it produces | Side |
|---|---|---|---|
| `projectBatterPlayer` | [projection/batterTeam.ts](../src/lib/projection/batterTeam.ts) | Per-player per-day batter ratings, aggregated to weekly per-category expected counts | batter |
| `projectBatterTeam` | [projection/batterTeam.ts](../src/lib/projection/batterTeam.ts) | Team-wide weekly counting-stat totals (sum of `projectBatterPlayer` across active roster) | batter |
| `projectPitcherPlayer` | [projection/pitcherTeam.ts](../src/lib/projection/pitcherTeam.ts) | Per-start ratings aggregated across all probable starts in the pickup window | pitcher (SP) |
| `projectRelieverPlayer` | [projection/pitcherTeam.ts](../src/lib/projection/pitcherTeam.ts) | Per-week rollup of L2 `buildReliefWeekForecast` (expected appearances, IP, K, BB, HR) spread into the per-cat projection map | pitcher (RP) |
| `projectPitcherTeam` | [projection/pitcherTeam.ts](../src/lib/projection/pitcherTeam.ts) | Team-wide pitcher-cat totals — routes by `talent.role`, sums SP + RP into one `byCategory` map and reports separate `weeklySpIp` / `weeklyRpIp` / `weeklyIp` totals | pitcher |
| `slotAware` / `streamingValue` | [projection/slotAware.ts](../src/lib/projection/slotAware.ts) | Per-FA week-long upgrade margin over the user's optimal baseline lineup | batter |
| `optimizeWeek` | [lineup/optimizeWeek.ts](../src/lib/lineup/optimizeWeek.ts) | Per-day lineup-slot assignment for the user's batters over the matchup week | batter |
| `optimizePitcherWeek` | [lineup/optimizePitcherWeek.ts](../src/lib/lineup/optimizePitcherWeek.ts) | Per-day pitcher slot decisions over the matchup week | pitcher |
| `assignStarters` | [roster/depth.ts](../src/lib/roster/depth.ts) | Per-day backtracking solver that assigns roster slots given multi-position eligibility. Called by `optimizeWeek` and `slotAware`. | batter |

## Architecture

Both team-projection sides share a symmetric shape:

```
┌──────────────────────────────────────────┐
│ Per-game primitives  (L3)                │
│   getBatterRating / getPitcherRating     │
└────────────────────┬─────────────────────┘
                     │
   ┌─────────────────┼─────────────────┐
   ▼                 ▼                 ▼
┌─────────┐    ┌──────────┐     ┌─────────────┐
│ Per-    │    │ Team     │     │ Per-FA      │
│ player  │    │ aggregate│     │ week score  │
│ (one ×  │    │ (sum     │     │ (FA pool ×  │
│  N days)│    │  active  │     │  pickup     │
│         │    │  roster) │     │  window)    │
└─────────┘    └──────────┘     └─────────────┘
```

Concrete:

- **Batter side**: `projectBatterPlayer` → `projectBatterTeam` → `useWeekBatterScores`
- **Pitcher side**: `projectPitcherPlayer` → `projectPitcherTeam` → `useWeekPitcherScores`

Both sides emit the same `PerCategoryProjection` row shape (`{ statId, expectedCount, expectedDenom }`) so `composeCorrectedRows` and `useCorrectedMatchupAnalysis` consume both without branching.

## Reuse rules

1. **One per-player primitive per side.** All three consumers (team aggregate, opponent aggregate, per-FA week ranking) call the same `projectBatterPlayer` / `projectPitcherPlayer`. Don't write a parallel "but for the streaming board" version — extend the primitive or wrap it.
2. **One row shape across batter and pitcher.** `PerCategoryProjection` carries a denominator-agnostic `expectedDenom` (AB for batter AVG, IP for pitcher ratio cats). The corrected-rows pipeline uses `expectedDenom` to blend ERA / WHIP with the matchup-to-date scoreboard in mid-week mode and to compute pure-projection ratios in pivot mode — see [streaming-page.md](./streaming-page.md#pitcher-k9--bb9--h9-are-matchup-to-date-only).
3. **No new math.** If you need different math at the projection layer, change the per-game engine instead. This rule is the structural fix for the "projection invents its own talent estimate" failure mode.

## Pickup window

Time-window primitives live in [dashboard/weekRange.ts](../src/lib/dashboard/weekRange.ts):

```typescript
getMatchupWeekDays()      // Mon-Sun for the current matchup; isRemaining flag per day
getStreamingGridDays()    // Always 7 days starting tomorrow (or full next Mon-Sun on Sunday); stable hook order
getPickupPlayableDays()   // Subset of grid actually usable by a pickup made now
```

The pickup window excludes "today" because any pickup made now lands on the roster *tomorrow*. Window length implications for pitcher streaming: Sun/Mon picks see ~7 days (plenty of two-start coverage); Wed picks see ~4 days (at most one start per pitcher). The engines just iterate the window — two-start coverage falls out naturally without special-casing.

## Slot-aware streaming

The team-projection engine answers "what should my team total be?" The slot-aware engine answers a different question: "given my rostered bats and their per-day game schedules, how many starter-points does this FA actually add to my week?"

On a heavy day where 9 of my batters all play, an FA in my lineup means benching one of mine — his contribution is the upgrade margin over the worst current starter that day, or zero if he can't beat any of them. On a light day where only 4 of mine have games, 5 starting slots sit open and any FA fills one for free at full daily score.

**Mechanism:** per remaining day, run `assignStarters` once on my active roster (baseline) and once per FA-with-game (with-FA), take the delta, and sum across days. The result is the streaming value. Multi-position eligibility is handled automatically because `assignStarters` already backtracks across position assignments.

Returns per-day breakdowns alongside the total so the UI can show "starts at 2B" vs "benched" cells.

## How the projection is consumed

| Surface | Hook | Consumer engine | What it shows |
|---|---|---|---|
| Streaming page (batter tab) | `useWeekBatterScores` + slot-aware | `slotAware` per FA | FA rank by week-long upgrade margin over the user's optimal lineup |
| Streaming page (pitcher tab) | `useWeekPitcherScores` | `projectPitcherPlayer` per FA | FA rank by **sum** of per-start rating scores within the pickup window. Summing privileges two-start pitchers |
| Game Plan card (both sides) | `useCorrectedMatchupAnalysis` | `projectBatterTeam` + `projectPitcherTeam` × my + opp | Corrected matchup margin = MTD + projection blend mid-week; pure projection on the Sunday pivot (`targetWeek: 'next'`) |
| Lineup page (Batters tab) | `optimizeWeek` | per-day `assignStarters` | Optimal slot assignment per day for the rest of the matchup week |
| Dashboard | `useCorrectedMatchupAnalysis` | (same as Game Plan) | Leverage bar uses corrected margins |

## Projection API routes

| Endpoint | Hook | Purpose | TTL |
|---|---|---|---|
| `GET /api/projection/batter-team?teamKey=&leagueKey=` | `useBatterTeamProjection` | Forward batter-cat projection for a team across the matchup week's remaining days | 5 min |
| `GET /api/projection/pitcher-team?teamKey=&leagueKey=` | `usePitcherTeamProjection` | Forward pitcher-cat projection (counting cats: K, W, QS, IP) | 5 min |

Both routes filter their input roster (active batters / non-IL pitchers), fan out per-day games via `getGameDay`, and run the corresponding `projectXxxTeam` engine.

The pitcher-team route additionally resolves each rostered pitcher to an MLB ID and computes their full `PitcherTalent` (SP-filtered current+prior season lines from [`getPitcherSeasonLines`](../src/lib/mlb/players.ts), plus overall current+prior lines from [`getPitcherOverallLines`](../src/lib/mlb/players.ts), plus current+prior Savant). Talent is passed on `ActivePitcher.talent` so the engine can dispatch by `role`:
- starters match against probable starters in the day's slate via [`isLikelySamePlayer`](../src/lib/pitching/display.tsx) — pitchers with no probable contribute 0 to the SP path
- relievers go through [`buildReliefWeekForecast`](../src/lib/pitching/forecast.ts) once per pitcher for the remaining-day window

Today's already-concluded games are filtered out of the per-day slate before projection via the shared [`isStartConcluded`](../src/lib/mlb/gameState.ts) helper — otherwise a finished 1pm game double-counts the SP's expected IP against the cap at 7pm.

`useCorrectedMatchupAnalysis` runs four projections in parallel (my + opp × batter + pitcher counting cats), merges the per-cat projection records into one map per side, and hands them to `composeCorrectedRows`. See [recommendation-system.md](./recommendation-system.md) for what happens after.

## Limitations

- **SV / HLD / L are not modeled for relievers.** The L1 reliever signals (`appearancesPerWeek`, `ipPerAppearance`) plus L2 `buildReliefWeekForecast` cover **IP, K, BB, HR (WHIP-numerator)** for relievers, summed into the team projection. Wins, holds, and saves require bullpen role tagging (closer / setup / long man) we don't ingest yet — `projectRelieverPlayer` leaves those at zero. Add when streaming-board reliever ranking lands.
- **K/9 / BB/9 / H/9 stay matchup-to-date-only at the matchup margin.** We don't project these separately; ERA and WHIP do blend (mid-week IP-weighted, or pure-projection on the Sunday pivot). Rate fidelity for the per-9 variants stays at the per-FA per-start view (`scorePitcher`). See [streaming-page.md](./streaming-page.md#pitcher-k9--bb9--h9-are-matchup-to-date-only) for rationale.
- **Team offense for multi-day starts.** Pitcher tab fetches `useTeamOffense` keyed by tomorrow's slate (D+1) team ids. Multi-day starts against teams not on tomorrow's slate degrade the forecast to neutral opp context. Revisit if rankings feel off mid-week.
