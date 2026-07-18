## Unified Rating Model (L1 + L2 + L3)

The single canonical reference for how MLBoss predicts player performance in a specific game. Both the streaming page (pitcher pickups) and the lineup tools (batter sit/start, pitcher sit/start) consume the same architecture: one shared substrate of math primitives, two parallel rating engines that share the same `MatchupContext` shape, and engine-specific rating outputs (`BatterRating`, `PitcherRating`). The engines do **not** currently return a single unified `Rating` discriminated union — that's target state, not current reality (see [history.md](./history.md#2026-05--rating-unification-orphan-canonical-module-removed)).

This doc covers the rating side of the stack (L1 talent → L2 forecast → L3 rating). For "which categories should I chase?" see [recommendation-system.md](./recommendation-system.md). For aggregation of L3 outputs over time windows see [projection.md](./projection.md).

> **Verified.** These forecasts are graded against actual results — the `pitcher-start` engine snapshots the L2 game forecast per probable, `batter-day` snapshots the per-PA forecast × lineup opportunity. Systematic bias here surfaces as findings on `/admin/forecast`, sliced by the modifier that caused it. Before re-anchoring a constant in this doc, read its scorecard and bump `MODEL_VERSION`. See [forecast-verification.md](./forecast-verification.md).

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
                            │   computeRegimeShift   │
                            │  mlb/parkAdjustment.ts │
                            │  mlb/analysis.ts:      │
                            │   getWeatherScore      │
                            │   getPlatoonAdjusted   │
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
                              Engine-specific rating shapes:
                                BatterRating { score, scoreBand, tier,
                                  categories[], platoon, opportunity,
                                  weather, confidence }
                                PitcherRating { score, tier, categories[],
                                  velocity, platoon, park, weather, opp,
                                  confidence }
                                         │
                                         ▼
                              PlayerSplitsPanel  (batter breakdown)
                              ScoreBreakdownPanel (pitcher breakdown,
                                consumes PitcherStreamingRating from
                                pitching/scoring.ts)
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
  - `expectedERA` ← `xwobaToXera(xwobaAllowed)` — park / opp / weather aware end-to-end.
- **Batter side** (`buildBatterForecast` in [batterForecast.ts](../src/lib/mlb/batterForecast.ts)):
  Every per-PA modifier is an **SP/RP blend** (see [§SP/RP blend](#sprp-blend) below).
  - AVG cat ← `spShare`-weighted log5(talent.avg, SP BAA) + `(1-spShare)`-weighted log5(talent.avg, bullpen BAA) × parkAVG
  - K cat ← spShare blend of log5(talent.K%, SP K%) and log5(talent.K%, bullpen K%) × parkSO
  - HR cat ← talent.HR-rate × blended-pitcher-factor(SP HR/PA, bullpen HR/PA) × parkHR × weather
  - R cat ← talent.R-rate × blended-pitcher-factor(SP xERA, bullpen ERA) × parkR × battingOrderMod × weather
  - RBI cat ← talent.RBI-rate × blended-pitcher-factor(SP xERA, bullpen ERA) × parkR × battingOrderMod × weather
  - SB cat ← talent.SB-rate × RHP-hand-bump × team-SB-allowed multiplier
  - BB cat ← spShare blend of log5(talent.BB%, SP BB%) and log5(talent.BB%, bullpen BB%) × parkBB
  - H, TB cat ← spShare blend of log5(talent.hits/PA, SP hits/PA) and log5 vs bullpen hits/PA × park × weather

  Both sides have a clean L2/L3 split: forecast is a pure function from talent + `MatchupContext` to per-PA expected values; rating consumes the forecast and adds normalization, weighting, focus, composite multipliers, tier mapping, and confidence aggregation. `getBatterRating` internally calls `buildBatterForecast` (extracted in 2026-05); pre-2026-05 the two layers were inlined in one function.

**Composite layer.** Only matchup-wide signals that genuinely scale every category proportionally:
- **Pitcher:** platoon (the SP's weak-handed side stack vs this lineup). Velocity moved out of the composite into the talent-layer regime probe (2026-05) — see [history.md](./history.md#2026-05--velocity-multiplier-moved-to-talent-layer-regime-probe).
- **Batter:** opportunity (PA count from batting order). Platoon is **not** a composite multiplier — it's applied per-category in the forecast as a population component model (large on K, small on AVG/H, negligible on HR); see the canonical table and [history.md](./history.md#2026-05--per-category-platoon).

**Surface layer.** Park, weather, opposing-lineup quality. Computed and shown in the breakdown UI so the user can see WHY their per-cat numbers landed where they did. **NOT** applied to the composite — already in the per-cat numbers. See [architecture.md](./architecture.md#4-per-category-adjustments-before-composite) for why.

### Per-cat batter baselines

The batter side reads per-category talent rates out of [mlb/categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts). Each cat has three paths:

- **Regressed-actual talent** (K / BB): batter has Savant talent with `effectivePA ≥ TALENT_GATE_EFFECTIVE_PA` (100). These talent rates are Bayesian-regressed *actual* outcomes (`talent.kRate` stabilises ~60 PA; `talent.bbRate` ~120 PA), surfaced directly — there is no expected-vs-actual gap to hedge.
- **Expected-stat blend** (AVG / H / TB): the talent rate comes from a Statcast expected model, blended at `XSTAT_BLEND_WEIGHT` (0.6) with the raw actual-rate path rather than replacing it:
  - **AVG** ← `talent.xba` (deserved AVG from Savant)
  - **H** ← `talent.xba × (1 − talent.bbRate)` (per-PA hit rate; AB/PA ≈ 1 − BB%)
  - **TB** ← `talent.xslg × (1 − talent.bbRate)` (SLG is TB/AB, so TB/PA ≈ xSLG × AB/PA)

  Why blend instead of replace: expected stats beat actuals at predicting future rates, but only modestly (next-season wOBA: xwOBA r ≈ .57 vs wOBA r ≈ .54; blends reach r ≈ .59–.61 — Tango's Predictive wOBA line of work), and pure-expected pricing systematically shortchanges speed/contact archetypes whose actual-vs-expected residual is persistent skill (fast hitters beat xwOBA by ~15–22 points of wOBA; sprint speed correlates r ≈ .61 with the differential on grounders). The 40% actual side implicitly carries each player's residual. See history.md "2026-07 — Per-cat batter baselines: expected-stat blend".
- **Raw path** (everything else, and the fallback for thin-sample / no-Savant players): legacy Bayesian blend of raw current + prior + league. HR stays raw — no Savant expected primary isolates HR (xSLG − xBA can't decompose the extra-base mix). R / RBI / SB stay raw indefinitely — lineup-context-dominated, not pure batter skill.

Every consumer of `blendedBaselineForCategory` — matchup-aware `getBatterRating` (L3), the L6 roster-value engine's neutral-week projections, and the points-league rate vectors — picks up all three paths automatically.

## SP/RP blend

Every per-PA modifier in `buildBatterForecast` blends the opposing **starter** and **bullpen** signals. An average SP pitches ~5.3 of 9 IP; treating the SP's per-PA rates as if they applied to all of the batter's PAs systematically overweights the SP signal by ~40% per game on average. The blend corrects this — and matters most when bullpen quality diverges sharply from rotation quality (the Reds-style 2025 profile in the batter-streaming examples).

**The math.** For each per-PA cat:

```
spShareBase  = clamp(sp.talent.ipPerStart / 9, 0.30, 0.85)
rpConfidence = clamp(team.rp.ip / 100, 0, 1)
spShare      = spShareBase + (1 - spShareBase) × (1 - rpConfidence)
rpShare      = 1 - spShare

# log5 cats (AVG, K, BB, H, TB):
expectedRate = spShare × log5(baseline, spRate, leagueRate)
             + rpShare × log5(baseline, rpRate, leagueRate)

# ratio-clamp cats (HR, R, RBI):
spMod = pitcherRatioClamp(spRate, leagueRate, swing)
rpMod = pitcherRatioClamp(rpRate, leagueRate, swing)
expectedRate = baseline × (spShare × spMod + rpShare × rpMod)

# SB (multiplicative, independent dimensions):
teamSbRate   = spShare × team.sp.sbAllowedPerIp + rpShare × team.rp.sbAllowedPerIp
teamSbMult   = clamp(teamSbRate / leagueSbAllowedPerIp, 0.80, 1.25)
expected     = baseline × (RHP-hand-bump) × teamSbMult
```

`computeSpShare` and the `blendLog5` / `blendRatioMult` helpers live in [batterForecast.ts](../src/lib/mlb/batterForecast.ts).

**Why `ipPerStart` per-pitcher and not a constant 0.6.** An ace going 6.5 IP weights bullpen exposure to ~28%; a 5th starter going 4 IP weights it to ~56%; an opener at 3 IP weights it to ~67%. The exposure profile is the right driver, and `talent.ipPerStart` is already Bayesian-blended against the league prior (`LEAGUE_IP_PER_START = 5.4`) in the talent layer.

**Why shrinkage toward SP-only.** Team bullpen aggregates are thin early-season (cold start, ~10 IP at week 1). `rpConfidence` linearly scales the bullpen weight: 0 IP → spShare = 1.0 (full SP-only fallback); 100+ IP → spShare = spShareBase. No NaN risk when data is missing — when `team.staffSplits` is null, `rpConfidence = 0` and the forecast reduces to the pre-blend behavior.

**Data source.** [`fetchTeamStaffSplits`](../src/lib/mlb/schedule.ts) hits MLB Stats API `/teams/stats?stats=statSplits&group=pitching&sitCodes=sp,rp` once per season (STATIC-tier cache). One call returns all 30 teams × 2 roles. Each role line includes IP, BF, K, BB, H, HR, BAA, ERA, WHIP, SBs — used directly without derivation. The league-mean SB-allowed-per-IP is computed from the same response (sum SBs / sum IPs across all splits) and exposed via `getLeagueSbAllowedPerIp` for the SB cat modifier.

**What this replaced.** A standalone `staffMod = sqrt(staffEra / 4.2)` ratio clamp applied only to the R cat (not RBI). That code double-counted the SP (which is included in team-total ERA) and asymmetrically excluded RBI. The blend captures both rotation and bullpen contributions in one pass; the old staffMod is gone. Per the doc-discipline rules, see also the [history.md entry](./history.md) for this change.

**Same plumbing, parallel pitcher-side win.** The W-probability bullpen multiplier in [pitching/forecast.ts](../src/lib/pitching/forecast.ts) used `staffEra` as a proxy for relief-only ERA ("~0.7 correlation in practice"); after this change it reads `team.staffSplits.rp.era` directly with `staffEra` as a fallback. Same data, no proxy.

## Pitcher-side three layers

The pitcher side uses three distinct internal types that flow through the per-PA / composite / surface architecture above. Each layer is a pure function of its inputs.

```
       data sources                    pure layers                 consumers
       ────────────                    ───────────                 ─────────

  MLB Stats API (line, gamelog) ─┐
  Baseball Savant (xwOBA-a, RV)  ├──▶  PitcherTalent  ──┐
  (regime-shift probe)           ─┘   (Layer 1)         │
                                                        ▼
                                   ┌─▶  GameForecast  ───┐──▶  getBatterRating  (per-PA log5)
  MLBGame (park, weather, opp)  ───┤   (Layer 2)         │
                                   │                     ▼
                                   │                   PitcherRating  ──▶  StreamingBoard
                                   │                   (Layer 3)          TodayPitchers
                                   │                                      ScoreBreakdownPanel
                                   └─ opposingPitcher.talent for P(W) ────┘
```

### Layer 1 — `PitcherTalent`

The single canonical answer to "how good is this pitcher in a vacuum?" — a vector of regressed per-PA outcome rates plus health/decline signals plus sample-trust metadata. Lives in [pitching/talent.ts](../src/lib/pitching/talent.ts).

```typescript
interface PitcherTalent {
  mlbId: number;
  throws: 'L' | 'R' | 'S';

  // Outcome rates — Bayesian-blended with regime-shift-aware prior shrinkage
  kPerPA: number;          // e.g. 0.265 = 26.5% K rate
  bbPerPA: number;         // e.g. 0.072
  contactXwoba: number;    // xwOBA on contact (.300 elite, .368 league avg, .420 bad)
  hrPerContact: number;    // ~0.035 league avg

  // Per-start depth + style
  ipPerStart: number;
  gbRate: number;

  // Role + reliever workload (L1 reliever signals)
  //   role detection: GS > 0 (current or prior) → 'starter', else any
  //   appearances → 'reliever', else 'inactive'. Driven by the OVERALL
  //   season line (starts + relief), not the SP-filtered line.
  //   appearancesPerWeek / ipPerAppearance are populated only for
  //   relievers — null for starters and inactive pitchers. Bayesian-
  //   blended against league means (~2.4 G/week, ~1.05 IP/G).
  //   Consumed by L2 `buildReliefWeekForecast`.
  role: 'starter' | 'reliever' | 'inactive';
  appearancesPerWeek: number | null;
  ipPerAppearance: number | null;

  // Health / decline (talent-level signals)
  fastballVelo: number | null;
  veloTrend: number | null;       // YoY mph delta

  // Leading indicators (UI transparency only — NOT in the regression)
  whiffPct: number | null;
  chasePct: number | null;
  barrelPct: number | null;
  hardHitPct: number | null;

  // Trust
  effectivePA: number;
  confidence: 'high' | 'medium' | 'low';
  confidenceReason: string;
  source: 'savant_full' | 'savant_partial' | 'stats_only' | 'rookie_unknown';
}
```

The talent vector is **stamped onto every enriched `ProbablePitcher`** by `getGameDay` in [schedule.ts](../src/lib/mlb/schedule.ts). Every consumer reads from the same vector — there is no other "talent" representation.

### Layer 2 — `GameForecast`

Applies game-specific context to `PitcherTalent`. Lives in [pitching/forecast.ts](../src/lib/pitching/forecast.ts).

```typescript
interface GameForecast {
  pitcher: PitcherTalent;
  game: MLBGame;
  isHome: boolean;
  xwobaAllowed: number;
  expectedERA: number;
  expectedPerPA: { kPerPA, bbPerPA, hrPerPA, contactXwoba, baa };
  expectedPerGame: { ip, pa, k, bb, er, h, hr };
  probabilities: { qs, w };
  multipliers: { velocity, platoon, park, weather, opp, bullpen };
}
```

- `expectedPerPA` — adjusted for opposing offense (log5 against opp K-rate-vs-hand, HR-park, etc.). The **batter side** consumes this for log5 calculations against the opposing SP.
- `expectedPerGame` — projected IP, K, BB, ER, H, HR for the start. Drives the per-category score windows in Layer 3.
- `probabilities` — P(QS), P(W). Bullpen quality (`MLBGame.{home,away}Team.staffSplits.rp.era` for real RP-only ERA, with `staffEra` as the fallback when splits are missing) and opposing-SP talent fold into P(W). See `buildBullpenMultiplier` in `pitching/forecast.ts`.
- `multipliers` — surfaced for breakdown UI. Bullpen is the only one that doesn't fold into the Layer 3 composite (it only affects W odds). The `park` multiplier comes from `getParkAdjustment` — shared with the batter-side rating.

### Layer 3 — `PitcherRating`

Scores the forecast against the user's league cats with focus weighting. Lives in [pitching/rating.ts](../src/lib/pitching/rating.ts). Mirrors the structural shape of `getBatterRating`:

```
score = 100 × Σ (cat.weight × cat.normalized) × platoon.multiplier
```

`cat.normalized` is `cat.expected` mapped onto a per-stat 0-1 window (see `PITCHER_NORM`). Tier is derived from score via `tierFromScore` — there is no separate classifier.

```typescript
function tierFromScore(score: number): PitcherTier {
  if (score >= 78) return 'ace';
  if (score >= 62) return 'tough';
  if (score >= 42) return 'average';
  if (score >= 28) return 'weak';
  return 'bad';
}
```

Sub-score normalization windows (drives the per-cat color strips on the breakdown panel):

| Sub-score | Projection source | Normalization window |
|---|---|---|
| **QS** | `probabilities.qs` | 0.10 → 0.70 |
| **K** | `expectedPerGame.k` | 3.5 → 9.0 |
| **W** | `probabilities.w` | 0.20 → 0.65 |
| **ERA** | `expectedERA` | 5.50 → 2.30 (lower is better) |
| **WHIP** | derived from `expectedPerPA.bbPerPA` and `expectedPerPA.baa` | 1.55 → 0.95 (lower is better) |

## Regime-shift probe (talent layer)

A holistic prior-cap shrinkage that detects when a pitcher's current-season *leading indicators* have all shifted together vs. prior — evidence of a real regime change (decline, breakout, role swap, injury return). Replaces a previous SoS-based sample shrinkage that ran the wrong direction for declining pitchers facing weak lineups; see [history.md](./history.md#pre-2026-05--pitcher-evaluation-rebuild-monterohouser).

Lives as `computeRegimeShift` in [pitching/talent.ts](../src/lib/pitching/talent.ts).

The probe scores current vs. prior on five metrics (K%, BB%, whiff%, barrel%, fastball velocity):

```
zᵢ = (currentᵢ − priorᵢ) / SDᵢ        for each metric, sign-corrected so + = pitcher improved
significant = { zᵢ : |zᵢ| ≥ 0.8 }
score = Σ significant / max(2, |significant|)
```

The score is signed: positive = breakout, negative = decline. The denominator floor of 2 dampens single-metric outliers; contradicting metrics naturally cancel via the signed sum.

The score scales BOTH the prior-season cap AND the league-prior weight inside `computeTalent`:

```
regimeShrink   = max(0.25, 1 − 0.4 × |score|)
leaguePriorMul = sqrt(regimeShrink)
```

|score| of 1 → 0.6× prior-season weight; 2 → 0.2× (floored at 0.25). The league prior weakens at `sqrt(regimeShrink)` — less aggressively than the prior-season weight — because population norms are a more stable anchor than this pitcher's prior year. At max regime shrink (0.25), the league prior still gets 50% of its baseline weight.

The shrinkage propagates through both `talentModel.computeTalent` (K, BB, xwOBACON, HH blends) and `computeHrPerContact` (HR/contact blend).

### Four canonical shapes

How the probe handles common pitcher archetypes — the four shapes the smoke harness at `src/app/api/admin/test-pitcher-eval/route.ts` asserts against:

- **Houser-style (decline confirmed by leading indicators)**: K% ↓ AND barrel% ↑ → `score ≈ −2.15` → prior cap × 0.25 → talent estimate moves hard toward current. xwOBA-allowed lands near .380 instead of the prior-anchored .335.
- **Montero-style (hot start with stable peripherals)**: K%, whiff%, barrel% all flat vs prior → `score ≈ 0` → prior cap unchanged → contact-quality outliers get regressed naturally toward prior. xwOBA-allowed lands at league-ish.
- **Skubal-style (stable ace, mild peak regression)**: small mixed signals → `score ≈ −0.5` → prior cap × 0.85 → talent estimate barely budges from prior.
- **Roupp-style (true breakout with multiple confirming signals)**: K% ↑ AND barrel% ↓ → `score ≈ +3.0` → prior cap × 0.25 → talent estimate moves toward current.

## BB compounding penalty (forecast layer)

xwOBA's linear weights are calibrated to the *average* run value of each event. The BB weight (0.69 wOBA points) is what one walk in isolation is worth across the population. For pitchers with extreme walk rates, the actual run cost is higher: the second walk in an inning is more damaging than the first (a runner is already on, errors / wild pitches / SBs hurt more), and linear-additivity collapses these compounding effects to a constant. The xwOBA → xERA conversion is anchored at population mean BB ≈ .085, so it's accurate near the mean but understates ER risk for high-BB pitchers — Lopez-shaped profiles where xERA looks fine but actual ERA runs much higher than walk rate alone would explain.

`bbCompoundingPenalty(bbPerPA)` in [pitching/forecast.ts](../src/lib/pitching/forecast.ts) adds an additive ERA bump to the talent-derived `expectedERA`:

```
penalty = clamp((bbPerPA − 0.085) × 10, 0, 1.0)   // ERA points
```

- 8.5% BB (league mean): +0.00 ERA
- 12% BB: +0.35 ERA
- 15% BB: +0.65 ERA
- 18%+ BB: capped at +1.00 ERA

One-sided correction: pitchers walking at or below league mean get nothing. The slope (×10) is calibrated to the empirical observation that pitchers walking 15% run roughly +0.7 ERA above their xERA on average.

Lives at the forecast layer (not in the talent vector or the shared `xwobaToXera` primitive) because:
- It's about projecting *actual ER from talent in a game*, not about composing xwOBA from events. xwOBA stays clean linear weights.
- It has no batter-side analogue. Batter-vs-pitcher rating reads `forecast.expectedPerPA` for log5; it doesn't read `expectedERA`. Putting the penalty here keeps the batter side untouched.
- Symmetric to how park / weather / opp adjustments already modify forecast outputs without touching shared primitives.

## Rating shapes (current state)

The engines return **engine-specific shapes**. They are *similar* (both have `score`, `tier`, `categories`, a `confidence` blob) but they are **not** a discriminated union — neither carries an `engine` field, and their multiplier sets differ.

**`BatterRating`** (from [src/lib/mlb/batterRating.ts](../src/lib/mlb/batterRating.ts)):

```typescript
interface BatterRating {
  score: number;          // 0-100, 50 = neutral
  scoreBand: number;      // ± uncertainty in score points
  netVsNeutral: number;
  tier: 'great' | 'good' | 'neutral' | 'poor' | 'bad';
  categories: CategoryContribution[];   // batter-side shape
  platoon: RatingMultiplier;            // display summary — per-cat in forecast (2026-05)
  opportunity: RatingMultiplier;        // composite — applied to score
  weather: RatingMultiplier;            // surface — already in cats
  confidence: { level; reason; band };
}
```

**`PitcherRating`** (from [src/lib/pitching/rating.ts](../src/lib/pitching/rating.ts)):

```typescript
interface PitcherRating {
  score: number;          // 0-100, 50 = neutral
  netVsNeutral: number;   // (no scoreBand on this shape)
  tier: 'ace' | 'tough' | 'average' | 'weak' | 'bad';
  categories: PitcherCategoryContribution[];
  velocity: ContextMultiplier;          // informational only (multiplier = 1.0)
  platoon: ContextMultiplier;           // composite — applied to score
  park: ContextMultiplier;              // surface — already in cats
  weather: ContextMultiplier;           // surface — already in cats
  opp: ContextMultiplier;               // surface — already in cats
  confidence: { level; reason; band };
}
```

Per-engine tier vocabularies (pitcher: ace/tough/avg/weak/bad; batter: great/good/neutral/poor/bad) reflect that "ace" carries pitcher-specific meaning. Tier is always derived from `score` via a single classifier per engine — `batterTierFromScore` in `batterRating.ts`, `tierFromScore` in `pitching/rating.ts` — no separate rule-based tier system.

**Composite vs surface enforcement.** The split is enforced by *which fields the composite formula multiplies*. As of 2026-05 that's `platoon` on the **pitcher** side, and `opportunity` on the batter side. Batter platoon moved to the per-cat layer (population component structure — see below); its `platoon` field is now a display-only summary. Everything else is surface (already folded in at the per-PA layer; rendered in the breakdown panel for transparency).

There's a third pitcher rating shape — `PitcherStreamingRating` — produced by `scorePitcher()` in [pitching/scoring.ts](../src/lib/pitching/scoring.ts). It wraps `getPitcherRating` and reshapes the output into the table-shaped form the streaming board consumes (0–1 score scale for back-compat with table widgets; `subScore` per category instead of `expected`/`normalized`/`betterIs`). The streaming board, today-page pitcher rows, and the pitcher `ScoreBreakdownPanel` all consume that shape, not `PitcherRating` directly.

### Target shape (not yet implemented)

The originally-planned unified `Rating` discriminated union (engine: 'batter' | 'pitcher', composite/surface multiplier maps) was specified but never adopted by the engines. See [history.md](./history.md#2026-05--rating-unification-orphan-canonical-module-removed) for the deletion of the orphan canonical module. Future work to actually unify the shapes would touch every rating consumer; until then, the current per-engine shapes are load-bearing.

## The `MatchupContext` shape

Both engines consume `MatchupContext` (in [src/lib/mlb/matchupContext.ts](../src/lib/mlb/matchupContext.ts)):

```typescript
interface MatchupContext {
  game: EnrichedGame;          // park enriched here
  isHome: boolean;
  opposingPitcher: ProbablePitcher | null;
  asPitcher: { talent: PitcherTalent; opposingOffense: TeamOffense | null } | null;
  asBatter: { hand: 'L'|'R'|'S'|null; battingOrder: number | null } | null;
}
```

`game.park` is the canonical park field; feature code does NOT read `ctx.park` (removed) and does NOT read `ParkData.parkFactor*` directly anywhere — all park lookups go through `getParkAdjustment` or `formatParkBadge`.

## Math layer helpers

Edge case math primitives. These are subtle pieces that need to be where they are.

| Helper | Where | Purpose |
|---|---|---|
| `composeXwobaAllowed` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Talent-only xwOBA-allowed using FanGraphs linear weights with **explicit HR**. Drives `expectedERA` once the forecast layer adjusts inputs. |
| `composeAdjustedXwobaAllowed` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Same composition but takes pre-adjusted in-game per-PA rates. Used by `buildGameForecast`. |
| `talentNonHrContactXwoba` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Backs out non-HR contact value from `talent.contactXwoba` (HR-inclusive average). Lets HR scale separately at the forecast layer. |
| `getParkAdjustment` | [parkAdjustment.ts](../src/lib/mlb/parkAdjustment.ts) | Single primitive for "given park + stat + hand + weather, what multiplier?". Per-stat tracks (HR, SO, BB, RUNS, OVERALL, 2B, 3B). Wind amplification fires only in `windSensitivity: 'high'` parks (Wrigley/Oracle/Sutter Health). Defensive: missing factor fields fall back to neutral 100, never NaN. |
| `formatParkBadge` | [parkAdjustment.ts](../src/lib/mlb/parkAdjustment.ts) | Single helper for the park badge — picks the more-extreme of overall PF vs HR PF. Both StreamingBoard and TodayPitchers consume this; no inline `parkFactor*` reads in feature code. |
| `gbBoost` (in `forecast.ts`) | [pitching/forecast.ts](../src/lib/pitching/forecast.ts) | Gates park HR effect by GB rate. A 60%-GB arm gets half the HR-park bump; a 30%-GB arm gets the full bump. The single best predictor of HR-park insulation. |
| `platoonFactor` | [mlb/platoon.ts](../src/lib/mlb/platoon.ts) | Per-category platoon multiplier. Bayesian-regresses the batter's OWN observed vs-hand ratio (`ratiosVsL/ratiosVsR`, plumbed from `getBatterSplits`) toward a population target keyed on (bats, facingHand), weighted by his PA on that side. Per-cat `PRIOR` reflects stabilization (K/BB ~450 PA, AVG ~1000, TB/HR 1300–1500). Applied per-cat inside `buildBatterForecast`, NOT as a composite multiplier. Switch hitters: population target ~1.0, so their observed side-gap regresses against neutral (no special case). Large on K, small on AVG/H, damped on HR; SB has none. Replaced the OPS-based composite `getPlatoonAdjustedTalent` (2026-05). See file header + history.md for sourcing. |
| `getWeatherScore` | [mlb/analysis.ts](../src/lib/mlb/analysis.ts) | 0-1 scalar of weather offense friendliness. 0.5 = neutral. Wind out + warm = 1.0; wind in + cold = 0.0. Domes return 0.5. Folded into per-cat weather factors on both sides. |
| `weatherCatFactor` | [batterRating.ts](../src/lib/mlb/batterRating.ts) | Per-cat weather adjustment: HR ±8%, R/RBI ±4%, H/TB ±2%, K/BB/SB unchanged. Mirrors the pitcher-side `weatherHrFactor` / `weatherContactFactor` for symmetry. |
| `isLikelySamePlayer` | [pitching/display.tsx](../src/lib/pitching/display.tsx) | The single canonical name matcher for FA → probable starter and roster → probable starter. Requires either full normalized name match OR last-name match + first-initial agreement. Solves the same-team-same-surname collision (Lopez × 2, Ureña × 2). |

## Confidence band

Beyond the `high/medium/low` label, both engines surface a numeric `± band` on the score (in score points, capped at ±15). Bigger band = thinner sample / disagreeing signals.

- **Pitcher side** (`computeConfidence` in `talent.ts`):
  ```
  level_score = clamp01(effectivePA / 200)    ← talent-pool size (current + capped prior)
  band_score  = clamp01(currentPA / 200)      ← current-season-only

  agreement_score = 1.0 if K%/contact-xwOBA/RV-100 cluster on the same side of league avg,
                    0.7 otherwise

  value           = level_score × agreement_score
  high   if value >= 0.7
  medium if value >= 0.4
  low    otherwise

  disagreement_widen = 1.3 if signals disagree, 1.0 otherwise
  band = clamp((1 − band_score) × 15 × disagreement_widen, 0, 15)
  ```
- **Batter side** (`getBatterRating`):
  ```
  per_cat_shrinkage_i = clamp(1 − effectivePA_i / 200, 0, 1)
  agg_shrinkage = weighted_mean(per_cat_shrinkage, weights = focus weights)
  band = clamp(agg_shrinkage × 15, 0, 15)
  ```

The pitcher side's two PA inputs differ deliberately. The tier `level` reflects how much DATA backs the talent estimate (prior-season sample is real information). The numeric `band` reflects how stable THIS YEAR'S sample is at pinning down current talent — a thin current sample with a fat prior produces a confidently-estimated mean but real ± uncertainty (if the prior turns out to be contaminated, the estimate moves a lot).

The `VerdictStack` UI renders `62 ± 8` when band ≥ 5. Score band ≥ 10 renders the band in error tone — a flag that this is a thin-sample read.

`PitcherTalent.confidence` is **not** a multiplier. The talent layer already handled thin-sample shrink via the regression — applying a second downweight at scoring time would double-count.

## Calibration anchors

Constants the rating model is anchored against. Touch with care; re-run the pitcher smoke harness in `src/app/api/admin/test-pitcher-eval/route.ts` after any change. Values live in source code; this table owns rationale only.

| Constant | File | Anchor |
|---|---|---|
| `xwobaToXera` slope / intercept / clamps | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-avg xwOBA-allowed (.318) → 4.20 ERA; clamps are practical floor/ceiling per-game ERA |
| `W_BB`, `W_HR` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | FanGraphs 2024 wOBA values for BB and HR |
| Velocity slope (down / up) | [pitching/forecast.ts](../src/lib/pitching/forecast.ts) | -1 mph YoY ≈ 5% perf drop; +1 mph ≈ 3% lift (asymmetry is empirically motivated) |
| Velocity multiplier cap | [pitching/forecast.ts](../src/lib/pitching/forecast.ts) | Single-factor cap on composite influence — but velocity is informational only now (regime probe absorbs the signal) |
| `tierFromScore` thresholds | [pitching/rating.ts](../src/lib/pitching/rating.ts) | Score boundaries between ace/tough/avg/weak/bad |
| `PA_FULL_TRUST` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Effective PA for full sample-confidence; see [league-baselines.md](./league-baselines.md) |
| `MAX_CONFIDENCE_BAND` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Cap on pitcher score uncertainty band |
| `MAX_BATTER_BAND` | [batterRating.ts](../src/lib/mlb/batterRating.ts) | Cap on batter score uncertainty band |
| `gbBoost` mapping | [pitching/forecast.ts](../src/lib/pitching/forecast.ts) | gbRate ∈ [.30, .60] → boost ∈ [0, 0.5]. A 60%-GB arm gets half the HR-park bump |
| `weatherHrFactor` swing | [pitching/forecast.ts](../src/lib/pitching/forecast.ts) | Wind-out / wind-in HR carry effect, ±8% empirical |
| `weatherContactFactor` swing | [pitching/forecast.ts](../src/lib/pitching/forecast.ts) | BABIP-like effect of weather on non-HR contact, ±4% empirical |
| Per-cat weather (HR / R-RBI / H-TB) | [batterRating.ts](../src/lib/mlb/batterRating.ts) | ±8% / ±4% / ±2% magnitudes mirror pitcher-side |
| `PITCHER_SWING_HR` | [batterRating.ts](../src/lib/mlb/batterRating.ts) | Tango/Clemens 2018→19: extreme pitcher edge ≈ 2% per PA. Bound absorbs noise around small empirical effect |
| `PITCHER_SWING_RUNS` (R, RBI) | [batterRating.ts](../src/lib/mlb/batterRating.ts) | R/RBI per-PA flow through team offense + 8 unrelated PAs; pitcher's per-PA share is a fraction of ERA share |
| BB log5 | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Rate-on-rate vs `LEAGUE_BB_PER_PA`. BB is 3-true-outcome; pitcher-controlled, log5 derives magnitude |
| H / TB log5 | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Rate-on-rate vs `LEAGUE_H_PER_PA` using `talentHitsPerPA`. Keeps H↔AVG↔TB consistent — previously H/TB had no SP signal while AVG did |
| `bbCompoundingPenalty` slope / cap | [pitching/forecast.ts](../src/lib/pitching/forecast.ts) | Additive ERA penalty for BB% above league mean (.085). Calibrated to empirical BB%-vs-(ERA−xERA) relationship in MLB starter data |
| Regime probe (`REGIME_SD_*`, `REGIME_SIGNIFICANT_Z`, slope, floor) | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Per-metric Y-Y noise bands and z-score threshold for the probe; slope/floor map from \|score\| to prior-cap multiplier |
| `LEAGUE_XBA`, `LEAGUE_XSLG` | [mlb/talentModel.ts](../src/lib/mlb/talentModel.ts) | 2024 MLB averages from Savant expected-statistics leaderboard (.243 / .404). xBA tracks AVG closely; xSLG is meaningfully higher than league SLG because Savant credits hard contact that becomes outs at the .240 league-avg BAA rate |
| `XSTAT_BLEND_WEIGHT` | [mlb/categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts) | Weight on expected-stat-modeled rates (xBA/xSLG) vs the raw actual blend for AVG/H/TB. Anchored to the predictive-validity ladder (wOBA r ≈ .54 < xwOBA r ≈ .57 < blends r ≈ .59–.61 for next-season wOBA) and the persistent speed/contact residual literature — see [#per-cat-batter-baselines](#per-cat-batter-baselines) |
| `PRIOR_XBA_PA`, `PRIOR_XSLG_PA` | [mlb/talentModel.ts](../src/lib/mlb/talentModel.ts) | Half-stabilisation points for xBA / xSLG, both PA-denominated. Faster than full-xwOBA composition (~150 BIP) but slower than K%/BB% — empirically 100/120 PA respectively |
| `TALENT_GATE_EFFECTIVE_PA` | [mlb/categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts) | Effective-PA gate that switches AVG / H / K / BB per-cat baselines from raw-rate blend to talent-derived rate. Below 100 effective PA the talent regression is league-prior-dominated; above 100 it strips BABIP/luck noise meaningfully. ~30 GP for a regular |
| `SP_SHARE_CLAMP` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Floor/ceiling on SP IP share — opener (0.30) and rare complete-game (0.85). See [§SP/RP blend](#sprp-blend). |
| `RP_FULL_TRUST_IP` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | RP IP at full bullpen-aggregate confidence; below this `rpConfidence` shrinks linearly. 100 ≈ one month of team RP play. See [§SP/RP blend](#sprp-blend). |
| `SB_SWING` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Clamp on team-aggregate SB-allowed multiplier. Tight bounds since runner skill and base-state dominate SB variance. |

For league-mean priors used across many engines (`LEAGUE_K_RATE`, etc.) see [league-baselines.md](./league-baselines.md).

## Debugging a pitcher

The breakdown UI is the truth. Per pitcher:

1. **Talent pane** — read `pp.talent`. Is `confidence` low? Is `effectivePA` < 80? Thin sample — regression has pulled rates toward league mean.
2. **Forecast pane** — `forecast.expectedPerPA` shows what the engine thinks this pitcher will do *in this game*. Compare to talent — the delta is the matchup adjustment.
3. **Rating pane** — `rating.categories` shows the per-cat normalized score. Multiplier strip below shows velocity / platoon / park / weather / opp.

If a pitcher seems mis-rated:

- **Wrong tier** — score and tier are derived from the same number. If `tier === 'ace'` and `score < 78`, that's a bug. File it.
- **Sample-vs-rating disagreement** — check `confidence` and `regime`. A wide ± band on a thin current sample is the model telling you "I'm anchored to prior, but it might not be applicable." A `regime.score` near 0 with `declines + breakouts ≥ 2` means leading indicators contradicted each other — confused profile, prior preserved. These are features, not bugs.
- **Doesn't match Yahoo's ERA / WHIP** — those are surface stats. The rating uses `expectedERA` and the talent's per-PA outcomes. They differ on hot starts (talent hasn't budged) and cold starts (talent regression is pulling toward prior).

## Out of scope

- **Rebuilding the Bayesian regression.** `talentModel.ts`'s methodology is sound. The single-best-fit talent estimator with regime-shift-aware prior shrinkage handles the hot-rookie / declining-vet problem at the source.
- **Switching from log5 to a different matchup model.** log5 is the right primitive for K, BB, AVG, H, and TB. Where log5 doesn't fit (HR is contact-quality; R/RBI flow through team play), bounded multiplicative ratios (`PITCHER_SWING_*`) are used instead, with windows anchored to per-PA share-of-variance research.
- **Predictive use of recent form (`getFormTrend`).** Talent regression with prior cap is statistically defensible. Adding form-as-multiplier would re-introduce noise we're regressing out. See [architecture.md](./architecture.md#deliberately-not-engines).
- **Predictive use of `runValuePer100`.** Folding into the K projection requires a dedicated calibration study. Currently a leading indicator only.

## Related implementation notes

- [pitching/scoring.ts](../src/lib/pitching/scoring.ts) — UI-shaped wrapper (`scorePitcher`) that converts `(ProbablePitcher, MLBGame)` → `PitcherStreamingRating` for the streaming board's per-start breakdown panel. Distinct from `getPitcherRating(forecast)` in `pitching/rating.ts`. Don't introduce a third scorer; extend one of the existing ones.
- [lineup/optimizeWeek.ts](../src/lib/lineup/optimizeWeek.ts) — calls `getBatterRating` with the unified `MatchupContext` to score every batter for every day of the week, then runs `optimizeLineup` to assign roster slots. See [projection.md](./projection.md).
- [projection/batterTeam.ts](../src/lib/projection/batterTeam.ts) and [projection/pitcherTeam.ts](../src/lib/projection/pitcherTeam.ts) — forward projection engines that consume `getBatterRating` and `getPitcherRating` per-day/per-start and aggregate across the matchup week or pickup window. See [projection.md](./projection.md).
- [components/shared/ScoreBreakdownPanel.tsx](../src/components/shared/ScoreBreakdownPanel.tsx) — single breakdown component. Renders 4 sections: Category Fit, Composite Multipliers, Context (already in cats above), Sample (confidence band). On the streaming pitcher board it stacks once per probable start when a row is expanded.
