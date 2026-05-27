## MLBoss Engine Index

A registry of every prediction and suggestion engine in the app. This page is a **map**, not the territory — for any engine that already has a detail doc, this page points to it and stops. If a new engine lands in the code and isn't on this page, this page is wrong.

For the principles and anti-patterns that govern this system, see [architecture.md](./architecture.md). For the decision log of patterns we tried and stopped, see [history.md](./history.md).

> Detail docs:
> [`unified-rating-model.md`](./unified-rating-model.md) — L1+L2+L3: talent, forecast, rating engines (both sides), regime probe, calibration anchors.
> [`projection.md`](./projection.md) — L4: team projection, lineup optimizer, slot-aware streaming.
> [`recommendation-system.md`](./recommendation-system.md) — L5: `analyzeMatchup`, focus suggestions, Boss Brief, UI surface map.
> [`roster-strategy.md`](./roster-strategy.md) — L6: league forecast, forward focus, swap strategy.
> [`stat-levels.md`](./stat-levels.md) — the four stat levels (vocabulary used across all engines).
> [`league-baselines.md`](./league-baselines.md) — cross-engine league-mean constants.

---

## Layered architecture

```
        ┌─────────────────────────────────────────────────────────────────┐
        │  L1  Talent          vacuum player skill                         │
        │      └── L2  Forecast    + game context (park / opp / weather)   │
        │              └── L3  Rating    → score per player per game       │
        │                      └── L4  Projection   sum over window        │
        └─────────────────────────────────────────────────────────────────┘
                                       │
                                       ├── feeds focusMap weights ──┐
                                       ▼                            │
        ┌─────────────────────────────────────────────────────────┐ │
        │  L5  Matchup state    standings → chase / hold / punt   │─┘
        │      └── L6  Roster strategy   ROS / matchup vacuum     │
        │              └── L7  Narrative   one-line advice        │
        └─────────────────────────────────────────────────────────┘
```

L1–L4 answer "how good?" L5–L7 answer "what should I do?" `focusMap` is the only line that crosses.

See [architecture.md](./architecture.md#1-two-layers-one-bridge) for why these are two layers with one bridge.

---

## L1 — Talent  →  see [unified-rating-model.md](./unified-rating-model.md)

Vacuum-level player skill. No game context.

- Batter talent model — [src/lib/mlb/talentModel.ts](../src/lib/mlb/talentModel.ts)
- Pitcher talent — [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts)
- Regime-shift probe (`computeRegimeShift`) — [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts)
- Category baselines — [src/lib/mlb/categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts)

## L2 — Forecast  →  see [unified-rating-model.md](./unified-rating-model.md)

Talent × game context. Per-PA and per-game adjustments.

- Pitcher game forecast (`buildGameForecast`) — [src/lib/pitching/forecast.ts](../src/lib/pitching/forecast.ts)
- Reliever week forecast (`buildReliefWeekForecast`) — [src/lib/pitching/forecast.ts](../src/lib/pitching/forecast.ts) — per-week IP/K/BB/HR rollup from `PitcherTalent.role === 'reliever'` signals (`appearancesPerWeek`, `ipPerAppearance`). No per-opponent context; the reliever-appearance mix over a week averages neutral.
- Batter per-PA forecast (`buildBatterForecast`) — [src/lib/mlb/batterForecast.ts](../src/lib/mlb/batterForecast.ts)
- BB compounding penalty (`bbCompoundingPenalty`) — [src/lib/pitching/forecast.ts](../src/lib/pitching/forecast.ts)
- Park adjustment (`getParkAdjustment`) — [src/lib/mlb/parkAdjustment.ts](../src/lib/mlb/parkAdjustment.ts)
- Weather score (`getWeatherScore`) — [src/lib/mlb/analysis.ts](../src/lib/mlb/analysis.ts)
- Batter platoon, per-category (`platoonFactor`) — [src/lib/mlb/platoon.ts](../src/lib/mlb/platoon.ts) — Bayesian regression of the batter's own vs-hand split toward a population component target, weighted by PA on that side; applied per-cat inside `buildBatterForecast`, not a composite multiplier. Replaced the OPS-based composite `getPlatoonAdjustedTalent` (2026-05).
- Matchup context resolver — [src/lib/mlb/matchupContext.ts](../src/lib/mlb/matchupContext.ts)

## L3 — Rating  →  see [unified-rating-model.md](./unified-rating-model.md)

Forecast → per-game score. Both engines return an isomorphic `Rating` shape.

- Batter rating (`getBatterRating`) — [src/lib/mlb/batterRating.ts](../src/lib/mlb/batterRating.ts)
- Pitcher rating (`getPitcherRating`) — [src/lib/pitching/rating.ts](../src/lib/pitching/rating.ts)
- Streaming-board pitcher score (`scorePitcher`) — [src/lib/pitching/scoring.ts](../src/lib/pitching/scoring.ts)
- Roster blended score (`blendedCategoryScore`) — [src/lib/roster/scoring.ts](../src/lib/roster/scoring.ts) (season-long focus, not matchup-driven)

## L4 — Projection  →  see [projection.md](./projection.md)

Sum L3 outputs over a window. No new math.

- Batter team projection (`projectBatterPlayer` / `projectBatterTeam`) — [src/lib/projection/batterTeam.ts](../src/lib/projection/batterTeam.ts)
- Pitcher team projection (`projectPitcherPlayer` / `projectPitcherTeam`) — [src/lib/projection/pitcherTeam.ts](../src/lib/projection/pitcherTeam.ts) — routes by `talent.role`: starters via `projectPitcherPlayer` (per probable-start), relievers via `projectRelieverPlayer` (per-week roll-up from L2 `buildReliefWeekForecast`). Team rollup returns `weeklySpIp` / `weeklyRpIp` / `weeklyIp`.
- Lineup week optimizer (`optimizeWeek`) — [src/lib/lineup/optimizeWeek.ts](../src/lib/lineup/optimizeWeek.ts)
- Pitcher week optimizer (`optimizePitcherWeek`) — [src/lib/lineup/optimizePitcherWeek.ts](../src/lib/lineup/optimizePitcherWeek.ts)
- Slot-aware streaming (`streamingValue` per FA) — [src/lib/projection/slotAware.ts](../src/lib/projection/slotAware.ts)
- Roster depth solver (`assignStarters`) — [src/lib/roster/depth.ts](../src/lib/roster/depth.ts)

## L5 — Matchup state  →  see [recommendation-system.md](./recommendation-system.md)

Standings → category strategy. The bridge layer (reads from L4, writes `focusMap` that L3 reads).

- `analyzeMatchup` — [src/lib/matchup/analysis.ts](../src/lib/matchup/analysis.ts)
- `withSwing` — [src/lib/matchup/analysis.ts](../src/lib/matchup/analysis.ts)
- Corrected matchup analysis (`useCorrectedMatchupAnalysis`) — [src/lib/hooks/useCorrectedMatchupAnalysis.ts](../src/lib/hooks/useCorrectedMatchupAnalysis.ts)
- Suggested focus hook (`useSuggestedFocus`) — [src/lib/hooks/useSuggestedFocus.ts](../src/lib/hooks/useSuggestedFocus.ts)
- Corrected rows (`composeCorrectedRows`) — [src/lib/matchup/correctedRows.ts](../src/lib/matchup/correctedRows.ts)

## L6 — Roster strategy  →  see [roster-strategy.md](./roster-strategy.md)

ROS (rest-of-season) roster construction in a matchup vacuum — talent-only, neutral context, league-wide comparison. Does **not** consume `analyzeMatchup` (that's L5 weekly thinking) and does **not** depend on this week's schedule.

- Neutral-week team projection (`projectBatterTeamNeutral`, `projectPitcherTeamNeutral`) — [src/lib/projection/neutralWeek.ts](../src/lib/projection/neutralWeek.ts)
- League forecast (`computeLeagueForecast`) — [src/lib/league/forecast.ts](../src/lib/league/forecast.ts)
- Replacement Upgrade Per Move (`computeRupm`) — [src/lib/league/rupm.ts](../src/lib/league/rupm.ts)
- Manager-engagement multiplier (`computeTeamEngagements`) — [src/lib/league/engagement.ts](../src/lib/league/engagement.ts)
- Forward focus v2 — batter (`assignFocusForBattingSide`) — [src/lib/league/forwardFocus.ts](../src/lib/league/forwardFocus.ts)
- Forward focus v1 — pitcher (`forwardFocusV1`) — [src/lib/league/forwardFocus.ts](../src/lib/league/forwardFocus.ts)
- Forecast-to-analysis adapter (`forecastToAnalysis`) — [src/lib/league/forwardFocus.ts](../src/lib/league/forwardFocus.ts)
- Position-aware lineup optimizer + move suggestions (`assignStarters`, `generateSwapSuggestions`) — [src/lib/roster/depth.ts](../src/lib/roster/depth.ts)
- Move strategy decorator (`analyzeSwapStrategy`) — [src/lib/league/swapStrategy.ts](../src/lib/league/swapStrategy.ts)

## L7 — Narrative  →  see [recommendation-system.md](./recommendation-system.md)

One-line synthesis. Reads from L5; never picks categories independently.

- Boss Brief (`getBossBrief`) — [src/lib/dashboard/bossBrief.ts](../src/lib/dashboard/bossBrief.ts)
- Lineup issues rules (`LineupIssuesCard`) — [src/components/dashboard/cards/LineupIssuesCard.tsx](../src/components/dashboard/cards/LineupIssuesCard.tsx) (orthogonal: health / eligibility checks, not matchup-state recommendations)

---

## Rules for adding a new engine

Short version. Full version in [architecture.md](./architecture.md#rules-for-adding-a-new-engine).

1. Place it in a layer (L1–L7) before writing code.
2. Read from canonical functions — don't re-implement rating math, category picking, or talent regression.
3. No new math at L4 (projection aggregates L3 outputs; if you need different math, extend L1–L3).
4. Register here in the right layer before opening the PR.
5. Anchor calibration constants to research and follow the calibration discipline in [architecture.md](./architecture.md#rules-for-adding-a-new-calibration-constant).

When you delete or deprecate a canonical engine: add a [history.md](./history.md) entry.
