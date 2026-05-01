# Recommendation System

This is the reference for HOW the app turns matchup state into user-facing advice — "Chase X", "Cruising in Y", "Coin-flip week", focus bar defaults, the rail's "chase me" highlight, and the leverage bar fill. Read this before adding a new advice surface, before tuning a category-priority threshold, or before writing a second function that decides "which categories matter this week".

For the player-level layer (how good is THIS player) see [scoring-conventions.md](./scoring-conventions.md). This file covers the matchup layer that sits on top of those ratings.

## The two layers

The app evaluates fantasy decisions at two distinct levels. Different concepts, different docs, different engines.

| Layer | Question it answers | Canonical engine | Doc |
|-------|---------------------|------------------|-----|
| Player rating | "How good is THIS player against THIS matchup?" | `getBatterRating`, `getPitcherRating`, `blendedCategoryScore` | [scoring-conventions.md](./scoring-conventions.md) |
| Matchup recommendation | "Which CATEGORIES should I be fighting for this week?" | `analyzeMatchup` | this file |

Mixing the layers is a category error. A "great" batter rating doesn't tell the user whether they need more runs; a "chase HR" recommendation doesn't tell them which OF to play. The two layers connect through `focusMap`: `analyzeMatchup` recommends per-category focus, and the rating engines weight their per-category sub-scores by that focus. That's the only connection — the recommendation layer never re-implements rating math.

## Single source of truth: `analyzeMatchup`

[src/lib/matchup/analysis.ts](../src/lib/matchup/analysis.ts) is the only place that decides what the matchup state implies for each category. Every advice surface that picks categories or assigns chase/punt MUST consume `MatchupAnalysis`. No exceptions.

This is a hard rule because we already learned the cost of breaking it: Boss Brief used to roll its own category picker (`pickWinningCats` / `pickLosingCats` + a hardcoded `if winning ≥2 batter cats AND losing HR/SB/R/RBI then chase` rule), which produced "Chase SB" while the focus bar above showed SB as `neutral`. The user saw two engines disagreeing about the same category in the same view. Don't let that happen again.

If you need a new signal that doesn't exist on `MatchupAnalysis` today, extend the engine. Don't compute it locally and don't add a parallel category picker.

## Architecture

```mermaid
flowchart TD
  Score[useScoreboard] --> Build[buildMatchupRows]
  Cats[useLeagueCategories] --> Build
  Build --> Analyze["analyzeMatchup<br/>(matchup state per category)"]
  Week[getMatchupWeekDays] --> Analyze
  WrapperHook["useMatchupAnalysis<br/>(plumbing wrapper)"] --> Analyze

  Analyze --> Brief[Boss Brief]
  Analyze --> FocusBar[useSuggestedFocus]
  Analyze --> Highlight[CategoryRail highlight]
  Analyze --> Lever[LeverageBar]

  FocusBar --> BatterRating[getBatterRating]
  FocusBar --> PitcherRating[getPitcherRating]

  BatterRating --> TodayBatters[Today batter tab]
  PitcherRating --> TodayPitchers[Today pitcher tab]
  PitcherRating --> Streaming[Streaming page]

  RosterFocus["Roster page focusMap<br/>(localStorage)"] -.intentionally separate.-> RosterScoring[blendedCategoryScore]
```

## Engine catalog

| Engine | Lives in | Inputs | Outputs |
|--------|----------|--------|---------|
| `analyzeMatchup` | [src/lib/matchup/analysis.ts](../src/lib/matchup/analysis.ts) | `MatchupRow[]`, `daysElapsed` | Per-row `margin` ∈ [-1, +1], `priority`, `suggestedFocus`; aggregate `leverage`, `contestedCount`, `lockedCount` |
| `useMatchupAnalysis` | [src/lib/hooks/useMatchupAnalysis.ts](../src/lib/hooks/useMatchupAnalysis.ts) | `leagueKey`, `teamKey` | `{ analysis, isLoading }` — wraps scoreboard + categories + week-progress assembly |
| `useSuggestedFocus` | [src/lib/hooks/useSuggestedFocus.ts](../src/lib/hooks/useSuggestedFocus.ts) | `MatchupAnalysis`, `(statId) => boolean` predicate | `{ focusMap, suggestedFocusMap, toggle, reset, hasOverrides }` — analysis-driven defaults plus user override layer |
| `getBossBrief` | [src/lib/dashboard/bossBrief.ts](../src/lib/dashboard/bossBrief.ts) | `MatchupAnalysis`, probables, league limits, used IP/GS | One-line tactical narrative with optional CTA |
| `LineupIssuesCard` rules | [src/components/dashboard/cards/LineupIssuesCard.tsx](../src/components/dashboard/cards/LineupIssuesCard.tsx) | Roster + lineup state | Health / eligibility / IL-slot issues. Orthogonal to matchup state — these rules answer "is your lineup mechanically broken", not "what should you chase" |

The rating engines (`getBatterRating`, `getPitcherRating`, `blendedCategoryScore`) are documented separately in [scoring-conventions.md](./scoring-conventions.md). They consume `focusMap` produced by this layer; they do not produce category recommendations.

## UI surface map

| Surface | Component | Engine read | Notes |
|---------|-----------|-------------|-------|
| Boss Brief one-liner | [BossCard/BossBrief.tsx](../src/components/dashboard/BossCard/BossBrief.tsx) | `getBossBrief` | Picks "cruising in" cats from locked wins, "chase" cats from contested losses |
| Leverage bar | [BossCard/LeverageBar.tsx](../src/components/dashboard/BossCard/LeverageBar.tsx) | `analysis.leverage` | Magnitude-aware bar fill |
| Category rail tiles | [BossCard/CategoryRail.tsx](../src/components/dashboard/BossCard/CategoryRail.tsx) | Yahoo W/L per row | Color-codes raw win/loss |
| Category rail highlight dot | [BossCard/index.tsx](../src/components/dashboard/BossCard/index.tsx) computes, rail renders | `analysis.rows` priority | "Most contested losing cat" — same priority signal that powers `chase` suggestions |
| Today batter focus bar | [LineupManager.tsx](../src/components/lineup/LineupManager.tsx) | `useSuggestedFocus` over batter cats | User overrides via pill toggle |
| Today pitcher focus bar | [TodayPitchers.tsx](../src/components/lineup/TodayPitchers.tsx) | `useSuggestedFocus` over pitcher cats | Mirrors streaming focus bar |
| Streaming focus bar | [StreamingManager.tsx](../src/components/streaming/StreamingManager.tsx) | `useSuggestedFocus` over pitcher cats | |
| Matchup pulse tiles | [shared/MatchupPulse.tsx](../src/components/shared/MatchupPulse.tsx) | Raw W/L | Informational. Coexists with the leverage bar — they answer different questions ("how many cats" vs "how solid is the lead") |

## Thresholds

All recommendation-layer thresholds live in [src/lib/matchup/analysis.ts](../src/lib/matchup/analysis.ts). If you change one, search the codebase to make sure no UI is hardcoding a duplicate.

| Constant | Value | What it controls |
|----------|-------|------------------|
| `LOCKED_THRESHOLD` | `0.7` | `\|margin\|` ≥ this → `suggestedFocus = punt` (locked either way) |
| `CONTESTED_THRESHOLD` | `0.4` | `\|margin\|` < this → `suggestedFocus = chase` (close enough to fight for) |
| `RATE_SCALE` | per-stat table | Typical-swing scale per rate stat (AVG 0.040, ERA 0.50, etc.). Margin = `gap × dir / scale × confidence` |

`suggestedFocus` falls out of those two thresholds:

```text
|margin| ≥ 0.7  → punt   (locked win or out of reach)
|margin| < 0.4  → chase  (contested)
otherwise       → neutral
hasData = false → neutral
```

The same vocabulary (`chase | neutral | punt`) is what `getBatterRating` and `getPitcherRating` consume via `focusMap`. Punt = 0 weight, chase = 2× weight, neutral = 1× weight (renormalized). See [scoring-conventions.md](./scoring-conventions.md).

## Intentional divergence: roster-page focus

The roster page ([src/components/roster/RosterManager.tsx](../src/components/roster/RosterManager.tsx)) intentionally does NOT consume `analyzeMatchup`. Its `focusMap` is persisted in localStorage and reflects the user's season-long category strategy. The reasoning:

- Today / Streaming answer **"what should I do this week?"** — analyzeMatchup is the right input.
- Roster answers **"which players are worth holding all season?"** — a single hot week shouldn't move the needle.

Same vocabulary, same focusMap shape, different defaults. By design. Both paths feed the same rating engines so the math is consistent; only the source of the focus picks differs.

If you find yourself wanting to merge them, push back. They're decisions on different time horizons and conflating them weakens both.

## Rules for adding a new advice surface

1. **Read from `MatchupAnalysis`.** Use `useMatchupAnalysis(leagueKey, teamKey)` if you're in a component, or accept a `MatchupAnalysis` prop if you're a pure helper.
2. **Don't pick categories with new logic.** "What's the closest losing cat" / "what's most locked" / "what's contested" — they're already on `analysis.rows` as `priority`, `margin`, `suggestedFocus`. Sort and slice.
3. **Don't introduce parallel thresholds.** If you need a different cutoff, prove the existing ones won't work, then change `analyze.ts` constants and update everyone at once. Threshold drift is the bug we're explicitly defending against.
4. **Domain-specific rules are OK if they're clearly orthogonal.** Boss Brief's "ERA/WHIP bleeding with starts left" rule is one — it's a structural problem with a specific corrective action (stream a safe arm), not a generic "lose by margin X" claim. Document why a domain rule isn't replaceable by analysis priority before keeping it.
5. **Update this doc and the UI surface map** when you add the surface.

## Known cross-surface co-existence rules

These are deliberate and not bugs. Documented so they're not "fixed" by accident.

- **MatchupPulse vs LeverageBar.** Pulse shows raw W/L tiles; leverage bar shows margin-weighted fill. Both can be on screen at once — they answer different questions. Don't try to make the leverage bar agree with raw W/L counts.
- **Yahoo W/L coloring vs analysis-driven highlight.** The category rail tiles are colored by Yahoo's raw W/L; the highlight dot uses `analysis.priority`. The colors say "are you winning or losing?", the dot says "which one is most worth fighting for?" Both signals, different questions.
- **Category fit thresholds in pitcher breakdown.** [src/lib/pitching/display.tsx](../src/lib/pitching/display.tsx) `categoryFit` uses 0.65 / 0.40 to color the per-stat strips inside the pitcher score breakdown. These are display thresholds for sub-scores within `getPitcherRating`, not category-recommendation thresholds. They live in the rating layer; touching them does not touch this layer.
