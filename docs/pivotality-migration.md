# Pivotality migration — retiring chase/hold/punt

Status: **final, ready to start.** This doc is the contract for the refactor and the rationale home for the new model. Delete or fold into `recommendation-system.md` once the migration lands and the phases are all checked.

## Why

The focus system today is a 3-state label per category — `Focus = 'chase' | 'neutral' | 'punt'` — with weights `chase=2 / neutral=1 / punt=0` fed into every rating engine. Two problems:

1. **The tiers are a step-function standing in for a smooth curve.** "Chase" vs "hold" was only ever a magnitude difference on one underlying axis (how contested a category is). Direction never lived in the label — it's inherent to the stat (`betterIs`). So the label carried no information the `margin` doesn't already have, and the flat `2×` chase boost was arbitrary.

2. **"Chase everything you're losing" over-commits.** Today `suggestFocus` chases *every* category with `margin ≤ 0`, treating a slim deficit, a near-miss, and a hopeless loss the same. The right behavior is a smooth leverage weight — fight hardest where the category is most contested — plus honest concession of only the categories that are actually *decided*.

**What we explicitly are NOT building:** an earlier draft proposed a global majority optimizer (maximize `P(win a majority)` via a `KEEP_THRESHOLD` / `BUFFER` / greedy-fill over batting+pitching together). We rejected it as too rigid. In an H2H matchup you don't want a majority floor force-conceding categories that are still in play: when you're behind, every point still matters, and the batting and pitching sides can each carry a win independently. So there is **no majority count, no cross-side coupling** — batting and pitching are computed independently, and concession is purely a function of whether a single category is decided.

**Direction is presentation, not weight.** Within the set of categories we're contesting, direction doesn't change the action — the optimizer already pushes a category the right way through the sign of each play's production effect (more R helps, more K hurts). So the pivotality weight is **direction-blind**. Direction only governs *presentation* at the extremes: a decided win stays in play but deweighted ("we've got this"), a decided loss is conceded ("we give up here").

## The model

### Pivotality — the in-play gradient (shared primitive)

```
pivotality(distance) = exp(−distance² / 2w²)        distance ∈ [−1, +1],  w = 0.35
```

One **pure function**, used identically as the primitive on the matchup side (L5) and the roster side (L6). Peaks at `distance = 0` (a coin-flip is maximally worth fighting for) and decays symmetrically. Direction-blind.

The function is the *only* thing the two layers share. **Each layer produces its own `distance`** (see below) — never feed one layer's distance into the other.

`w = 0.35` rationale (matchup terms): a not-quite-safe lead (`distance ≈ 0.4`) keeps ~half weight so we don't bleed it; a near-decided cat (`distance ≈ 0.7`) drops to ~13% — effectively ignored, but it re-asserts if the gap closes.

### Concession and decided wins (sign-aware presentation)

A single threshold `DECIDED_THRESHOLD` on `|margin|` classifies the extremes. There are **three internal states** but only **two user-facing presentations**:

| State | Condition | Weight | Presentation |
|---|---|---|---|
| Contested | `|margin| < DECIDED` | `pivotality(margin)` | In-play list, ranked by pivotality |
| Decided win | `margin ≥ +DECIDED` | `pivotality(margin)` (naturally low) | **Stays in the in-play list**, annotated "decided — not chasing" |
| Conceded loss | `margin ≤ −DECIDED` | **0** | **Punt shelf** — the only user-facing "punt" |

A decided win is **not** a concession — the user never sees it labeled "punt." It's deweighted behind the scenes by the bell and stays in the default in-play view; it re-asserts the moment the lead erodes. The punt shelf holds **only** conceded losses — "ok, I give up here so I can concentrate elsewhere."

This auto-concession only fires on a *decided* (out-of-reach) loss — never to satisfy a quota. A reachable deficit (`−DECIDED < margin < 0`) stays in-play and gets fought for, per the "every point matters" principle above.

### Combined weight

```
weight(cat) = conceded(cat) ? 0 : pivotality(margin)
```

Then renormalized across non-zero cats inside each rating engine (as today). User override layer (localStorage) expresses "force-contest this" or "concede this" against the algo's defaults.

### Layer independence (load-bearing)

- **Batting and pitching are independent.** No shared majority count, no cross-side coupling. Sweeping the pitching cats does **not** change the batter weights.
- **L5 weekly concession is computed from this week's margins only.** It is **not** inherited from L6 roster strategy. A season-long roster punt (e.g. "built without speed, punting SB for the year") must not force a weekly punt — if a given week has SB sources in play, that week fights for SB. See [roster-strategy.md](roster-strategy.md) "Weekly punts stay independent of roster-construction punts."
- The only shared thing across horizons is the pure `pivotality()` function. `distance` and the concede decision are produced **per layer**.

### Roster side (L6)

The roster page optimizes a **different objective** than the matchup page: season-long league standing ("reach near the top"), not winning one week's H2H. Its competitive distance and its concede logic are not the matchup margin.

- **Keep rank + RUPM.** Do **NOT** introduce a `movesFromMedian → margin` mapping. The roster engine deliberately rejected the median benchmark (median ≈ rank 5–6 ≈ a coin flip; see [roster-strategy.md](roster-strategy.md) "No median benchmark") — a margin bell centered on the median would tell you to stop investing the moment you clear average, which is the opposite of "reach the top."
- **Feed `pivotality()` the roster's own reachability distance** — `movesToTarget` in RUPM units, so the peak sits at "one move from a winning rank (1–2)," not at the median.
- **Concede stays = existing unreachable logic** (`targetRank` undefined). The bar to concede on the roster side is *higher* than on the matchup side: conceding a category in roster construction forfeits its output every week all season, vs. a single matchup's one week.
- **Resource-reallocation punt is OUT of scope** (the punt-SV-frees-RP-slots strategy). Backlogged in [roster-strategy.md](roster-strategy.md) "Concession as resource reallocation." This migration must not foreclose it — keeping `pivotality()` pure and the concede decision per-layer is exactly what leaves the door open.

## Calibration constants (defaults; tune by watching real weeks)

Values live in code; this table is the rationale pointer only.

| Constant | Default | Controls |
|---|---|---|
| `w` (pivotality width) | 0.35 | How fast a cat stops mattering as it gets decided |
| `DECIDED_THRESHOLD` (`|margin|`) | 0.7 | Past this a cat is decided: a win → "decided, not chasing" (stays in-play, deweighted); a loss → conceded (punt shelf, weight 0) |

Roster side reuses its existing tunables unchanged (`REACHABLE_GAP_MOVES`, `ANCHOR_RANK_THRESHOLD`, `RUPM_K`, …); the `M` median-margin scale from the earlier draft is **removed** (no median margin).

## Phases

Each phase ends `tsc`-clean. The tree is never left in a half-migrated state across a session — no dual focus systems.

- [x] **Phase 1 — Pivotality primitive.** Added `pivotality(distance, w)` (pure, `src/lib/rating/pivotality.ts`). No callers, no behavior change.
- [x] **Phase 2 — Rating engines accept the numeric weight substrate (low-risk, behavior-identical).** `getBatterRating` / `getPitcherRating` gain an **optional** `categoryWeights: Record<number,number>` that, when omitted, defaults to `focusToCategoryWeights(focusMap)` (a transitional bridge in `rating/focus.ts`: chase=2 / neutral=1 / punt=0). `buildWeightVector` is now numeric (`raw[id] = max(0, categoryWeights[id] ?? 1); renormalize`). `CategoryContribution` / `PitcherCategoryContribution` **keep `focus`** (still drives the existing display + sitValue, removed later) and **add `conceded: boolean`** (`(categoryWeights[id] ?? 1) <= 0`). Because the bridged weights render identically to the old focus-keyed vector, **no caller or consumer changed** — the whole point of the optional-with-default shape. (Originally drafted as a hard `focusMap → categoryWeights` swap with `focus` dropped; that was re-sequenced because `CategoryContribution.focus` is read by `sitValue` (Phase 4) and `PlayerSplitsPanel` / `scoring.ts` (Phase 5), so dropping it here would have forced those reworks early. Each consumer now changes once, in the phase that reworks its semantics.)
- [ ] **Phase 3 — Weight production (the brain).** New `buildCategoryWeights(analysis, overrides) → { weights, conceded, decidedWins }`: **per side independently**, apply `pivotality(margin)` to contested + decided-win cats, zero the conceded (decided-loss) cats, respect user overrides. Call sites start passing **explicit `categoryWeights`** into the rating engines (the Phase-2 bridge default falls away). `analyzeMatchup`: keep `margin`/`priority`/`leverage`, **delete** `suggestFocus` / `suggestedFocus` / `LOCKED_THRESHOLD`. `useSuggestedFocus` → `useCategoryWeights`: same localStorage override mechanism, defaults from `buildCategoryWeights`, user action = toggle concede/contest. Also **add the missing renormalization in `blendedCategoryScore`**. **L6 roster:** `forwardFocus` produces numeric weights via `pivotality(movesToTarget-distance)`; concede stays = `targetRank` undefined; **no `movesFromMedian → margin`**. Update consumers: `LineupManager`, `StreamingManager`, `RosterManager`, `TodayPitchers`, streaming boards, dashboard. This is where the numbers actually change — run the smoke harness here.
- [ ] **Phase 4 — Sit/optimizer in pivotality terms.** Refactor `sitValue.ts`: delete `categoryWeight` / `LOCKED_WIN_RESIDUAL` / the focus ternary; weight every cat by its pivotality weight. Keep the opponent-AVG anchor. Carry the K-winnability check forward. Re-confirm "chase K doesn't bench everyone."
- [ ] **Phase 5 — UI collapse.** Centerpiece `focusPanel.tsx`: `FocusSectionTrio` (3 sections) → one **in-play list ranked by pivotality** (decided wins annotated "decided — not chasing") + a **concession shelf**; `FocusSegmentedControl` (3-way) → **2-state concede toggle**. Cascades to `GamePlanPanel`, `RosterFocusPanel` (tiles keep distinct content — margin vs RUPM/rank). `ScoreBreakdownPanel`/`PlayerRow`: `conceded` flag instead of focus label. `bossBrief`: keep "cruising in" / "chase", drop "hold". `BossCard` highlight: retarget to pivotality. **Direction (ahead/behind) must stay a visible channel** — the weight is symmetric but a slim lead and a slim deficit read differently to the user, so preserve the ahead/behind narrative even though it no longer drives the weight.
- [ ] **Phase 6 — Delete + document.** Remove the `Focus` union and any dead references. Rewrite `recommendation-system.md` and `unified-rating-model.md` around pivotality; update `engines.md`; add a `history.md` entry (chase/hold/punt retired → pivotality + decided-loss concession; batting/pitching decoupled; global majority optimizer considered and rejected as too rigid, with the why). Run the smoke harness (`/api/admin/test-pitcher-eval`), `tsc`, `eslint`, browser-smoke `/lineup` `/streaming` `/roster` `/dashboard`.

## Risks / watch-items

- **`DECIDED_THRESHOLD` calibration.** Too low → over-concedes losses we could still fight (violates "every point matters"); too high → keeps hopeless cats cluttering the in-play list. Stress-test the blowout (most cats decided losses — we still contest the reachable few) and sweep (most cats decided wins — they stay in-play, deweighted, not conceded) cases.
- **Direction must survive the UI collapse.** The 2-state toggle and pivotality ranking discard direction from the *weight*; make sure the panel still surfaces ahead/behind visually (the winning/losing border exists today in `GamePlanPanel`).
- **Roster numeric-weight port must not regress to a median margin.** Verify the L6 weight peak sits at "one move from a winning rank," not at the median. The roster side keeps rank + RUPM; only the pure `pivotality()` function is shared.
- **Wide-blast calibration change** → run the pitcher-eval smoke harness per `CLAUDE.md`.
