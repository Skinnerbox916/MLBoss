# Pitcher Evaluation

Canonical reference for how MLBoss evaluates pitchers. There is exactly
one architecture, one talent representation, and one tier mapping. Any
new code that wants to reason about pitcher quality should consume this
system — there is no other.

> **Companion / parent doc:** [`unified-rating-model.md`](./unified-rating-model.md)
> covers BOTH the pitcher and batter rating engines as a single
> architecture (shared substrate, parallel engines, unified `Rating` shape).
> This file zooms into the pitcher side specifically, including the
> regime-shift probe that anchors the talent estimate against
> small-sample noise in either direction.
>
> Companion docs:
> [`scoring-conventions.md`](./scoring-conventions.md) for the level/calibration
> rubric, [`recommendation-system.md`](./recommendation-system.md) for the
> matchup-state layer, [`streaming-page.md`](./streaming-page.md) for the
> streaming-board UI internals.

---

## Why this exists

MLBoss used to have **three independent pitcher evaluators**:

1. A rule-based tier classifier (`classifyPitcherTier`) that mapped
   ERA + WHIP + K/9 + xERA onto `ace | tough | average | weak | bad |
   unknown`.
2. A continuous talent score (`pitcherTalentScore`) that hierarchically
   resolved `RV/100 → component xwOBA-allowed → tier-fallback → 0.5`.
3. A raw-fields path inside `getBatterRating` that read `pp.era`,
   `pp.hr9`, `pp.battingAvgAgainst`, and `pp.strikeoutsPer9` directly
   and synthesised K/PA from K/9 with a magic 4.2 PA/inning constant.

This produced absurdities — most visibly **Keider Montero** in early
2026: 27 IP, ERA 4.00, 8% rostered. Path 1 saw his Savant xERA at 2.36
plus WHIP 1.00, classified him `ace`, and the row sprouted a green ACE
badge. Path 2 ran his thin sample through component xwOBA, regressed
hard against the prior, and landed on talent score 0.55 — score 62
"FAIR". Both badges shipped, side by side, on the same row. Two paths,
two answers, one rated very badly via blunt-instrument rules.

The rebuild collapses all three into a layered system rooted in
**per-PA outcomes**:

> "What does this pitcher do, per plate appearance, against a
>  league-average opponent in a neutral environment?"

Everything else (game context, fantasy categories, tier badges) is a
projection of that single question.

---

## Architecture

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

Three layers, each a pure function of its inputs.

### Layer 1 — `PitcherTalent` (`src/lib/pitching/talent.ts`)

The single canonical answer to "how good is this pitcher in a vacuum?".
A vector of regressed per-PA outcome rates plus health/decline signals
plus sample-trust metadata.

```ts
interface PitcherTalent {
  mlbId: number;
  throws: 'L' | 'R' | 'S';

  // Outcome rates — Bayesian-blended with regime-shift-aware prior shrinkage
  kPerPA: number;          // e.g. 0.265 = 26.5% K rate
  bbPerPA: number;         // e.g. 0.072
  contactXwoba: number;    // xwOBA on contact (.300 elite, .368 league avg, .420 bad)
  hrPerContact: number;    // ~0.035 league avg

  // Per-start depth + style
  ipPerStart: number;      // 5.4 league avg
  gbRate: number;          // 0.435 league avg

  // Health / decline (talent-level signals)
  fastballVelo: number | null;    // mph
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

The talent vector is **stamped onto every enriched `ProbablePitcher`**
by `getGameDay` (in `src/lib/mlb/schedule.ts`). Every consumer reads
from the same vector — there is no other "talent" representation.

### Layer 2 — `GameForecast` (`src/lib/pitching/forecast.ts`)

Applies game-specific context to `PitcherTalent`. Produces:

- **`expectedPerPA`** — K/PA, BB/PA, HR/PA, contact-xwOBA, BAA, all
  adjusted for the opposing offense (log5 against opp K-rate-vs-hand,
  HR-park factor, etc.). The **batter side** consumes this for log5
  calculations against the opposing SP.
- **`expectedPerGame`** — projected IP, K, BB, ER, H, HR for the start.
  Drives the per-category score windows in Layer 3.
- **`probabilities`** — P(QS), P(W). Bullpen quality and opposing-SP
  talent fold into P(W).
- **`multipliers`** — velocity, platoon, park, weather, opp, bullpen.
  Surfaced for breakdown UI; bullpen is the only one that doesn't fold
  into the Layer 3 composite (it only affects W odds). The `park`
  multiplier comes from `getParkAdjustment` in
  [src/lib/mlb/parkAdjustment.ts](../src/lib/mlb/parkAdjustment.ts) —
  shared with the batter-side rating so both sides agree on what a
  given park does to offense.

```ts
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

### Layer 3 — `PitcherRating` (`src/lib/pitching/rating.ts`)

Scores the forecast against the user's league cats with chase/punt
focus weighting. Mirrors the structural shape of `getBatterRating`:

```
score = 100 × Σ (cat.weight × cat.normalized) × platoon.multiplier
```

**Architecture rule (post-2026-05):** only matchup-wide signals
that scale every category proportionally multiply the composite. As
of 2026-05 that's just platoon. Velocity used to be a composite
multiplier here too (asymmetric ±6%), but YoY velo delta is now an
input to the talent-layer regime-shift probe — folding velo into
the prior-cap shrinkage covers the same predictive territory and
keeping a separate composite multiplier on top would double-count.
The `Rating.velocity` field is preserved for breakdown UI display
(showing the velo trend) but its `multiplier` is fixed at 1.0.

Stat-specific signals — park, opp, weather — live at the per-PA
layer (in `forecast.ts`) where they shape `expectedPerPA` directly.
They show up on the `PitcherRating` object as `park` / `weather`
/ `opp` for breakdown display, but they do NOT multiply the score
a second time. See [unified-rating-model.md](./unified-rating-model.md)
for why.

`cat.normalized` is `cat.expected` mapped onto a per-stat 0-1 window
(see `PITCHER_NORM` for the windows). Tier is derived from score via
`tierFromScore` — there is no separate classifier.

```ts
function tierFromScore(score: number): PitcherTier {
  if (score >= 78) return 'ace';
  if (score >= 62) return 'tough';
  if (score >= 42) return 'average';
  if (score >= 28) return 'weak';
  return 'bad';
}
```

---

## Regime-shift probe

The bug that originally motivated the rebuild — Montero classified
ACE on a 27-IP sample against four below-average lineups — and its
inverse — Houser projected as a fair 4.20-ERA streamer despite a
7.12 ERA / 5.95 xERA collapse with corroborating barrel% spike — are
both handled by a single mechanism at the talent layer.

The probe scores the pitcher's current-season *leading indicators*
(K%, BB%, whiff%, barrel%, fastball velocity) against prior season:

```
zᵢ = (currentᵢ − priorᵢ) / SDᵢ        for each metric, sign-corrected
                                       so + = pitcher improved
significant = { zᵢ : |zᵢ| ≥ 0.8 }
score = Σ significant / max(2, |significant|)
```

The score is signed: positive = breakout, negative = decline. The
denominator floor of 2 dampens single-metric outliers; contradicting
metrics naturally cancel via the signed sum (so a "K% down but whiff%
up" pitcher gets a smaller absolute score than one where K% AND
whiff% AND barrel% all moved together).

The score scales BOTH the prior-season cap AND the league-prior weight
inside `computeTalent`:

```
regimeShrink   = max(0.25, 1 − 0.4 × |score|)
leaguePriorMul = sqrt(regimeShrink)
```

|score| of 1 → 0.6× prior-season weight; 2 → 0.2× (floored at 0.25).
The league prior weakens at `sqrt(regimeShrink)` — less aggressively
than prior-season — because population norms are a more stable anchor
than this-pitcher's-prior-year. At max regime shrink (0.25), the league
prior still gets 50% of its baseline weight. Symmetric for declines and
breakouts; both indicate the prior doesn't reflect current talent. The
shrinkage propagates through both `talentModel.computeTalent` (K, BB,
xwOBACON, HH blends) and `computeHrPerContact` (HR/contact blend).

Behavior across the four canonical shapes:

- **Houser-style (decline confirmed by leading indicators)**: K% ↓ AND
  barrel% ↑ → `score ≈ −2.15` → prior cap × 0.25 → talent estimate moves
  hard toward current. xwOBA-allowed lands near .380 instead of the
  prior-anchored .335.
- **Montero-style (hot start with stable peripherals)**: K%, whiff%,
  barrel% all flat vs prior → `score ≈ 0` → prior cap unchanged →
  contact-quality outliers get regressed naturally toward prior.
  xwOBA-allowed lands at league-ish.
- **Skubal-style (stable ace, mild peak regression)**: small mixed
  signals → `score ≈ −0.5` → prior cap × 0.85 → talent estimate
  barely budges from prior.
- **Roupp-style (true breakout with multiple confirming signals)**:
  K% ↑ AND barrel% ↓ → `score ≈ +3.0` → prior cap × 0.25 → talent
  estimate moves toward current.

This replaces the previous `computeSosMultiplier` SoS sample-shrinking,
which had the right intent (discount Montero-style hot starts) but the
wrong shape: it pulled *declining* pitchers facing weak lineups *toward*
their better prior, inflating the estimate. The regime probe handles
both directions symmetrically.

---

## BB compounding penalty (forecast layer)

xwOBA's linear weights are calibrated to the *average* run value of
each event. The BB weight (0.69 wOBA points) is what one walk in
isolation is worth across the population. For pitchers with extreme
walk rates, the actual run cost of walks is higher than that average,
because the second walk in an inning is more damaging than the first
(a runner is already on, errors / wild pitches / SBs are more impactful)
and linear-additivity collapses these compounding effects to a constant.
The xwOBA → xERA conversion is anchored at population mean BB ≈ .085,
so it's accurate near the mean but understates ER risk for high-BB
pitchers — Lopez-shaped profiles where xERA looks fine but actual ERA
runs much higher than walk rate alone would explain.

`bbCompoundingPenalty(bbPerPA)` in `forecast.ts` adds an additive ERA
bump to the talent-derived `expectedERA`:

```
penalty = clamp((bbPerPA − 0.085) × 10, 0, 1.0)   // ERA points
```

- 8.5% BB (league mean): +0.00 ERA — no effect on average pitchers
- 12% BB: +0.35 ERA
- 15% BB: +0.65 ERA
- 18%+ BB: capped at +1.00 ERA

This is a one-sided correction: pitchers walking at or below league
mean get nothing. The slope (×10) is calibrated to the empirical
observation that pitchers walking 15% run roughly +0.7 ERA above their
xERA on average across the MLB pitcher distribution.

The penalty lives at the forecast layer (not in the talent vector or
the shared `xwobaToXera` primitive) because:

- It's about projecting *actual ER from talent in a game*, not about
  composing xwOBA from events. xwOBA stays clean linear weights.
- It has no batter-side analogue. Batter-vs-pitcher rating reads
  `forecast.expectedPerPA` for log5; it doesn't read `expectedERA`.
  Putting the penalty here keeps the batter side untouched.
- It's symmetric to the way park / weather / opp adjustments already
  modify forecast outputs without touching shared primitives.

---

## Confidence

`PitcherTalent.confidence` is **not** a multiplier. The talent layer
already handled thin-sample shrink via the regression — applying a
second downweight at scoring time would double-count.

It's an annotation, derived from two PA inputs that answer different
questions:

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

The two PA inputs differ deliberately. The tier-`level` reflects how
much DATA backs the talent estimate (prior-season sample is real
information). The numeric `band` reflects how stable THIS YEAR'S
sample is at pinning down current talent — a thin current sample
with a fat prior produces a confidently-estimated mean but a real
± uncertainty, because if the prior turns out to be contaminated,
the estimate moves a lot.

The UI surfaces the level as a pill / breakdown row AND the band as
`62 ± 8` next to the score when band ≥ 5 — so users can distinguish
a confident 62 from a thin-sample 62 at a glance. We don't suppress
the tier; the talent regression already placed the pitcher where the
data says they should be.

---

## What lives where

```
src/lib/pitching/
  talent.ts        Layer 1 — PitcherTalent + computePitcherTalent + computeRegimeShift
  forecast.ts      Layer 2 — GameForecast + buildGameForecast + multiplier builders
                   (xwobaToXera lives here, see "Calibration anchors" below)
  rating.ts        Layer 3 — PitcherRating + getPitcherRating + tierFromScore
  scoring.ts       Streaming-page rating composition layer — exports `scorePitcher`
                   (UI-shaped wrapper that takes ProbablePitcher + MLBGame and
                   composes Layer 2 + Layer 3 into the table-shaped output the
                   streaming board / today / breakdown panel consume).
                   `scorePitcher` and `getPitcherRating` (rating.ts) are
                   intentionally distinct: the rating-layer one is pure (forecast
                   in, rating out), this one is the consumer-facing compose layer.
  display.tsx      UI helpers — tierColor, weatherIcon, riskSummary, etc.

src/lib/mlb/
  schedule.ts      Stamps `pp.talent` onto every enriched ProbablePitcher.
  players.ts       getPitcherSeasonLines (Stats-API line input for talent).
  teams.ts         getTeamOffense — game-context opp lookup (forecast layer).
  batterRating.ts  Reads `sp.talent` directly for log5 + HR/PA + BAA computations.
                   No raw `pp.era`/`pp.hr9`/`pp.battingAvgAgainst` access remains.

src/app/api/admin/test-pitcher-eval/route.ts
                   Smoke harness — synthetic profiles that exercise the full
                   Layer 1→2→3 pipeline. Returns 200 only when every profile
                   lands inside its expected score/tier band. Auth-gated; hit
                   it after touching anything in `src/lib/pitching/`.
```

## Calibration anchors

The numeric constants in the pipeline are anchored to the league-average
distribution. Touch with care — these are "global blast radius" knobs.

| Constant | Value | Anchor |
|----------|-------|--------|
| `xwobaToXera` slope (forecast.ts) | 25 | League-avg xwOBA-allowed (.318) → 4.20 ERA |
| `xwobaToXera` intercept | -3.75 | Same anchor |
| `xwobaToXera` clamps | 1.50, 7.50 | Practical floor/ceiling for single-game projections |
| Velocity slope (down) | 0.04/mph | -1 mph YoY → ~5% performance drop |
| Velocity slope (up) | 0.03/mph | +1 mph YoY → ~3% performance lift (asymmetry empirically motivated) |
| Velocity multiplier cap | ±6% (0.92, 1.06) | Single-factor cap on composite influence |
| `tierFromScore` thresholds | 78 / 62 / 42 / 28 | Score boundaries between ace/tough/avg/weak/bad |
| `PA_FULL_TRUST` (talent.ts) | 200 | Effective PA at which regression places no weight on league prior |
| Bullpen halving in P(W) | 0.5 | Bullpen pitches ~3 of 9 innings; halving caps its W impact at ±5% |

The `/api/admin/test-pitcher-eval` smoke harness encodes these anchors as
score/tier ranges per archetype. If you re-tune any of the above, also
update the expected ranges in that file.

### Deleted in this rebuild

- `src/lib/mlb/model/quality.ts` (`classifyPitcherTier`, `MIN_IP_*`).
- `src/lib/pitching/quality.ts` (`pitcherTalentScore`,
  `pitcherTalentFromBatterPerspective`, `tierToPitcherScore` fallback).
- `getPitcherQuality` orchestrator in `players.ts`.
- `pp.quality.tier` field on ProbablePitcher and its enrichment.
- `tierToEra` synthesis (forecast layer derives ERA from xwOBA directly).
- `MIN_SP_IP` gate in `getBatterRating` (talent's Bayesian regression
  handles thin samples).
- `dataCredibility` multiplier in scoring.ts (replaced by confidence
  annotation; no double-shrink).

---

## How to debug a pitcher

The breakdown UI is the truth. Per pitcher:

1. **Talent pane** — read `pp.talent`. Is `confidence` low? Is
   `effectivePA` < 80? If so, you're looking at a thin sample —
   regression has pulled the rates toward league mean.
2. **Forecast pane** — `forecast.expectedPerPA` shows what the engine
   thinks this pitcher will do *in this game*. Compare to talent —
   the delta is the matchup adjustment.
3. **Rating pane** — `rating.categories` shows the per-cat normalized
   score. Multiplier strip below shows velocity/platoon/park/weather/opp.

If a pitcher seems mis-rated:

- **Wrong tier** — score and tier are derived from the same number.
  If `tier === 'ace'` and `score < 78`, that's a bug. File it.
- **Sample-vs-rating disagreement** — check `confidence` and `regime`.
  A wide ± band (e.g. `62 ± 9`) on a thin current sample is the model
  telling you "I'm anchored to prior, but it might not be applicable."
  A `regime.score` near 0 with `declines + breakouts ≥ 2` means leading
  indicators contradicted each other — confused profile, prior preserved.
  These are features, not bugs.
- **Doesn't match Yahoo's ERA / WHIP** — those are surface stats. The
  rating uses `expectedERA` and the talent's per-PA outcomes. They
  differ on hot starts (talent hasn't budged) and cold starts
  (talent regression is pulling toward prior).

---

## Migration notes for new code

- Importing `pp.quality.tier` — the field is gone. Compute a rating
  and read `rating.tier`, OR read `pp.talent` and derive a tier-style
  judgment from `expectedERA = xwobaToXera(talent.xwoba_composed)`.
- Adding a new pitcher fantasy category — extend `PITCHER_NORM` in
  `rating.ts` with the worst/best window and the `formatExpected`
  string. Add the projection in `projectCategory`. That's it; the
  composite, focus weights, and tier mapping all flow through.
- Surfacing a new Savant signal — add to `StatcastPitcher` (types.ts),
  parse in `savant.ts`, plumb into `PitcherTalent` (UI-only fields go
  in the leading-indicators block; predictive fields fold into the
  regression at the talent layer). Don't add raw access on the
  consumer side — keep the talent vector as the only surface.
