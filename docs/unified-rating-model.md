# Unified Rating Model — Pitcher and Batter

The single canonical reference for how MLBoss predicts player performance in a specific game. Both the streaming page (pitcher pickups) and the lineup tools (batter sit/start, pitcher sit/start) consume the same architecture: one shared substrate of math primitives, two parallel rating engines, one `Rating` shape returned to the UI, one breakdown panel for display.

> Companion docs:
> [`scoring-conventions.md`](./scoring-conventions.md) — stat levels and calibration knobs.
> [`recommendation-system.md`](./recommendation-system.md) — the matchup-state layer that produces `focusMap`.
> [`streaming-page.md`](./streaming-page.md) — streaming-page UI internals.
> [`pitcher-evaluation.md`](./pitcher-evaluation.md) — pitcher-side three-layer pipeline (`PitcherTalent` → `GameForecast` → `PitcherRating`); historical context preserved there.

---

## Architecture

```
                            ┌─── SHARED SUBSTRATE ───┐
                            │  pitching/talent.ts:   │
                            │   composeXwobaAllowed  │
                            │   composeAdjustedXwoba │
                            │   talentNonHrContact   │
                            │   xwobaToXera          │
                            │   talentBaa            │
                            │   talentHrPerPA        │
                            │   talentContactRate    │
                            │  mlb/parkAdjustment.ts │
                            │  mlb/analysis.ts:      │
                            │   getWeatherScore      │
                            │   getPlatoonAdjusted   │
                            │   getFormTrend         │
                            │  mlb/categoryBaselines │
                            │  pitching/display.tsx: │
                            │   isLikelySamePlayer   │
                            └────────────┬───────────┘
                                         │
                              MatchupContext (single shape)
                                game, isHome, asPitcher,
                                asBatter, opposingPitcher
                                         │
                          ┌──────────────┴──────────────┐
                          ▼                             ▼
                BatterRating (per-cat              GameForecast (per-PA
                log5 / multipliers)                values w/ park, opp,
                          │                       weather, gbRate gating)
                          │                             │
                          │                             ▼
                          │                       PitcherRating
                          │                       (per-cat windows)
                          │                             │
                          └──────────────┬──────────────┘
                                         │
                                Rating { score, scoreBand, tier,
                                  categories[], composite multipliers,
                                  surface multipliers, confidence }
                                         │
                                         ▼
                              ScoreBreakdownPanel (one component)
                              CompareTray (one component)
                              VerdictStack (score ± band)
```

## The two engines, one architecture

### Layered separation of concerns

**Per-PA / per-cat layer.** Every stat-specific signal lives here. Different stats respond to a stadium differently — Coors suppresses K (parkSO 90) and inflates HR (parkHR 107) and inflates contact value (overall PF 112). A composite-level park multiplier flattens those distinctions and double-counts. So:

- **Pitcher side** (`buildGameForecast`):
  - `kPerPA` ← log5(talent.kPerPA, opp K-rate-vs-hand) × parkSO
  - `bbPerPA` ← talent.bbPerPA × oppOpsFactor × parkBB
  - `hrPerPA` ← talent.hrPerPA × **gb-gated** parkHR × weather
  - `nonHrContactValue` ← talent.nonHrXwoba × oppOpsFactor × parkOverall × weather
  - `xwobaAllowed` ← linear-weights composition (BB·0.69 + nonHrContact·nonHrXwoba + HR·1.97)
  - `expectedERA` ← `xwobaToXera(xwobaAllowed)` — now park/opp/weather aware end-to-end.
- **Batter side** (`getBatterRating` → `applyMatchupModifier`):
  - AVG cat ← log5(talent.avg, SP BAA) × parkAVG
  - K cat ← log5(talent.K%, SP K%) × parkSO
  - HR cat ← talent.HR-rate × SP HR-prone factor × parkHR × weather
  - R cat ← talent.R-rate × SP xERA × parkR × staffERA × battingOrderMod × weather
  - RBI cat ← talent.RBI-rate × SP xERA × parkR × battingOrderMod × weather
  - SB cat ← talent.SB-rate × hand bump
  - BB cat ← talent.BB-rate × parkBB

**Composite layer.** Only matchup-wide signals that genuinely scale every category proportionally:
- **Pitcher:** platoon (the SP's weak-handed side stack vs this lineup). Velocity moved out of the composite layer into the talent-layer regime probe (2026-05) — keeping it both places double-counted.
- **Batter:** platoon (this batter vs this SP's hand, regressed), opportunity (PA count from batting order).

**Surface layer.** Park, weather, opp lineup quality. These are computed and shown in the breakdown UI so the user can see WHY their per-cat numbers landed where they did. They are NOT applied to the composite — already in the per-cat numbers.

### Why this matters

Pre-2026-05 the pitcher side multiplied the composite by `× park × weather × opp` AND the per-cat layer applied parkSO/parkBB. K and BB sub-scores took a park hit twice; ERA and WHIP only got the composite hit. Worse, HR-park scaling in `expectedHR` never propagated to `expectedERA` because `xwobaAllowed = bb·0.69 + contact·contactXwoba` didn't carry HR explicitly. Coors flyball pitchers had inflated HR projections with talent-only ERA.

The new architecture (this doc):
1. HR is explicit in the linear-weights composition. Park HR / gbRate / weather all flow into ERA via the chain.
2. K and BB get exactly one park hit (per-PA layer). Composite no longer multiplies again.
3. Opp and weather are per-cat too — the K cat doesn't get a "wind-out" boost (correct: wind doesn't help K rate).
4. The composite layer is principled: only matchup-wide signals.

## The `Rating` shape

Both engines return an isomorphic shape, distinguished by an `engine` discriminator (in `src/lib/rating/types.ts`):

```ts
interface RatingBase {
  score: number;        // 0-100, 50 = neutral
  scoreBand: number;    // ± uncertainty in score points
  netVsNeutral: number; // score - 50
  categories: CategoryContribution[];
  composite: { multipliers: Record<string, ContextMultiplier> };
  surface: { park, weather, opp: ContextMultiplier };
  confidence: { level: 'high'|'medium'|'low'; reason; band };
}

type Rating =
  | (RatingBase & { engine: 'pitcher'; tier: PitcherTier })
  | (RatingBase & { engine: 'batter';  tier: BatterTier });
```

Per-engine tier vocabularies (pitcher: ace/tough/avg/weak/bad; batter: great/good/neutral/poor/bad) acknowledge that "ace" carries pitcher-specific meaning that "great" wouldn't capture. Tier is **always** derived from `score` via a single classifier per engine — no separate rule-based tier system.

> The current implementation still carries the multipliers as named fields on `PitcherRating` (`velocity`, `platoon`, `park`, `weather`, `opp`) for back-compat with the streaming UI. The composite/surface distinction is enforced by *which fields the composite formula multiplies* — as of 2026-05, only `platoon`. Velocity is informational only (its `multiplier` is pinned at 1.0); YoY velo delta now feeds the talent-layer regime probe instead. Park/weather/opp are surface-only and documented as such on the type. A future refactor can collapse the named fields into the discriminated `composite.multipliers + surface` blocks.

## The `MatchupContext` shape

Both engines consume `MatchupContext` (in `src/lib/mlb/matchupContext.ts`):

```ts
interface MatchupContext {
  game: EnrichedGame;          // park enriched here
  isHome: boolean;
  opposingPitcher: ProbablePitcher | null;
  asPitcher: { talent: PitcherTalent; opposingOffense: TeamOffense | null } | null;
  asBatter: { hand: 'L'|'R'|'S'|null; battingOrder: number | null } | null;
}
```

Replaced the old separate `MatchupContext` (batter side) and `BuildForecastArgs` (pitcher side) — same idea, two shapes. `game.park` is the canonical park field; feature code does NOT read `ctx.park` (removed) and does NOT read `ParkData.parkFactor*` directly anywhere — all park lookups go through `getParkAdjustment` or `formatParkBadge`.

## Edge case helpers

These are subtle pieces of the system that the user should know live where they live and serve the purposes they serve.

### Math layer (feeds rating)

| Helper | Where | Purpose |
|--------|-------|---------|
| `composeXwobaAllowed` | `pitching/talent.ts` | Talent-only xwOBA-allowed using FanGraphs linear weights with **explicit HR**. Drives `expectedERA` once the forecast layer adjusts inputs. |
| `composeAdjustedXwobaAllowed` | `pitching/talent.ts` | Same composition but takes pre-adjusted in-game per-PA rates. Used by `buildGameForecast`. |
| `talentNonHrContactXwoba` | `pitching/talent.ts` | Backs out non-HR contact value from `talent.contactXwoba` (HR-inclusive average). Lets HR scale separately at the forecast layer. |
| `getParkAdjustment` | `mlb/parkAdjustment.ts` | Single primitive for "given park + stat + hand + weather, what multiplier?". Per-stat tracks (HR, SO, BB, RUNS, OVERALL, 2B, 3B). Wind amplification fires only in `windSensitivity: 'high'` parks (Wrigley/Oracle/Sutter Health). Switch-hitter resolution by opposing pitcher hand. **Defensive**: missing factor fields fall back to neutral 100, never NaN. |
| `formatParkBadge` | `mlb/parkAdjustment.ts` | Single helper for the park badge — picks the more-extreme of overall PF vs HR PF. Both StreamingBoard and TodayPitchers consume this; no inline `parkFactor*` reads in feature code. |
| `gbBoost` (in `forecast.ts`) | `pitching/forecast.ts` | Gates park HR effect by ground-ball rate. A 60%-GB arm gets half the HR-park bump; a 30%-GB arm gets the full bump. The single best predictor of HR-park insulation. |
| `computeRegimeShift` | `pitching/talent.ts` | **Holistic prior-cap shrinkage.** Detects when current-season leading indicators (K%, BB%, whiff%, barrel%, velo) move *together* vs prior — evidence of a regime change (decline, breakout, role swap, injury return). Returns a signed score that scales the prior-season cap from 1.0 (preserve) down to 0.25 (heavy current-side weight). Replaces the previous `computeSosMultiplier` sample-shrinking, which had the wrong direction for declining pitchers facing weak lineups (it pulled them *toward* their better prior, inflating the estimate). The probe handles both Montero (skills flat → prior preserved → contact-quality outlier regressed) and the inverse Houser case (K%+barrel% co-decline → prior collapses → estimate moves toward current). |
| `getPlatoonAdjustedTalent` | `mlb/analysis.ts` | Hand-asymmetric Bayesian regression of split OPS toward population norms. Priors: RHB-vs-LHP=2200 PA (very slow), RHB-vs-RHP=700 PA (fast), LHB-vs-LHP=1000 PA, LHB-vs-RHP=500 PA, switch=500. The dominant-hand-faster asymmetry comes straight from FanGraphs platoon-skill research. |
| `getWeatherScore` | `mlb/analysis.ts` | 0-1 scalar of weather offense friendliness. 0.5 = neutral. Wind out + warm = 1.0; wind in + cold = 0.0. Domes return 0.5. Folded into per-cat weather factors on both sides. |
| `weatherCatFactor` (in `batterRating.ts`) | `mlb/batterRating.ts` | Per-cat weather adjustment: HR ±8%, R/RBI ±4%, H/TB ±2%, K/BB/SB unchanged. Mirrors the pitcher-side `weatherHrFactor` / `weatherContactFactor` for symmetry. |

### Display-only (don't feed rating)

These helpers exist to surface signals to the user without folding them into the math layer — typically because the talent regression already absorbs the underlying signal.

| Helper | Where | Why display-only |
|--------|-------|------------------|
| `getFormTrend` | `mlb/analysis.ts` | Surfaces "Raking", "Producing", "Steady", "Scuffling", "Struggling" labels based on YTD or L30 OPS. **Not** folded into the rating: short-term OPS streaks (<50 PA) are statistically non-predictive (the doc inside the helper has the literature link). The Bayesian regression with prior cap already absorbs sustained shifts. The label is for user reconciliation: when the box score says "raking" but the rating says 38, the label tells the user *why* the rating is what it is (talent regression hasn't moved yet). |
| `getOpposingStaffPill` | `mlb/analysis.ts` | "Weak staff" / "Elite staff" pill at the extremes (≤3.50 / ≥4.60 staff ERA). The underlying signal (`game.{home,away}Team.staffEra`) is already folded into the batter-side R cat via `staffMod` and into pitcher-side P(W) via the bullpen multiplier. The pill is a UI cue. |
| `runValuePer100` (on `ProbablePitcher`) | `mlb/types.ts` | **Display-only / leading indicator.** Read once by the talent layer's confidence-agreement check (does RV/100 cluster with K%/contact-xwOBA on the same side of league avg?). NOT folded into rating math; the predictive content is already in `kPerPA` and `hrPerContact`. |
| Whiff/chase/barrel/hard-hit % (on `PitcherTalent`) | `pitching/talent.ts` | Same — leading indicators. Plumbed through for breakdown-UI transparency. |

### Identity / matching

| Helper | Where | Purpose |
|--------|-------|---------|
| `isLikelySamePlayer` | `pitching/display.tsx` | The single canonical name matcher for FA → probable starter and roster → probable starter. Requires either full normalized name match OR last-name match + first-initial agreement. Solves the same-team-same-surname collision (Lopez × 2, Ureña × 2). |

## Confidence band

Beyond the `high/medium/low` label, both engines surface a numeric `± band` on the score (in score points, capped at ±15). Bigger band = thinner sample / disagreeing signals.

- **Pitcher side** (`computeConfidence` in `talent.ts`):
  ```
  shrinkage     = 1 − sample_score = 1 − clamp01(effectivePA / 200)
  disagreement_widen = 1.3 if signals disagree, 1.0 otherwise
  band = clamp(shrinkage × 15 × disagreement_widen, 0, 15)
  ```
- **Batter side** (`getBatterRating`):
  ```
  per_cat_shrinkage_i = clamp(1 − effectivePA_i / 200, 0, 1)
  agg_shrinkage = weighted_mean(per_cat_shrinkage, weights = focus weights)
  band = clamp(agg_shrinkage × 15, 0, 15)
  ```

The `VerdictStack` UI renders `62 ± 8` when band ≥ 5. Score band ≥ 10 renders the band in error tone — a flag that this is a thin-sample read.

## Calibration anchors

Constants the rating model is anchored against. Touch with care; re-run the pitcher smoke harness in `src/app/api/admin/test-pitcher-eval/route.ts` after any change.

| Constant | Value | Anchor | File |
|----------|-------|--------|------|
| `xwobaToXera` slope / intercept | 25 / -3.75 | League-avg xwOBA-allowed (.318) → 4.20 ERA | `pitching/talent.ts` |
| `xwobaToXera` clamps | [1.50, 7.50] | Floor / ceiling on per-game ERA projection | `pitching/talent.ts` |
| `W_BB`, `W_HR` | 0.69, 1.97 | FanGraphs 2024 wOBA values for BB and HR | `pitching/talent.ts` |
| Velocity slope (down/up) | 4%/mph / 3%/mph | -1 mph YoY ≈ 5% perf drop; +1 mph ≈ 3% lift | `pitching/forecast.ts` |
| Velocity multiplier cap | ±6% | Single-factor cap on composite influence | `pitching/forecast.ts` |
| `tierFromScore` thresholds | 78 / 62 / 42 / 28 | Score boundaries between ace/tough/avg/weak/bad | `pitching/rating.ts` |
| `PA_FULL_TRUST` | 200 | Effective PA for full sample-confidence | `pitching/talent.ts` |
| `MAX_CONFIDENCE_BAND` | 15 | Cap on pitcher score uncertainty band | `pitching/talent.ts` |
| `MAX_BATTER_BAND` | 15 | Cap on batter score uncertainty band | `mlb/batterRating.ts` |
| `gbBoost` mapping | gbRate ∈ [.30, .60] → boost ∈ [0, 0.5] | A 60%-GB arm gets half the HR-park bump | `pitching/forecast.ts` |
| `weatherHrFactor` swing | ±8% (0.92, 1.08) | Wind-out / wind-in HR carry effect | `pitching/forecast.ts` |
| `weatherContactFactor` swing | ±4% (0.96, 1.04) | BABIP-like effect of weather on non-HR contact | `pitching/forecast.ts` |
| Per-cat weather (HR / R-RBI / H-TB) | ±8% / ±4% / ±2% | Mirrors pitcher-side magnitudes | `mlb/batterRating.ts` |

## What's deliberately out of scope

- **Rebuilding the Bayesian regression.** `talentModel.ts`'s methodology is sound. The single-best-fit talent estimator with regime-shift-aware prior shrinkage handles the hot-rookie / declining-vet problem at the source.
- **Switching from log5 to a different matchup model.** log5 is the right primitive for K and AVG — both rate stats with a clear "rate × rate / population_rate" composition.
- **Predictive use of recent form (`getFormTrend`).** The talent regression with prior cap is statistically defensible. Adding form-as-multiplier would re-introduce noise we're regressing out.
- **Predictive use of `runValuePer100`.** Folding into the K projection requires a dedicated calibration study. Currently a leading indicator only.
- **Per-batter `BatterTalent` type.** `PlayerStatLine.talent` already exists and serves the purpose. Could be tightened later but not blocking.

## Related implementation notes

- `pitching/scoring.ts` — UI-shaped wrapper (`scorePitcher`) that converts `(ProbablePitcher, MLBGame)` → `PitcherStreamingRating` for the streaming board. Distinct from `getPitcherRating(forecast)` in `pitching/rating.ts`. Don't introduce a third scorer; extend one of the existing ones.
- `lib/lineup/optimizeWeek.ts` — calls `getBatterRating` with the unified `MatchupContext` to score every batter for every day of the week, then runs `optimizeLineup` to assign roster slots.
- `components/shared/ScoreBreakdownPanel.tsx` — single breakdown component. Renders 4 sections: Category Fit, Composite Multipliers (platoon — actually multiplied score; velocity is informational only), Context (park/weather/opp — already in cats above), Sample (confidence band).
- `components/shared/CompareTray.tsx` — engine-agnostic compare tray. Pitcher and batter pages each construct `CompareTraySlot[]` from their respective ratings.
