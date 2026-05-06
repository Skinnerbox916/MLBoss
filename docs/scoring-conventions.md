# Scoring Conventions

This is the reference for HOW the app turns raw stats into the talent ratings, matchup ratings, and streaming verdicts surfaced in the UI. Read this before adding a new category, tuning a constant, or writing a second function that "estimates how good a player is".

> **Architecture overview:** [unified-rating-model.md](./unified-rating-model.md) — the single canonical reference for both pitcher and batter rating engines. Consult that doc first for the high-level picture; this file covers the calibration knobs and stat-level discipline.

For the data layer (where stats come from, how they're cached, how identity is resolved) see [data-architecture.md](./data-architecture.md). For the matchup layer that decides which categories the user should chase or punt this week, see [recommendation-system.md](./recommendation-system.md). This file covers the player-rating modeling that sits between the two.

## The four stat levels

Every numeric field about a player belongs to one of four levels. Mixing them is the most common source of subtly-wrong scoring code.

| Level | What it is | Example fields | When to read it |
|-------|-----------|----------------|-----------------|
| 1. Raw counting | What the player actually did this season | `current.hr`, `current.pa`, `current.avg` | Tables, season-to-date displays |
| 2. Raw rate | A simple rate from raw counting | `current.hr / current.pa`, `current.runs / current.pa` | Per-PA comparisons that ignore sample size |
| 3. Regressed talent | Rate Bayesian-blended toward league mean / prior season | `talent.xwoba`, `blendedRateForCategory` output | Roster decisions, multi-week projections |
| 4. Matchup-adjusted | Talent rate after applying Log5 + park + pitcher quality + batting order + weather | `getBatterRating` output | Daily lineup decisions, single-game ratings |

Each level requires more inputs than the last. Each level smooths out more noise. Calibration knobs live at every level — see below.

### Naming convention in the codebase

The new `PlayerStatLine` shape (`src/lib/mlb/types.ts`) groups level 1 / 2 / 3 explicitly:

```typescript
interface PlayerStatLine {
  identity: { mlbId; bats };
  current:  PlayerSeasonCounting | null; // level 1+2: this season's counting + native rates
  prior:    PlayerSeasonCounting | null; // level 1+2: previous season
  talent:   PlayerTalent | null;         // level 3: regressed xwoba + components
  statcast: PlayerStatcastSnapshot | null; // level 1: raw current xwoba (for the Quality bonus)
  splits:   PlayerPlatoonSplits | null;  // level 2/3: per-hand OPS (rescaled when thin)
}
```

Level 4 outputs aren't a single field on the line — they're returned by per-call functions like `getBatterRating(stats, ctx)` that take the line plus matchup context.

## One source of truth per concept

The same modeling concept must have exactly one canonical implementation. When two functions answer "how good is this pitcher?" they will drift, and the same pitcher will get different verdicts on different pages. Don't let it happen.

### Current canonical implementations

| Concept | Canonical function | Lives in |
|---------|-------------------|----------|
| Bayesian rate blender | `blendRate(input)` (always returns a value) and `blendRateOrNull(input)` (returns `null` when no current/prior/league input — Savant-secondary use case) | [src/lib/mlb/talentModel.ts](../src/lib/mlb/talentModel.ts) |
| Component talent xwOBA (batter) | `computeBatterTalentXwoba` | talentModel.ts |
| Component talent xwOBA-allowed (pitcher, low-level) | `computePitcherTalentXwobaAllowed` | talentModel.ts |
| Per-category Bayesian baseline | `blendedBaselineForCategory(stats, statId)` | [src/lib/mlb/categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts) |
| Per-category 0-1 normaliser | `normalizeRate(rate, statId, betterIs)` | categoryBaselines.ts |
| Pitcher talent (canonical, context-free) | `computePitcherTalent` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) |
| Talent → xERA conversion | `xwobaToXera` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) |
| Talent → composed xwOBA-allowed (linear weights w/ explicit HR) | `composeXwobaAllowed` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) |
| In-game adjusted xwOBA-allowed (per-PA inputs already park/opp/weather adjusted) | `composeAdjustedXwobaAllowed` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) |
| Talent's non-HR contact value (HR-removed average) | `talentNonHrContactXwoba` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) |
| Talent → BAA proxy | `talentBaa` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) |
| Talent → per-PA HR rate (no park) | `talentHrPerPA` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) |
| Talent → per-PA contact rate | `talentContactRate` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) |
| Talent → SP-perspective xERA / HR / BAA (with null-safe wrappers) | `spExpectedEra` / `spHrPerPA` / `spBaa` | [src/lib/mlb/batterRating.ts](../src/lib/mlb/batterRating.ts) (thin wrappers around the talent.ts primitives) |
| Park-factor adjustment (per-stat, hand-aware, wind-amplified) | `getParkAdjustment` and `formatParkBadge` | [src/lib/mlb/parkAdjustment.ts](../src/lib/mlb/parkAdjustment.ts) — single source of truth for batter and pitcher sides; consumes `parkFactorHrL/HrR`, `parkFactor2B/3B`, `parkFactorBACON`, and `windSensitivity` fields on `ParkData`. Feature code MUST go through this primitive — never read `ParkData` numbers directly for math. |
| Pitcher game forecast (talent + context) | `buildGameForecast` | [src/lib/pitching/forecast.ts](../src/lib/pitching/forecast.ts) |
| Pitcher rating (0-100, tier derived from score) | `getPitcherRating` | [src/lib/pitching/rating.ts](../src/lib/pitching/rating.ts) |
| Pitcher tier classifier | `tierFromScore` (single mapping; never use categorical inputs) | [src/lib/pitching/rating.ts](../src/lib/pitching/rating.ts) |
| Pitcher tier label | `tierLabel` (single function; handles `undefined` for loading state) | [src/lib/pitching/rating.ts](../src/lib/pitching/rating.ts) |
| Free-agent / roster → probable-starter name match | `isLikelySamePlayer` | [src/lib/pitching/display.tsx](../src/lib/pitching/display.tsx) |
| Streaming-page composite rating (UI-shaped wrapper) | `scorePitcher` | [src/lib/pitching/scoring.ts](../src/lib/pitching/scoring.ts) |
| Batter matchup rating (level 4) | `getBatterRating` | [src/lib/mlb/batterRating.ts](../src/lib/mlb/batterRating.ts) |
| Unified matchup context (both engines) | `MatchupContext` | [src/lib/mlb/matchupContext.ts](../src/lib/mlb/matchupContext.ts) |
| Unified rating shape (both engines) | `Rating` discriminated union | [src/lib/rating/types.ts](../src/lib/rating/types.ts) |
| Single breakdown panel (consumes Rating) | `ScoreBreakdownPanel` | [src/components/shared/ScoreBreakdownPanel.tsx](../src/components/shared/ScoreBreakdownPanel.tsx) |
| Single compare tray (engine-agnostic) | `CompareTray` (over `CompareTraySlot[]`) | [src/components/shared/CompareTray.tsx](../src/components/shared/CompareTray.tsx) |
| Roster talent score (multi-week) | `blendedCategoryScore` | [src/lib/roster/scoring.ts](../src/lib/roster/scoring.ts) |
| Playing-time factor | `playingTimeFactor` | roster/scoring.ts |
| League-pace reference (full-time benchmark) | `estimateFullTimePaceRef` / `estimateFullTimeGpRef` | roster/scoring.ts |

### What "no second implementation" looks like

Adding a parameter is fine. Adding a wrapper that adapts the inputs is fine. Returning a richer shape from the canonical function is fine.

What's NOT fine:

- A new function in a different file that does the same Bayesian blend with subtly different defaults
- A `_v2` variant introduced "just for this page"
- Inlining the math at the call site

If you find yourself wanting to do any of the above, push the customisation into the canonical function as an option. The Bayesian blender duplication (`blendRate` vs the legacy `blendSavant`) was resolved in Phase 4b: `blendRateOrNull` wraps `blendRate` with the "all-empty → null" semantics Savant secondaries needed, and `blendSavant` is gone. The pitcher-evaluation rebuild (Phase 4d) consolidated the previous fork between `classifyPitcherTier` (rule-based) and `pitcherTalentScore` (RV/100-based) into a single three-layer pipeline (`PitcherTalent` → `GameForecast` → `PitcherRating`). The tier label now derives from the rating score via a single `tierFromScore` function — there is no separate tier classifier any more, and the Montero-style "ace by one rule, fair by another" inconsistency is structurally impossible. See [pitcher-evaluation.md](pitcher-evaluation.md).

The 2026-05-04 cleanup eliminated three more drift hazards that survived Phase 4d:
1. Three inlined `xwobaToXera` copies (forecast.ts, batterRating.ts, display.tsx) with two different slopes (5.0 vs canonical 25). Caused the "Max Meyer Bad in his own card / ace in Painter's risk summary" inversion. Now lives once in talent.ts; consumers import and re-derive.
2. Three name matchers (free-agent, roster, today-page) using last-name-only comparison. Caused two same-surname players on the same team (Lopez / Ureña) to both attach to the probable starter. Replaced with a single `isLikelySamePlayer(a, b)` requiring full match OR last + first-initial.
3. Duplicated tier label / tier color / TIER_LABEL mappings between rating.ts and scoring.ts. Consolidated to a single `tierLabel` in rating.ts (re-exported through scoring.ts) and a single `tierColor` in display.tsx.

The 2026-05 unified-rating overhaul fixed the math integration (see [unified-rating-model.md](./unified-rating-model.md)) and structurally enforced the per-PA-vs-composite distinction:

1. **`composeXwobaAllowed` carries HR explicitly** via FanGraphs linear weights (BB·0.69 + nonHrContact·nonHrXwoba + HR·1.97). Before, HR was implicitly inside `contactXwoba`, and per-game HR-park scaling never propagated to `expectedERA`. Now park HR (gb-gated), opp, and weather all flow into ERA via the chain.
2. **Park / opp / weather live at the per-PA layer.** The composite formula on the pitcher side multiplies only `× velocity × platoon`. Pre-fix, K and BB got park hits twice (per-PA AND composite), ERA only got the composite hit. Architecture rule documented in `pitching/rating.ts`: composite multipliers are matchup-wide signals only.
3. **`gbRate` is now wired into HR-park.** A 60%-GB arm gets half the parkHR bump; a 30%-GB arm gets the full bump. Was dead in the math layer pre-fix despite being computed.
4. **Confidence band on the score.** Both engines surface a numeric ± uncertainty alongside the high/medium/low label. Renders as `62 ± 8` in the UI when band ≥ 5 score points.
5. **One `MatchupContext`, one `Rating`.** Replaced parallel batter/pitcher context shapes with a single discriminated context. Replaced disjoint rating shapes with a unified `Rating` consumed by one `ScoreBreakdownPanel` and one `CompareTray`.

## Calibration knobs

Constants you can tune. Categorised by blast radius.

### Wide blast radius (rebalances most ratings)

These touch every player on every page. Change carefully and document why.

| Knob | File | What it controls |
|------|------|------------------|
| `LEAGUE_K_RATE`, `LEAGUE_BB_RATE`, `LEAGUE_XWOBACON` | talentModel.ts | League-mean priors for the three components of the talent xwOBA model |
| `K_PRIOR_PA`, `BB_PRIOR_PA`, `XWOBACON_PRIOR_BIP` | talentModel.ts | Per-component regression strength (higher = pulls harder toward league mean) |
| `CATEGORY_BASELINE_CONFIG[*].leagueMean` | categoryBaselines.ts | Per-category league-mean rate |
| `CATEGORY_BASELINE_CONFIG[*].leaguePriorN` | categoryBaselines.ts | Per-category regression strength |
| `CATEGORY_BASELINE_CONFIG[*].normRange` | categoryBaselines.ts | (floor, elite) for 0-1 normalisation — sets the "what counts as elite" threshold |

### Medium blast radius (changes the shape of one signal)

These tune one bonus / penalty inside one rating function.

| Knob | File | What it controls |
|------|------|------------------|
| `QUALITY_WEIGHT_FACTOR` | roster/scoring.ts | How much the Statcast Quality bonus contributes vs categories |
| `RISING_WEIGHT_FACTOR` | roster/scoring.ts | How much the Rising bonus contributes |
| `CHASE_WEIGHT` | roster/scoring.ts | How much a "chased" category over-weights |
| `QUALITY_BIP_GATE`, `QUALITY_BIP_FULL_WEIGHT` | roster/scoring.ts | When the current-year Statcast bonus engages and saturates |
| `RISING_DELTA_FLOOR`, `RISING_DELTA_CEIL` | roster/scoring.ts | wOBA delta band that earns the Rising bonus |
| `tierFromScore` thresholds (78/62/42/28) | pitching/rating.ts | Score boundaries between `ace`/`tough`/`average`/`weak`/`bad` tiers |
| `PA_FULL_TRUST` | pitching/talent.ts | Effective PA at which the talent regression places no weight on league prior |
| `xwobaToXera` slope/intercept | pitching/talent.ts | Linear xwOBA-allowed → xERA conversion (anchored to league avg). Single canonical home — do **not** redefine in feature modules |
| `composeXwobaAllowed`, `talentBaa`, `talentHrPerPA`, `talentContactRate` | pitching/talent.ts | Pure functions on the `PitcherTalent` vector. Same single-canonical-home rule — drift here causes batter and pitcher ratings to disagree about the same SP |
| `LEAGUE_OPS` | pitching/talent.ts | League-avg team OPS, used as anchor for forecast-layer game-context multipliers (opp / platoon) |
| `REGIME_SD_K`, `REGIME_SD_BB`, `REGIME_SD_WHIFF`, `REGIME_SD_BARREL`, `REGIME_SD_VELO` | pitching/talent.ts | Per-metric Y-Y noise bands for the regime-shift probe. A current-vs-prior delta divided by these SDs gives the z-score that drives prior-cap shrinkage |
| `REGIME_SIGNIFICANT_Z` (0.8) | pitching/talent.ts | Threshold for a metric's z-score to count toward the regime score. Below this, the metric is treated as noise. Lowering this widens the population that gets regime-shrunk; raising it makes regime detection require larger swings |
| `regimeShiftToShrink` slope (0.4) and floor (0.25) | pitching/talent.ts | Map from \|regime-score\| to prior-cap multiplier. The floor prevents prior weight from collapsing entirely; the slope controls how aggressively co-directional leading indicators reduce prior weight. League prior gets `sqrt(shrink)` (less aggressive collapse — population norms stay as a softer anchor) |
| `bbCompoundingPenalty` slope (10) and cap (1.0 ERA) | pitching/forecast.ts | Additive ERA penalty for BB% above league mean (.085). Captures runner-stacking damage that xwOBA's linear weights miss. Calibrated against the empirical BB%-vs-(ERA−xERA) relationship in MLB starter data |

### Local blast radius (one matchup factor)

These tweak a single contributor inside `getBatterRating` / `getPitcherRating` and rarely need attention.

- Park-factor track clamps and field-selection logic (`getParkAdjustment` in parkAdjustment.ts) — the per-stat band (HR `[0.7, 1.4]`, AVG `[0.85, 1.15]`, R/RBI `[0.80, 1.20]`, composite `[0.90, 1.10]`) and the wind-amplification ±5% bump
- Per-park raw factor values (parks.ts) — refreshed from Baseball Savant's Statcast 3-year rolling window
- Batting-order multipliers (batterRating.ts)
- Weather adjustment thresholds (batterRating.ts)
- Platoon-rescaling sample-size gate (`MIN_HAND_PA = 50` in players.ts)

If a knob isn't listed here, it's local-blast or implementation detail.

## Common pitfalls

- **Reading `current.xwoba` to score talent.** `current.*` is RAW counting — there's no `xwoba` on it. Talent xwOBA lives at `line.talent.xwoba` (level 3) and is the Bayesian-regressed value. The unregressed current-year Statcast snapshot (level 1) lives at `line.statcast.xwobaCurrent` and is for the Quality bonus only — never use it as a talent estimate.
- **Comparing across stat levels.** A level-1 raw HR count and a level-3 regressed HR rate are not comparable. The category-rank UIs always work at level 3 (regressed rates) for cross-player comparability.
- **Hardcoding stat IDs in display code.** Add the stat to `CATEGORY_BASELINE_CONFIG` so the regression pipeline picks it up automatically. UI maps that hardcode `statId -> field accessor` (e.g. `BATTER_STAT_MAP` in `RosterManager.tsx`) read from `PlayerStatLine.current` so they stay aligned with the data layer.
- **Adding a "just for this page" pitcher score.** Don't. Use the canonical scorer and add a parameter if needed.
- **Tuning `leagueMean` to fix one player.** League means are calibrated against a season's worth of data. If one player's rating looks wrong, the issue is almost always at the medium-blast level (sample-size gates, bonus weights), not the league mean.

## Migration-era gotchas (Phase 4 learnings)

These are non-obvious rules that came out of the Data Layer Foundation migration. They aren't bugs — they're contracts that the code currently relies on.

- **Scoring engines accept either `PlayerStatLine` or `BatterSeasonStats`.** `getBatterRating`, `roster/scoring.ts`'s blended scorers, and `categoryBaselines.ts`'s baseline computers all run an internal `asBatterStats(input)` shim that adapts the new stratified shape to the legacy flat one before doing math. Page code passes `PlayerStatLine`; the shim is invisible at the call site. Don't add a third shape.
- **`toBatterSeasonStats` is internal-only now.** It survives Phase 4 because the scoring engines' native shape is still `BatterSeasonStats` — rewriting the per-category baseline pipeline + analysis-layer platoon helpers to read directly from `PlayerStatLine` would have churned hundreds of lines without changing behaviour. Treat it as an implementation detail of the scoring engines, not as a public adapter for app code. New code should never call it.
- **Talent xwOBA luck-arrows compare `talent.xwoba` to `talent.woba`, not to `statcast.xwobaCurrent`.** The talent-vs-production gap is the meaningful UI signal. Comparing regressed talent to actual wOBA is intentional — comparing raw current-year xwOBA to actual wOBA would just surface single-month noise.
- **`current` and `prior` are independently nullable.** UI code that reads `line.current?.ops` should fall back to `line.prior?.ops` so IL'd players still render meaningful rows. The Phase 1c prior-year fallback in `getRosterSeasonStats` exists precisely so this fallback always has data to read.
- **Scoring functions should never call into the source layer.** The polymorphic shim above is the model layer's only concession to the legacy flat shape — it never refetches anything. If a scoring function needs more data, the orchestrator (`getRosterSeasonStats` etc.) should fetch it and pass it in, not import a fetcher.
