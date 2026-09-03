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
| `retro-pitcher-start` / `retro-batter-day` | The same two slate engines run **after the fact** on as-of inputs (see [Retro](#retro-as-of-date-forecasts-from-the-statcast-corpus)). Actual starters, posted lineups and observed weather come from hindsight, so these rows never pool with live captures; `lead_days` is a nominal 0 | no | `scripts/retro-capture.ts <date>` (never write-through) |

The slate engines are the statistically dense ones (~15–30 probables, ~200–300 lineup batters per day, league-free). `batter-day` captures posted lineups only, deliberately: the engine is graded on days it knew who was playing, so a DNP is a real miss (late scratch), not sampling noise — and lineups post progressively, so the write-through re-runs as new ones land (first-write-wins dedupes). The points engines additionally verify the *advice*: board rank at capture time is in `context.rank`, so the scorecard can ask whether top-ranked picks actually beat the pool.

The categories streaming boards are ranked client-side (see [streaming-page.md](./streaming-page.md)), so there is no server-side categories board rank to capture — engine accuracy for those flows is covered by `pitcher-start` and `batter-day`, which price the same slate through the same L2 layer.

## Snapshot context

Context is the slice vocabulary: every conditional finding the scorecard can ever run is limited to what capture stamped, and new slices only work from the day their key starts being captured. Beyond the modifier attribution (below), snapshots carry two kinds of fields added for the confounder screen (2026-07):

- **Frozen forecast inputs** — things the model priced that drift until game time and can't be reconstructed later: the forecast weather (`tempF`, `windMph`, `windDir`), the opposing probable's identity (`oppSpMlbId` — probables change), pitcher hand. Since 2026-07-25 pitcher snapshots also freeze `wParts` — the P(W) decomposition (`pTeam`, `credit`, `rs`, `ra`, `ownOffenseKnown`) — so a W miscalibration can be localized to win odds vs credit share vs a run-rate input instead of reverse-engineered from the total (what limited the first W pass).
- **Joinability keys** — `gamePk`, `gameTimeUtc`, `venueId`. These make *post-game objective facts* (home-plate umpire, catcher, days of rest, day/night) recoverable at analysis time from the MLB API without any pre-game fetch. Deliberately **not** captured at forecast time: umpire and catcher are mostly unassigned/unposted at capture leads ≥ 1 day, and rest days would add per-pitcher fetches to a fire-and-forget path — all of them are immutable historical facts once the game ends, so freezing them pre-game buys nothing.

Batter snapshots on doubleheader days carry game 1's keys (the `doubleHeader` flag lets a screen exclude those rows).

The categories streaming boards' ranking scalars (`streamCatImpact` for batters, `streamPitcherCatImpact` for pitchers) are deliberately **not** ledger engines. They're roster-relative — the "prediction" is a *difference* against your own lineup/staff (net-over-displaced-starter for batters; net-of-team-week-ratio for pitchers), not an absolute player line, so there's no single MLB actual to grade. Their gradable inputs are already covered: per-player category production comes from `projectBatterPlayer` / `projectPitcherPlayer` (graded as `batter-day` / `pitcher-start`), and the batter playing-time share is the same `playingTimeFactor` that `batter-week` verifies against actual weekly PA. So a change to a streaming board's value/units (the 2026-07 batter and pitcher category-impact reworks) touches no captured prediction and must **not** bump `MODEL_VERSION` — doing so would falsely segment a cohort for a change the ledger can't see. One known seam, not a capture gap: `batter-week` estimates its full-time pace reference over the league-wide analysis pool while the streaming board estimates it over the FA pool only, so the two surfaces can assign a player a slightly different playing-time share.

## Actuals

`src/lib/ledger/score.ts` materializes `player_game_actuals` rows for every snapshot whose game date has passed: one MLB game-log fetch per player per run (1h-cached), sliced by date, doubleheaders summed. Actuals are refetchable in principle; they're materialized so grading a season never re-walks months of game logs.

Safety: an empty game log for a player we forecast is treated as a failed fetch (skip + retry next run), never as "didn't play" — first-write-wins storage means a wrong `no_game` would be permanent. Per-game parsers: `parsePitcherGameLines` / `parseBatterGameLines` in `src/lib/mlb/model/playerStats.ts` (IP converted via `parseIPToOuts`, not `parseFloat`).

## Findings

The page leads with **findings** — automatic, significance-tested flags — because per-game baseball stats are noisy enough that raw bias tables either scream everywhere or nowhere. A finding needs `|t| ≥ 3` (flag) or `≥ 2` (watch), where `t = bias / SE`, **and** a relative bias ≥ 5% / 3% of the actual mean. The t-bar is deliberately high: the page tests ~30 stat × slice combinations at once, so at t = 2 one false alarm per page is expected — treat *watch* as a hypothesis, *flag* as a to-do.

Detectors (in `buildScorecard`):

- **Per-stat bias** per engine (min n: 300 batter-days / 50 starts / 30 points rows; rare-event stats with actual mean < 0.05/game are excluded from ratio tests).
- **Calibration slope** per stat: actual regressed on predicted must be ~1.0 — a property of honest conditional means, independent of how noisy the stat is. Slope < 1 = over-spread (predictions more extreme than outcomes reward: the talent layer over-trusts thin samples, or a multiplicative modifier amplifies the tails); > 1 = under-spread. Same t-bars against the slope's own SE, plus a ±0.15 magnitude floor. Orthogonal to bias — a stat can have a clean mean and a dishonest spread.
- **Conditional bias slices** — where aggregate tables hide misses: home/away (both sides), platoon side vs LHP/RHP, hitter vs pitcher parks, lineup spots 1–3 vs 7–9 (PA model). Two-sample t on the group biases. Slice keys come from snapshot `context` — new slices need the context captured *from that day forward*, which is why capture context is deliberately rich.
- **Probability calibration** (QS, W): any bucket whose forecast rate misses the realized rate by ≥ 6 points *and* falls outside the binomial 95% band (n ≥ 25). Buckets are equal-count bins over the sorted predictions (up to 6, ≥30 rows each), not fixed 20-point bands — a probability forecast concentrates in its own dynamic range (P(W) spans ~21–45%), and fixed bands squeezed all the data into two readable buckets plus outlier bins.
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
| Over-spread (slope < 1) with clean bias | L1 spread — prior too light for that stat, or a log5/ratio modifier amplifying the tails (multiplicative-in-odds errors hit extreme players hardest) | prior strengths in `talentModel.ts` / `talent.ts`; that stat's log5 or clamp in the forecast layer |
| Per-player persistent miss (worst-misses) | Talent inputs for that archetype (role change, rookie prior, injury) | talent layer + `playingTime.ts` |
| High DNP rate | Playing-time / probables assumptions upstream of everything | capture is honest; look at scratch patterns in context |
| Score-bucket inversion | Composite weighting at L3 | `batterRating.ts` / `rating.ts` weight vectors |

The knob slices work because capture stores **modifier attribution**: pitcher snapshots carry each applied multiplier (`context.mults.park/opp/weather/platoon/velocity/bullpen`), batter snapshots carry the per-stat adjusted/baseline ratio (`context.mods`) and, since 2026-09-01, its per-knob decomposition `context.knobs.<knob>.<stat>` (`pitcher` = SP+bullpen blend as an effective multiplier, `park`, `weather`, `order` for R/RBI, `hand`/`teamSb` for SB, `platoon`) plus the matchup-wide `context.spShare`. The product of a stat's knobs equals its `mods` entry. The decomposition exists for the fit layer: a regression of actuals on the talent baseline and each knob's log-multiplier estimates a coefficient per knob per stat (calibrated = 1.0) — the combined `mods` ratio can only ever move one dial. Grading the knob directly ("did the starts we park-boosted actually allow fewer runs?") separates "the knob is wrong" from "the talent estimate is wrong" — the distinction that decides *which* constant to touch.

**Fix** — follow the calibration discipline in [architecture.md](./architecture.md): read the linked doc section, anchor to research, run the smoke harness, bump `MODEL_VERSION`.

## Scorecard

`src/lib/ledger/scorecard.ts`, served by `GET /api/admin/forecast/scorecard`. All metrics computed in app code over one joined query — adding a slice never needs a migration.

- **Bias** (mean predicted − actual), **relative bias** (% of actual mean — comparable across stats), **MAE**, and **calibration slope** (actual-on-predicted; spread honesty) per stat per engine. Bias is the tuning signal; MAE is the noise floor; slope is the over-confidence check.
- **Score buckets** — realized production by predicted composite score (<45 / 45–55 / 55–70 / 70+): the discrimination view behind "does an 80 actually out-produce a 55?"
- **Calibration** for probability forecasts (QS, W): equal-count predicted-probability bins vs realized rates. Segments to the live model cohort like headline grades (keyed on the `qs` / `w` predicted keys in `MODEL_CHANGELOG`), so a probability retune resets its curve instead of re-flagging the miscalibration it fixed.
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

## Retro: as-of-date forecasts from the Statcast corpus

The ledger only sees days the app was open, and it lost most of Aug 2026 to two upstream outages ([history.md](./history.md)). A per-knob fit (above) needs tens of thousands of graded rows, which live traffic won't supply for a season. **Retro** rebuilds forecasts for past dates from inputs *as they stood the morning of the game* — no future leakage — so a whole season becomes fit data. Michael's constraint: no modeling without the Savant inputs, so the retro path had to recover those as-of too.

Module home: `src/lib/retro/`. Storage: `statcast_events` (Postgres; a rebuildable bulk corpus, **not** ledger data — see [data-architecture.md](./data-architecture.md#the-three-storage-legs)). Nothing in `src/lib/retro/` is imported by engine code.

**Why Savant is recoverable as-of.** The talent layer reads Savant's *season* leaderboards (`src/lib/mlb/savant.ts`), which exist only as season-to-date totals — a July forecast rebuilt from them today would include August. Savant's `statcast_search/csv` export returns every pitch for a date range with the fields those leaderboards are built from (`estimated_woba/ba/slg_using_speedangle`, `launch_speed/angle`, `launch_speed_angle` (6 = barrel), `description`, `pitch_type` + `release_speed`, `delta_run_exp`, hands). Owning the events lets us aggregate them through any date.

Pieces, in pipeline order:

| Piece | Where | What it does | Validation |
|---|---|---|---|
| Puller | `pullStatcastDay` (`statcast.ts`); `scripts/retro-pull-statcast.ts <from> [to]` | One game date of raw pitches → `statcast_events` (upsert — Savant revises estimates after the fact). Reconciles each game's PA/K/BB/HR/H against the MLB box score as it runs. Postponed entries are skipped. | Jul + Aug 2026: every game exact once `truncated_pa` (an at-bat cut off by an inning-ending baserunning out) is excluded from PA |
| Formulas | `scripts/retro-validate-aggregates.ts <batter\|pitcher> <from> <to>` | Per-player aggregates over a window vs Savant's own per-player summary for the same window | Counts exact; xwOBA \|diff\| ≈ 0.001, xBA/xSLG ≈ 0.002; K%/BB%/hard-hit%/barrel rate to displayed precision. Conventions: BB includes IBB; whiffs include foul tips; xwOBA = `est_woba` on tracked BIP else actual `woba_value`, over Savant's `woba_denom`. Hard-hit% denominators differ by surface: the summary export uses *tracked* batted balls, the skills leaderboard the engine reads uses *all* — the aggregator follows the leaderboard |
| xERA | `fetchXeraMapping` / `xeraFromXwoba` (`xera.ts`); `scripts/retro-xera-mapping.ts` | Savant's xERA formula is unpublished, but on the season pitcher leaderboard it is a smooth function of xwOBA alone. Fit a cubic per season (run-environment scale) and apply it to as-of xwOBA | 2026: rmse 0.004 ERA in-sample (PA ≥ 50), hold-out rmse 0.03; residual uncorrelated with PA, xSLG, xBA |
| As-of aggregator | `pitchersAsOf` / `battersAsOf` (`asOf.ts`); `scripts/retro-asof-check.ts <asOf>`; `scripts/retro-asof-leaderboard-check.ts [asOf]` | `StatcastPitcher` / `StatcastBatter` rows — the exact shape `savant.ts` produces — from events **strictly before** `asOf`. Returns `coverage` (window seen, `seasonComplete`) so a partial corpus is never mistaken for season-to-date. Actual wOBA uses season linear weights over AB+uBB+SF+HBP (`WOBA_WEIGHTS`, refit with `scripts/retro-woba-weights.ts` — the export's per-pitch values are rounded generic weights and run +0.007). `era` stays null (not derivable from pitches; the engine takes actual ERA from MLB stat lines) | **Definitive check** (corpus complete Mar 25 → yesterday, as of 2026-09-02) against the season leaderboards the engine reads, 478 pitchers + 432 batters ≥100 PA: PA exact for every player, xwOBA 0.001, wOBA 0.000, xwOBAcon 0.000, xERA 0.02 (max 0.13), K%/BB%/whiff/barrel to display precision, hard-hit 0.1, usage-weighted fastball velo 0.02 mph; 0 players with PA past the cutoff |

Pull cadence: month-sized runs inside the prod container (`docker exec <app> npx tsx scripts/retro-pull-statcast.ts 2026-07-01 2026-07-31`, ~3 min); dev takes a `copy … to stdout with csv` from prod rather than a second Savant pull. Corpus: the full 2026 regular season from Mar 25 (~615k pitches, 2,084 games, every game reconciled). Keep it current with a daily one-day pull. Status detail: the session memory note `project_retro_corpus`.

| Retro capture | `retroCaptureDay` (`retro/capture.ts`) + the as-of seam `src/lib/mlb/asOfContext.ts` + interceptor `retro/mlbAsOf.ts`; `scripts/retro-capture.ts <date> [to]`, `scripts/retro-compare.ts <date>` | Runs the **unchanged** engines on a past slate. Under the as-of context: Redis is bypassed entirely; Savant comes from the corpus aggregate; MLB season totals become date ranges through D−1; game logs are sliced; the starter line is summed from the sliced log; platoon splits (player and team) come from the corpus (R/RBI/SB aren't PA events → those platoon ratios fall back to the population prior); team SP/RP role lines come from the corpus (starter = first pitcher of the game) with team-level as-of ERA and SB. Prior-season, identity and schedule requests pass through; any other `stats=` request logs `[retro] pass-through` so leakage is visible. The slate itself is the completed date's schedule: its probables are the actual starters, plus posted lineups and observed weather, then the shared `enrichSlate` | **Golden test, 2026-08-09** (retro vs live lead-0 rows): pitchers K corr 1.000 (mean \|diff\| 0.004), ERA 0.02, xwOBA 0.001, IP/PA exact. Batters where both saw the same starter (72 rows): every stat corr ≥ 0.994, mean \|diff\| ≤ 0.01, combined modifiers agree to 0.002. The other 72 rows differ because ESPN's Aug 9 probables were wrong in 8 of 15 games — the churn the live DNP finding counts |

### What the corpus says about Statcast's contribution

Statcast metrics and box-score metrics are **complementary, not rival** — they overlap heavily and each carries forward-looking signal the other doesn't. `scripts/retro-statcast-value.ts [split] [minPA]` splits the season at a date and partitions the variance in *next*-window performance three ways (unique to the box score / shared / unique to Statcast) via `commonality()` in `retro/predictiveness.ts`, with an F-test on the Statcast term. Aggregation reuses `aggregateWindow` from `asOf.ts`, so the conventions match the as-of rows exactly.

2026 season, three split dates (late May / late June / mid July), players with ≥120 PA on both sides:

- **Batters — Statcast carries most of the unique signal.** For next-window wOBA the box score alone explains 1–3% of variance and the pair explains 7–9%, with 56–86% of the total unique to Statcast (p ≤ .003 at all three splits). Same shape for AVG and for contact quality → TB/PA. The *only-box* column is near zero: once xwOBA/xBA is in the model the traditional rate adds almost nothing of its own.
- **The exception is where the box score already measures the skill directly.** Strikeouts: K-rate alone explains 57–62% and whiff rate adds only 4–6 points on top (a real addition, p < .001, but a small share of a large total). Home runs behave the same way — HR-rate is already strong, barrels add a modest unique slice.
- **Pitchers — the two are closer to co-equal, and Statcast's edge is inconsistent.** Its unique contribution to next-window wOBA/AVG is significant at two of the three splits and absent at the middle one; for power, HR and strikeouts it is not significant, and for K-rate the *box score* holds 7–12% unique variance that Statcast does not. This matches the long-standing asymmetry: hitters own their batted-ball quality far more than pitchers do.

**Rigor pass** (`scripts/retro-statcast-rigor.ts`, helpers in `retro/fitEval.ts`) — in-sample R² only ever rises when a predictor is added, so every headline is re-scored out-of-sample by 5-fold cross-validation, corrected for multiplicity (Benjamini–Hochberg over the whole test family), and reported with the power it actually had:

- **Cross-validation sharpens the batter story rather than softening it, and changes its shape.** For next-window wOBA the box-score metric alone cross-validates at **−1.1%** — no transferable signal at all — while xwOBA alone reaches 5.2%. Adding the box score on top *lowers* out-of-sample fit (2.5%). Same for AVG and contact→TB/PA. So for rate/value stats Statcast is not a supplement, it is the signal. For the **count** stats it is genuinely complementary: HR (CV 21.9% box, 23.5% Statcast, **24.5% both**) and K (55.8% / 59.1% / **61.6% both**) are both best with the pair.
- **Five of six batter tests survive FDR at 5%.** Power for those was 0.80–1.00.
- **The pitcher nulls are a power failure, not evidence of absence.** Power was 0.07–0.46; the smallest detectable increment at 80% power is ≈4.4% of variance, far larger than anything plausible. Detecting a 1% increment would need roughly 700 pitchers per window against the 166 available. Nothing about pitchers should be concluded from this season alone.
- **More metrics do not help.** A 4+4 multi-metric family fit reaches 10.6% in-sample (7.2% adjusted) but **−3.4% cross-validated** — badly overfit. A single Statcast metric matches the whole family out-of-sample. Likewise the ≥250 PA subset's 11.5% unique contribution collapses to −2.2% under CV at n=61; treat it as noise.

Read these as relative contributions, not a predictive ceiling: absolute R² is low because a half-season outcome is itself noisy, n is 120–220 players per split, and this is one season. The defensible implication for the talent layer is narrow — batter rate/value priors should anchor on the Statcast component rather than the outcome rate, batter K and HR should keep both, and **nothing about the pitcher blend is supported either way**.

Two slate traps the retro pass exposed, now guarded in `capture.ts` (`isGradableGame`) and in the retro slate query, and worth knowing because both look like ordinary games:

- **The All-Star game is `gameType` 'A'.** It has announced starters and a posted lineup, so it parses exactly like a normal slate — but its stats never appear in a regular-season game log, so every row it produces grades as a DNP. The ledger now admits only `gameType` 'R' (or absent, meaning the source didn't say).
- **A suspended game resumed later is listed under BOTH dates.** It belongs to its `officialDate`, which is where the corpus and the MLB game logs file it; captured under the other date it is a duplicate that can never be graded.

### Per-knob calibration fit (2026-09, full-season retro cohort)

With 37,167 graded retro batter-days carrying `context.knobs`, `scripts/retro-knob-fit.ts` fits `actual ~ Poisson(exp(a + b·log(neutral) + Σ c_k·log(knob_k)))`, where `neutral` is the talent-only count. Calibrated means b = 1 and every c_k = 1; c_k = 0.5 means only half the applied swing is justified. This is the fine dial the combined `mods` ratio could never give.

| | talent b | opposing pitcher | park | platoon | order |
|---|---|---|---|---|---|
| TB | 0.82 | **0.70** | 1.01 | **0.01** | — |
| H | 0.82 | **0.50** | 0.76 | **−0.42** | — |
| HR | 0.81 | 0.86 | **0.43** | **0.43** | — |
| R | **0.52** | **0.70** | 1.32 | **−0.43** | **1.57** |
| RBI | **0.52** | **0.74** | **1.36** | **−0.46** | 1.24 |
| K | 0.96 | **0.72** | **0.47** | **0.65** | — |
| BB | 0.99 | **0.70** | **0.47** | **0.58** | — |

Bold = differs from 1.00 at p < 0.05. Read together with the scorecard's over-spread slopes, which are the same story from the outcome side:

- **The platoon modifier carries no signal at game level** (≈0, negative on several stats). It is the first thing to investigate — either it is mis-keyed or the regressed vs-hand split does not survive to a single game.
- **The opposing-pitcher modifier should be scaled to roughly 70%** of its current swing, consistently across six stats.
- **Park is stat-dependent, not a single dial.** Its HR and K/BB applications are roughly half as strong as they should be applied (c ≈ 0.43–0.47 means the engine moves them ~2× too far), while its run/RBI application is if anything too weak (1.32–1.36).
- **Talent is over-spread for batted-ball stats (0.82) and badly so for R/RBI (0.52)**, while K and BB are well calibrated (0.96, 0.99) — the stats where the box score measures the skill directly.
- **Lineup-spot run context is too weak** for runs (1.57).

**The pitcher side is not identifiable yet.** Pitcher snapshots store one multiplier per knob for the whole start rather than per stat, so `platoon` and `opp` are near-collinear and return standard errors of ±10 or worse. Only the talent slope (IP 1.53, K 0.91, BB 0.79, ER 0.56, HR 0.48) and `bullpen` are usable. Per-stat pitcher attribution, mirroring the batter `knobs` shape, is the prerequisite for fitting the rest.

Honesty limits, accepted: retro cannot see scratches / late lineup changes / forecast weather (it uses actual starters, posted lineups and observed weather), so its DNP and weather findings are not comparable to live captures. Retro rows must therefore carry their own tag and never pool with live snapshots in the scorecard. The scorecard grades `retro-*` engines exactly like their live twins (kind derived from the key with the prefix stripped) but as separate sections. Still to build: bulk retro capture over the season gap (Aug 10 → 31) and the per-knob fit that reads live + retro rows together.

## Operating it

1. Browse the app normally — the streaming/lineup pages write snapshots through as a side effect. `/admin/forecast` → "Capture today's slate" covers days nobody opened the app.
2. Every few days: "Score pending actuals" (idempotent; failures stay pending).
3. Read the scorecard. Sample-size honesty: slate-wide bias is meaningful after a few weeks; per-player misses need a month-plus.

There is no scheduler yet — capture depends on traffic or the manual button. If gaps become a problem, a cron hitting `POST /api/admin/forecast/capture` + `/score` is the designed extension point.
