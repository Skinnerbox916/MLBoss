## MLBoss Engine Index

A registry of every prediction and suggestion engine in the app. This page is a **map**, not the territory — for any engine that already has a detail doc, this page points to it and stops. If a new engine lands in the code and isn't on this page, this page is wrong.

For the principles and anti-patterns that govern this system, see [architecture.md](./architecture.md). For the decision log of patterns we tried and stopped, see [history.md](./history.md).

**These engines are graded.** L1–L4 forecasts are snapshotted before games and scored against actual MLB results by the forecast ledger — pitcher starts, batter days, and the roster page's batter-week substrate, plus both points boards. Before tuning any engine below, read its scorecard at `/admin/forecast`; when you change a calibration constant, bump `MODEL_VERSION` so the before/after stays legible. Full loop and the finding-shape → constants-file map: [forecast-verification.md](./forecast-verification.md). The ledger is a verification layer, not an engine — it never feeds a prediction, so it has no L-number here.

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
                                       ├── feeds categoryWeights ──┐
                                       ▼                            │
        ┌─────────────────────────────────────────────────────────┐ │
        │  L5  Matchup state    standings → chase / hold / punt   │─┘
        │      └── L6  Roster strategy   ROS / matchup vacuum     │
        │              └── L7  Narrative   one-line advice        │
        └─────────────────────────────────────────────────────────┘
```

L1–L4 answer "how good?" L5–L7 answer "what should I do?" `categoryWeights` (per-cat numeric weight, 0 = conceded) is the only line that crosses.

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

## L4 — Projection  →  see [projection.md](./projection.md)

Sum L3 outputs over a window. No new math.

- Batter team projection (`projectBatterPlayer` / `projectBatterTeam`) — [src/lib/projection/batterTeam.ts](../src/lib/projection/batterTeam.ts)
- Pitcher team projection (`projectPitcherPlayer` / `projectPitcherTeam`) — [src/lib/projection/pitcherTeam.ts](../src/lib/projection/pitcherTeam.ts) — routes by `talent.role`: starters via `projectPitcherPlayer` (per probable-start), relievers via `projectRelieverPlayer` (per-week roll-up from L2 `buildReliefWeekForecast`). Team rollup returns `weeklySpIp` / `weeklyRpIp` / `weeklyIp`.
- Lineup week optimizer (`optimizeWeek`) — [src/lib/lineup/optimizeWeek.ts](../src/lib/lineup/optimizeWeek.ts)
- Pitcher week optimizer (`optimizePitcherWeek`) — [src/lib/lineup/optimizePitcherWeek.ts](../src/lib/lineup/optimizePitcherWeek.ts)
- Slot-aware streaming (`streamingValue` per FA) — [src/lib/projection/slotAware.ts](../src/lib/projection/slotAware.ts)
- Roster depth solver (`assignStarters`) — [src/lib/roster/depth.ts](../src/lib/roster/depth.ts)

## L5 — Matchup state  →  see [recommendation-system.md](./recommendation-system.md)

Standings → category strategy. The bridge layer (reads from L4, writes `categoryWeights` that L3 reads).

- `analyzeMatchup` — [src/lib/matchup/analysis.ts](../src/lib/matchup/analysis.ts)
- `withSwing` — [src/lib/matchup/analysis.ts](../src/lib/matchup/analysis.ts)
- Endgame sit plan (`computeSitPlan`, per-bat `computeBatterSitValue`) — [src/lib/lineup/sitValue.ts](../src/lib/lineup/sitValue.ts) — today-only bench decisions to flip a losing K/AVG race; arms only when every counting cat is decided and the locks survive the benches. See [history.md](./history.md) "2026-06 — Endgame rewrite of auto-sit".
- Corrected matchup analysis (`useCorrectedMatchupAnalysis`) — [src/lib/hooks/useCorrectedMatchupAnalysis.ts](../src/lib/hooks/useCorrectedMatchupAnalysis.ts)
- Corrected rows (`composeCorrectedRows`) — [src/lib/matchup/correctedRows.ts](../src/lib/matchup/correctedRows.ts)

## L6 — Roster strategy  →  see [roster-strategy.md](./roster-strategy.md)

ROS (rest-of-season) roster construction in a matchup vacuum — talent-only, neutral context, league-wide comparison. Does **not** consume `analyzeMatchup` (that's L5 weekly thinking) and does **not** depend on this week's schedule.

- Neutral-week team projection (`projectBatterTeamNeutral`, `projectPitcherTeamNeutral`) — [src/lib/projection/neutralWeek.ts](../src/lib/projection/neutralWeek.ts) — pitcher side covers SP and RP, including SV from observed save pace (see [roster-strategy.md#saves](./roster-strategy.md#saves))
- League forecast (`computeLeagueForecast`) — [src/lib/league/forecast.ts](../src/lib/league/forecast.ts)
- Replacement Upgrade Per Move (`computeRupm`) — [src/lib/league/rupm.ts](../src/lib/league/rupm.ts)
- Manager-engagement multiplier (`computeTeamEngagements`) — [src/lib/league/engagement.ts](../src/lib/league/engagement.ts)
- Roster value (`computeCategoryLeverage`, `playerContributions`, `playerRosterValue`) — [src/lib/league/rosterValue.ts](../src/lib/league/rosterValue.ts) — leverage = pivotality on RUPM moves-from-a-winning-rank (z for pitchers pending pitcher RUPM); value = leverage-weighted per-cat contributions in move units. Replaced forward focus v1/v2 + `blendedCategoryScore` (2026-07, see history.md)
- Leverage hook (`useRosterCategoryWeights`) — [src/lib/hooks/useRosterCategoryWeights.ts](../src/lib/hooks/useRosterCategoryWeights.ts) — L6 mirror of `useCategoryWeights`: concede/contest overrides over computed leverage
- Playing-time factor (`playingTimeFactor`) — [src/lib/roster/playingTime.ts](../src/lib/roster/playingTime.ts) — role share applied to per-player value lines + RUPM inputs in the forecast route
- Position-aware lineup optimizer + move suggestions (`assignStarters`, `generateSwapSuggestions`) — [src/lib/roster/depth.ts](../src/lib/roster/depth.ts)
- Move strategy decorator (`analyzeSwapStrategy`) — [src/lib/league/swapStrategy.ts](../src/lib/league/swapStrategy.ts) — per-cat move-unit deltas annotated by leverage status

## L7 — Narrative  →  see [recommendation-system.md](./recommendation-system.md)

One-line synthesis. Reads from L5; never picks categories independently.

- Boss Brief (`getBossBrief`) — [src/lib/dashboard/bossBrief.ts](../src/lib/dashboard/bossBrief.ts)
- Lineup issues rules (`LineupIssuesCard`) — [src/components/dashboard/cards/LineupIssuesCard.tsx](../src/components/dashboard/cards/LineupIssuesCard.tsx) (orthogonal: health / eligibility checks, not matchup-state recommendations)

---

## Points-league engines (`src/lib/points/`)

Points leagues swap the category machinery (L3 ratings, L5 matchup state, leverage) for one currency — expected fantasy points — while reusing the L1 talent substrate and the shared volume/optimizer primitives. Detail doc: [points-leagues.md](./points-leagues.md).

- Per-event rate vectors (`batterPointsRateVector`, `pitcherPointsRateVector`) — [src/lib/points/rateVector.ts](../src/lib/points/rateVector.ts) — L1-analog: per-PA / per-IP event rates dotted with the league's `ScoringProfile.weights`. 2B/3B/HBP are per-player regressed rates (categoryBaselines 10/11/20) with TB-decomposition / league-anchor fallbacks (2026-07)
- Talent-neutral value (`batterPointsValue`, `pitcherPointsValue`) — [src/lib/points/pointsValue.ts](../src/lib/points/pointsValue.ts) — rate × role-typical weekly volume (mirrors `neutralWeek.ts` constants) × role share (`playingTimeFactor`, applied by `analyzeTeam` across roster + FA pool)
- Schedule volume (`resolveBatterVolume`, `resolvePitcherStartVolume`, `resolveReliefVolume`) — [src/lib/points/schedule.ts](../src/lib/points/schedule.ts) — L2-analog: games / probable starts / relief pace over a day window
- Horizon forecast (`forecastBatterPoints`, `forecastPitcherPoints`) — [src/lib/points/forecast.ts](../src/lib/points/forecast.ts) — L4-analog: rate × resolved volume, no new math
- Daily lineup optimizer (`optimizePointsLineup`) — [src/lib/points/lineupOptimizer.ts](../src/lib/points/lineupOptimizer.ts) — reuses the shared Hungarian `optimizeLineup` with a points day-score
- Week write-optimizer (`optimizePointsWeek`, `optimizePointsWeekly`) — [src/lib/points/optimizeWeek.ts](../src/lib/points/optimizeWeek.ts) — server-side optimize + Yahoo write; daily cadence loops remaining days, weekly cadence does one week-sum solve written for next Monday
- Replacement / VOR (`replacementByPosition`, `valueOverReplacement`) — [src/lib/points/replacement.ts](../src/lib/points/replacement.ts) — L6-analog: 3rd-best-FA floor per position
- Suggested swaps (`recommendSwaps`) — [src/lib/points/moves.ts](../src/lib/points/moves.ts) — greedy drop → add upgrades by weekly gain; **pitchers-only** since 2026-07 (batter moves route through the shared position-aware `generateSwapSuggestions` in roster/depth.ts, fed pts/wk — see [points-leagues.md](./points-leagues.md))
- Team analysis orchestrator (`analyzePointsTeam`) — [src/lib/points/analyzeTeam.ts](../src/lib/points/analyzeTeam.ts) — the projection-FACTS entry point behind `/api/points/team` (rows with per-stat point contributions, VOR, pitcher moves)
- Roster strategy builder (`buildPointsRosterStrategy` / `usePointsRosterStrategy`) — [src/lib/points/rosterStrategy.ts](../src/lib/points/rosterStrategy.ts) — CLIENT-side: shared position-aware depth/swaps over the analysis facts + the user's depth targets (facts/preferences boundary, same as the categories page)
- Roster week projection (`projectRosterWeek`) — [src/lib/points/rosterWeek.ts](../src/lib/points/rosterWeek.ts) — the ONE "what does this batting lineup score over a window" engine: optimal batting lineup solved per day and summed (daily cadence) or once for the locked week (weekly), position/off-day/injury aware. Injected day scorer (caller prices the batter-day). Batting only — pitchers priced separately by probable starts. Consumed by `analyzeTeam` (week projection) AND `analyzePointsStreaming` (coverage strip + marginal bases). Replaced a top-K-by-slot approximation in `analyzeTeam` — see [history.md](./history.md).
- Streaming analysis (`analyzePointsStreaming`) — [src/lib/points/streaming.ts](../src/lib/points/streaming.ts) — per-day slot coverage (via the lineup optimizer), FA pitcher starts ranked by matchup-adjusted expected points, FA bats ranked by exact marginal lineup gain; cadence-aware (daily plug window vs weekly locked-lineup next-week window); also ships per-player projection FACTS (`batterFacts` day values, `myPitcherFacts` priced rostered starts) for the client week-moves engine; behind `/api/points/streaming`. See [streaming-page.md](./streaming-page.md#points-league-view).
- Week moves (`buildPointsWeekMoves` / `usePointsWeekMoves`) — [src/lib/points/weekMoves.ts](../src/lib/points/weekMoves.ts) — CLIENT-side unified moves board behind the points /streaming page and the dashboard's top-move tile: joint add/drop lineup marginals over the streaming day-value facts, drops suggested only from the VOR churn pool (points-team facts), session-plan conditional re-pricing in a memo (facts/preferences boundary, same as rosterStrategy). See [points-leagues.md](./points-leagues.md#week-moves).
- Points Boss Brief (`getPointsBrief`) — [src/lib/points/brief.ts](../src/lib/points/brief.ts) — L7-analog of `getBossBrief`: one tactical line for the points dashboard marquee from live score + both sides' projected remaining (opponent side priced by `analyzePointsTeam` with `includeFA=false`); thresholds normalized to remaining volume, H2H only (the marquee renders a season variant itself)
- Matchup-adjusted points rates (`adjustedBatterPointsPerPA`, `adjustedPitcherStartPoints`, `meanTeamOffense`) — [src/lib/points/matchupAdjust.ts](../src/lib/points/matchupAdjust.ts) — L2-analog, the designed swap-in day scorer. NO new matchup math: batters re-dot the canonical `buildBatterForecast` adjusted rates (park / platoon / opp staff / weather) with the league weights; pitchers apply the `buildGameForecast` context-vs-neutral RATIO to the talent-anchored per-start baseline, with the neutral twin anchored to the slate-mean offense (the static `teams.ts` league anchors are calibrated for the relative 0–100 scale, not absolute points — a stale anchor showed up as a +12% systematic pitcher boost before the slate-mean fix).

Matchup-adjustment boundary (deliberate): applied ONLY to day/week lineup-decision scorers — lineup day scores (`analyzeTeam` / `optimizeWeek` / client `lineupScoring`), streaming coverage / plugs / per-start stream points. Roster-construction values (`weeklyPoints`, VOR, `thisWeekPoints`, suggested season swaps) stay talent-neutral, matching the roster page's matchup-vacuum philosophy: park context tells you who to START this week, not who to OWN.

---

## Rules for adding a new engine

Short version. Full version in [architecture.md](./architecture.md#rules-for-adding-a-new-engine).

1. Place it in a layer (L1–L7) before writing code.
2. Read from canonical functions — don't re-implement rating math, category picking, or talent regression.
3. No new math at L4 (projection aggregates L3 outputs; if you need different math, extend L1–L3).
4. Register here in the right layer before opening the PR.
5. Anchor calibration constants to research and follow the calibration discipline in [architecture.md](./architecture.md#rules-for-adding-a-new-calibration-constant).

When you delete or deprecate a canonical engine: add a [history.md](./history.md) entry.
