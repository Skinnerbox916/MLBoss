# Forecast Verification — the ledger and the scorecard

The operator-facing loop that grades MLBoss's prediction engines against actual MLB results. Snapshot what an engine predicted **before** the game, materialize what actually happened **after** it, and aggregate the misses into a scorecard that points at which engine (and which calibration constant) to revisit.

Module home: `src/lib/ledger/`. Admin surface: `/admin/forecast` (operator role only). Storage: the Postgres ledger (see [data-architecture.md](./data-architecture.md#the-three-storage-legs)).

This is **not an engine** — it never influences a prediction, a rating, or a recommendation. It only observes them. Nothing in `src/lib/ledger/` may be imported by L1–L7 engine code.

## Why snapshots must be stored

A forecast is computed fresh from inputs that drift daily (talent state, probables, park/weather, lineup spots). "What did the model say last Tuesday?" cannot be recomputed later — the inputs are gone. That makes snapshots observations, not cache: rows are immutable, first-write-wins per identity, and no TTL.

The identity is `(game_date, engine, mlb_id, league_key, lead_days)`. `lead_days` (days between capture and the game) is part of the identity on purpose: the same start captured at D−3 and again day-of is two different forecasts, and comparing them answers "do forecasts sharpen as the date approaches?"

Honesty guards, enforced in `src/lib/ledger/capture.ts`:

- Snapshots are refused for past dates (`leadDays < 0`) — a "prediction" written after the fact is hindsight.
- Pitcher-slate capture skips games that are in progress or final.
- Capture calls the same canonical L1/L2 primitives the product uses — it never re-implements forecast math.

## Engines

| Engine key | What's frozen | League-scoped | Captured from |
|---|---|---|---|
| `pitcher-start` | L2 `buildGameForecast` per probable starter: expected IP/PA/K/BB/ER/H/HR, P(QS), P(W), xERA, xwOBA + game context | no | write-through on `/api/mlb/game-day`; manual `POST /api/admin/forecast/capture` |
| `batter-day` | Canonical batter day projection (`projectBatterPlayer`: L2 `buildBatterForecast` × lineup-spot PA model) per batter in a **posted** MLB lineup: expected PA + per-stat counts (R/H/2B/3B/HR/RBI/SB/BB/K/TB) + day score + spot context | no | same as `pitcher-start` |
| `batter-week` | The roster page's value substrate: playing-time-scaled neutral-week projections (`projectBatterNeutral` × `playingTimeFactor`) for rostered + FA bats — weekly PA + per-stat counts, graded against the next **Mon–Sun** window. This is the only engine that verifies the playing-time model: `batter-day` snapshots exist only on days a player was already in a lineup, so they structurally can't see "plays 4 games a week, not 5.5". Daily traffic re-captures the same window at shrinking leads; the scorecard dedupes to the closest capture per player-week. A week with zero games (IL / demotion) grades as DNP, and an ownership slice checks rostered vs FA symmetry — a bias there mis-prices every suggested swap. | yes | write-through on the roster page's league forecast route |
| `points-pitcher-start` | Matchup-adjusted expected points per priced start (FA board rows carry board `rank`; rostered arms `owned: true`) | yes | write-through on `/api/points/streaming` |
| `points-batter-day` | Matchup-adjusted expected points per batter per window day (>0 only) | yes | write-through on `/api/points/streaming` |

The slate engines are the statistically dense ones (~15–30 probables, ~200–300 lineup batters per day, league-free). `batter-day` captures posted lineups only, deliberately: the engine is graded on days it knew who was playing, so a DNP is a real miss (late scratch), not sampling noise — and lineups post progressively, so the write-through re-runs as new ones land (first-write-wins dedupes). The points engines additionally verify the *advice*: board rank at capture time is in `context.rank`, so the scorecard can ask whether top-ranked picks actually beat the pool.

The categories streaming boards are ranked client-side (see [streaming-page.md](./streaming-page.md)), so there is no server-side categories board rank to capture — engine accuracy for those flows is covered by `pitcher-start` and `batter-day`, which price the same slate through the same L2 layer.

The categories streaming boards' ranking scalars (`streamCatImpact` for batters, `streamPitcherCatImpact` for pitchers) are deliberately **not** ledger engines. They're roster-relative — the "prediction" is a *difference* against your own lineup/staff (net-over-displaced-starter for batters; net-of-team-week-ratio for pitchers), not an absolute player line, so there's no single MLB actual to grade. Their gradable inputs are already covered: per-player category production comes from `projectBatterPlayer` / `projectPitcherPlayer` (graded as `batter-day` / `pitcher-start`), and the batter playing-time share is the same `playingTimeFactor` that `batter-week` verifies against actual weekly PA. So a change to a streaming board's value/units (the 2026-07 batter and pitcher category-impact reworks) touches no captured prediction and must **not** bump `MODEL_VERSION` — doing so would falsely segment a cohort for a change the ledger can't see. One known seam, not a capture gap: `batter-week` estimates its full-time pace reference over the league-wide analysis pool while the streaming board estimates it over the FA pool only, so the two surfaces can assign a player a slightly different playing-time share.

## Actuals

`src/lib/ledger/score.ts` materializes `player_game_actuals` rows for every snapshot whose game date has passed: one MLB game-log fetch per player per run (1h-cached), sliced by date, doubleheaders summed. Actuals are refetchable in principle; they're materialized so grading a season never re-walks months of game logs.

Safety: an empty game log for a player we forecast is treated as a failed fetch (skip + retry next run), never as "didn't play" — first-write-wins storage means a wrong `no_game` would be permanent. Per-game parsers: `parsePitcherGameLines` / `parseBatterGameLines` in `src/lib/mlb/model/playerStats.ts` (IP converted via `parseIPToOuts`, not `parseFloat`).

## Findings

The page leads with **findings** — automatic, significance-tested flags — because per-game baseball stats are noisy enough that raw bias tables either scream everywhere or nowhere. A finding needs `|t| ≥ 3` (flag) or `≥ 2` (watch), where `t = bias / SE`, **and** a relative bias ≥ 5% / 3% of the actual mean. The t-bar is deliberately high: the page tests ~30 stat × slice combinations at once, so at t = 2 one false alarm per page is expected — treat *watch* as a hypothesis, *flag* as a to-do.

Detectors (in `buildScorecard`):

- **Per-stat bias** per engine (min n: 300 batter-days / 50 starts / 30 points rows; rare-event stats with actual mean < 0.05/game are excluded from ratio tests).
- **Conditional bias slices** — where aggregate tables hide misses: home/away (both sides), platoon side vs LHP/RHP, hitter vs pitcher parks, lineup spots 1–3 vs 7–9 (PA model). Two-sample t on the group biases. Slice keys come from snapshot `context` — new slices need the context captured *from that day forward*, which is why capture context is deliberately rich.
- **Probability calibration** (QS, W): any bucket whose forecast rate misses the realized rate by ≥ 6 points (n ≥ 25).
- **Discrimination inversion**: the 70+ composite-score bucket must out-produce the <45 bucket (K for pitchers, TB for batters), or the score isn't ranking.
- **Board-rank inversion** (points): FA ranks 1–3 realizing fewer points than ranks 11+.
- **Did-not-play rate**: scratches/bench days above baseline (a playing-time forecast miss, not noise).
- **Operational**: capture-coverage gaps (< 75% of days in span) and actuals backlog.

## The improvement loop

The ledger exists to improve the engines. The loop is **detect → localize → fix → verify**, and each stage has a tool:

**Detect** — findings (above). **Verify** — bump `MODEL_VERSION` with the fix; the by-model-version segment shows before/after. Caveat: it's an observational comparison, not an A/B — the league run environment drifts across a season, so read small before/after deltas skeptically and prefer the same-version bias trend.

**Localize** — the finding's shape points at the layer:

| Finding shape | Layer implicated | Where the constants live |
|---|---|---|
| Uniform per-stat bias (all slices agree) | L1 talent — regression priors / league anchors for that stat | `talentModel.ts`, `categoryBaselines.ts`, `talent.ts` (see [league-baselines.md](./league-baselines.md)) |
| IP and K biased proportionally; K/IP rate clean | Volume model, not rates | pitcher IP model in `forecast.ts`; batter PA-by-spot in `batterTeam.ts` |
| Knob slice (bias splits by applied modifier size) | That L2 modifier is mis-scaled | `parkAdjustment.ts`, `platoon.ts`, opp-log5 clamps in `forecast.ts` / `batterForecast.ts` (see [unified-rating-model.md](./unified-rating-model.md)) |
| Context slice (home/away, platoon side) without a knob split | A modifier is *missing* or keyed wrong | same files — but check the identity/handedness path first |
| Probability calibration gap | QS/W probability curves | `forecast.ts` probability section |
| Per-player persistent miss (worst-misses) | Talent inputs for that archetype (role change, rookie prior, injury) | talent layer + `playingTime.ts` |
| High DNP rate | Playing-time / probables assumptions upstream of everything | capture is honest; look at scratch patterns in context |
| Score-bucket inversion | Composite weighting at L3 | `batterRating.ts` / `rating.ts` weight vectors |

The knob slices work because capture stores **modifier attribution**: pitcher snapshots carry each applied multiplier (`context.mults.park/opp/weather/platoon/velocity/bullpen`), batter snapshots carry the per-stat adjusted/baseline ratio (`context.mods`). Grading the knob directly ("did the starts we park-boosted actually allow fewer runs?") separates "the knob is wrong" from "the talent estimate is wrong" — the distinction that decides *which* constant to touch.

**Fix** — follow the calibration discipline in [architecture.md](./architecture.md): read the linked doc section, anchor to research, run the smoke harness, bump `MODEL_VERSION`.

## Scorecard

`src/lib/ledger/scorecard.ts`, served by `GET /api/admin/forecast/scorecard`. All metrics computed in app code over one joined query — adding a slice never needs a migration.

- **Bias** (mean predicted − actual), **relative bias** (% of actual mean — comparable across stats), and **MAE** per stat per engine. Bias is the tuning signal; MAE is the noise floor.
- **Score buckets** — realized production by predicted composite score (<45 / 45–55 / 55–70 / 70+): the discrimination view behind "does an 80 actually out-produce a 55?"
- **Calibration** for probability forecasts (QS, W): predicted-probability buckets vs realized rates.
- **Lead-day segments** — D−0 vs D−3 accuracy.
- **Model-version segments** — before/after a tuning change (see below).
- **Rank quality** (`points-pitcher-start`): FA board rank buckets (1–3 / 4–10 / 11+) vs realized points.
- **Worst per-player misses** (≥3 graded starts) — candidates for talent-layer investigation.
- **Did-not-play rate** — predicted appearances that never happened (scratches, benchings); itself a forecast-quality signal.

Actual fantasy points for the points engines are computed by `src/lib/ledger/actualPoints.ts` — the grading twin of the `pointsValue.ts` dot-product, same `stat_id` vocabulary as `rateVector.ts` (stat 33 scored per out).

## Model versions & the change manifest

`MODEL_VERSION` in `src/lib/ledger/modelVersion.ts` is stamped onto every snapshot. **Bump it whenever a change alters what an engine predicts** — calibration constants, league means, prior strengths, new modifiers, engine math (UI and plumbing don't bump) — **and add a `MODEL_CHANGELOG` entry naming what it touched** (which engines, which stat keys; `'*'` = all). It complements the point-in-time smoke harness (`/api/admin/test-pitcher-eval`) as its longitudinal sibling.

**Snapshots are never deleted on a version change.** The old-version data is the control group for the before/after that proves the change helped — deleting it deletes the proof, and snapshots can't be regenerated (they're frozen world-states). Nor are snapshots knob-separable: a single batter-day row bundles PA and every stat at once, so there's no "just the PA knob's data" to flush — that separation only exists at read time. So instead of flushing, the scorecard reads by **live cohort** (`liveCohortVersions`):

- A stat **no change since touched** pools every version into one unbroken, growing sample. A batter-PA tune never touched pitcher K, so pitcher K keeps accumulating straight across the bump.
- A stat a change **did touch** resets: the headline shows only post-change data (its `pool` count drops to `1v`), while the older versions live on in the **By model version** table as the before-data.

The single global `MODEL_VERSION` string would otherwise over-segment — bumping it for a batter tune would reset the clock on unrelated pitcher stats. The manifest is what prevents that: it tells the scorecard exactly which metrics a bump invalidated, so everything else keeps compounding. The one legitimate deletion is *buggy* data (a capture defect, garbage inputs) — a surgical integrity cleanup, never a routine version bump.

## Operating it

1. Browse the app normally — the streaming/lineup pages write snapshots through as a side effect. `/admin/forecast` → "Capture today's slate" covers days nobody opened the app.
2. Every few days: "Score pending actuals" (idempotent; failures stay pending).
3. Read the scorecard. Sample-size honesty: slate-wide bias is meaningful after a few weeks; per-player misses need a month-plus.

There is no scheduler yet — capture depends on traffic or the manual button. If gaps become a problem, a cron hitting `POST /api/admin/forecast/capture` + `/score` is the designed extension point.
