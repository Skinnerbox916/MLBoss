# DFS Cash-Game Edge Backtester — PRD (proposal)

**Status:** proposal, not built. Operator-only when built; never feeds engines (same wall as the [forecast ledger](./forecast-verification.md)).

**One line:** Before building any live daily-fantasy entry machinery, prove — or disprove — that MLBoss's per-player projections beat a DFS cash-game field by enough to clear the rake, by replaying the engines' own frozen historical predictions against actual results.

## Why this, and why first

The target strategy is a **law-of-large-numbers grind**: many small entries, relying on a projection edge over casual players to grind out positive return. That only works in **cash games** (double-ups / 50-50s / head-to-head), where you win by beating the field *median* — low variance, small edge, repeated all season. It does **not** work in tournaments (top-heavy payouts, needs ownership/correlation, not a grind).

The edge must clear the rake: cash contests pay ~1.8× on a win (house keeps ~10%), so break-even cash rate is **~55.6%**. A thin projection edge is worthless if it can't clear that tax. The expensive, risky parts of a real DFS operation — live salary ingest, ownership modeling, contest entry, real money — are all worthless if the edge isn't there in the first place.

So build the **proof, not the casino.** The ledger already stores what each engine predicted *before* every game (frozen, no hindsight) and grades it against actual MLB lines. That is exactly the substrate to measure the edge for near-zero incremental data cost.

**Non-goals (deliberately out of scope):** live contest entry, real-money anything, tournament/GPP strategy, ownership/leverage modeling, correlation/stacking. Those come later, and only if this gate passes.

## The question it answers

Over a sample of historical slates: if we had entered our single cap-optimal lineup into a standard Yahoo double-up, what would our **cash rate** and **net-of-rake ROI** have been — and is it distinguishable from zero given the sample size?

**Go / no-go gate:** the net-ROI confidence interval must clear the rake (not merely be positive in point estimate). If it doesn't, the strategy is −EV and no amount of volume fixes it — LLN just makes you lose more reliably.

## Method (the cash-game math)

- Payout ≈ 1.8× on a win ⇒ break-even cash rate `p* = 1/1.8 ≈ 0.556`.
- Expected ROI per unit stake `= 1.8·p − 1`. A good grinder runs `p ≈ 0.56–0.58` → **1–5% ROI**. This is a thin-margin grind, not a printer.
- Per-entry variance is high relative to edge (σ ≈ 0.9 per unit stake). To be 95% confident the edge is real you need `N ≳ (1.96·σ / edge)²` — a ~4% edge needs **~1,600+ independent slates**.
- Slates ≈ 180/season, and **same-slate entries are correlated** (one bad night sinks every lineup you entered that night), so the backtest's independent unit is the *slate*, not the contest. Confidence accrues slowly — the backtest is directional early and conclusive only with a season-plus of slates. Same honesty as the ledger's "slate-wide bias is meaningful after a few weeks."

## Pipeline (per historical slate)

1. Pull the day's **frozen predicted stat lines** from the ledger: `batter-day` (posted-lineup batters) + `pitcher-start` (probables). These are league-free raw lines, captured pre-game (no hindsight), and are exactly the DFS-eligible universe.
2. Convert each to **predicted DFS points** = dot(predicted line, DFS weight map). Reuses the `actualPoints.ts` dot-product shape.
3. Join **salaries** for `(gameDate, mlbId)`. *(net-new data — see below)*
4. Solve the **cap-optimal lineup** under Yahoo's roster construction + salary cap — a knapsack/ILP maximizing predicted DFS points. *(net-new optimizer)*
5. Score that lineup's **actual DFS points** = dot(`playerGameActuals` line, DFS weights). Reuses actuals + the `actualPoints.ts` shape.
6. Compare to the slate's **cash line** (median double-up score). *(net-new estimate — see below)*
7. Record: cashed? margin above/below the line? points left on the table vs. the hindsight-optimal lineup?

Aggregate across slates → cash rate, net ROI, variance, confidence interval, plus diagnostic slices (by slate size; whether the edge came from bats vs. arms; by lead-day).

## The two net-new inputs (the real work)

**Salaries — the gating dependency.** No salary/cost dimension exists anywhere in the app, and historical Yahoo DFS salaries are not readily available after the fact. Salaries are point-in-time like forecasts — they cannot be recomputed later. So unless a historical dataset is sourced, we **capture salaries forward**, daily, exactly as the ledger captures snapshots: a small write-through that freezes each slate's salaries. The backtest then *accrues over the season* rather than running retrospectively. If we want a season-sized sample, salary capture must start as early as possible.

**Cash line.** The median score to double up is the one number not derivable from what we own. Options, cheapest first: (a) **simulate a casual field** — draw N salary-proportional legal lineups, score them on actuals, take the median; (b) a real published cash-line dataset, if sourced; (c) a fixed calibrated threshold as a crude v0. Recommend (a): self-contained, and its error is itself measurable. Caveat: cash-line error propagates directly into ROI, so the report must show ROI sensitivity to a ± cash-line band.

## DFS scoring template

Net-new: encode Yahoo DFS MLB point values as a weight map (same shape as `ScoringProfile.weights` in [scoringProfile.ts](../src/lib/fantasy/scoringProfile.ts), keyed by `stat_id`). Two roster templates: **classic full-slate** (starting pitchers + batters under a cap) and **single-game** (5 flex batters, no SP — per Yahoo's single-game rules). Exact point values, roster composition, and the cap must be confirmed from Yahoo's live contest rules at build time — **do not hardcode guesses.**

## Reuse vs. net-new

**Reuse as-is:**

| Piece | Where |
|---|---|
| Frozen pre-game predictions (the honest edge input) | ledger `batter-day` / `pitcher-start` snapshots → `forecastSnapshots` ([schema.ts](../src/lib/db/schema.ts)) |
| Graded actuals | `playerGameActuals` + `scorePendingActuals` ([score.ts](../src/lib/ledger/score.ts)) |
| Stat-line → points dot product | [actualPoints.ts](../src/lib/ledger/actualPoints.ts), [pointsValue.ts](../src/lib/points/pointsValue.ts) |
| Live slate assembly (for forward salary capture / live use) | `getGameDay` ([schedule.ts](../src/lib/mlb/schedule.ts)), `resolveMatchup` ([analysis.ts](../src/lib/mlb/analysis.ts)) |
| Per-player matchup-adjusted daily projection (if recomputing vs. reading snapshots) | `projectBatterPlayer` ([batterTeam.ts](../src/lib/projection/batterTeam.ts)), `projectPitcherPlayer` ([pitcherTeam.ts](../src/lib/projection/pitcherTeam.ts)), `adjustedBatterPointsPerPA` ([matchupAdjust.ts](../src/lib/points/matchupAdjust.ts)) |
| Operator scorecard pattern | `buildScorecard` / `/admin/forecast` ([scorecard.ts](../src/lib/ledger/scorecard.ts)) |

**Net-new:**

- DFS scoring weight map + the two roster templates.
- Salary capture (forward write-through) + storage.
- **Cap-constrained (knapsack) optimizer** — the existing `optimizeLineup` ([optimize.ts](../src/lib/lineup/optimize.ts)) is a Hungarian slot-assignment and *cannot* express a budget constraint.
- Cash-line estimator (field simulation).
- Backtest aggregation + operator report (`/admin/dfs-backtest`).

Note on the point-conversion path: build DFS points from the **league-free** `batter-day` / `pitcher-start` raw stat-line snapshots dotted with DFS weights — **not** from the existing `points-*` engines, which are Yahoo-league-weight-scoped.

## Phasing

- **P0** — DFS scoring template + salary forward-capture. (Starts accruing the one input we don't have.)
- **P1** — knapsack optimizer + predicted/actual DFS point conversion over ledger snapshots.
- **P2** — cash-line field sim + aggregation report + the go/no-go gate.
- **P3+ (only if the gate passes)** — live salary ingest + live lineup builder; later, GPP/ownership/stacking as a separate effort with its own PRD.

## Risks & honest caveats

- **Rake is the whole hurdle** — ~56% cash rate just to break even.
- **Same-slate correlation** — "many bets" only diversify across slates; confidence accrues over a season-plus, not a night.
- **Thin historical sample** — the ledger only began capturing in the 2026 season, so early backtests are directional, not conclusive.
- **Salary sourcing is the gate** — no forward capture, no season sample.
- **Cash-line model error** propagates into ROI — always report sensitivity.
- **Field-softness assumption** — real cash games contain sharks; a simulated casual field is optimistic, so treat backtest ROI as a **ceiling**, not a forecast.
- **Backtest overfit** — do not tune engines to the backtest. The ledger wall (never feed engine improvements from this surface) applies here too.

## Open questions

- Historical Yahoo DFS salary source — does one exist, or is forward-capture the only path?
- First target: single-game (batter-only, smaller projection surface, softer fields) vs. classic full-slate?
- First contest shape to model: double-up is the cleanest LLN vehicle — start there before 50-50 / H2H.
