# Forecast Verification — the ledger and the scorecard

The operator-facing loop that grades MLBoss's prediction engines against actual MLB results. Snapshot what an engine predicted **before** the game, materialize what actually happened **after** it, and aggregate the misses into a scorecard that points at which engine (and which calibration constant) to revisit.

Module home: `src/lib/ledger/`. Admin surface: `/admin/forecast` (operator role only). Storage: the Postgres ledger (see [data-architecture.md](./data-architecture.md#the-three-storage-legs)).

This is **not an engine** — it never influences a prediction, a rating, or a recommendation. It only observes them. Nothing in `src/lib/ledger/` may be imported by L1–L7 engine code.

## Why snapshots must be stored

A forecast is computed fresh from inputs that drift daily (talent state, probables, park/weather, lineup spots). "What did the model say last Tuesday?" cannot be recomputed later — the inputs are gone. That makes snapshots observations, not cache: rows are immutable, first-write-wins per identity, and no TTL. The `retro-*` engines are the one exception — their rows are reconstructions, replaced on re-run; see [Retro rows are reconstructions](#retro-rows-are-reconstructions).

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
| `retro-pitcher-start` / `retro-batter-day` | The same two slate engines run **after the fact** on as-of inputs (see [Retro](#retro-as-of-date-forecasts-from-the-statcast-corpus)). Actual starters, posted lineups and observed weather come from hindsight, so these rows never pool with live captures; `lead_days` is a nominal 0. Re-running a date **replaces** its rows ([reconstructions](#retro-rows-are-reconstructions)) | no | `scripts/retro-capture.ts <from> [to] [pitchers\|batters]` (never write-through) |

The slate engines are the statistically dense ones (~15–30 probables, ~200–300 lineup batters per day, league-free). `batter-day` captures posted lineups only, deliberately: the engine is graded on days it knew who was playing, so a DNP is a real miss (late scratch), not sampling noise — and lineups post progressively, so the write-through re-runs as new ones land (first-write-wins dedupes). The points engines additionally verify the *advice*: board rank at capture time is in `context.rank`, so the scorecard can ask whether top-ranked picks actually beat the pool.

The categories streaming boards are ranked client-side (see [streaming-page.md](./streaming-page.md)), so there is no server-side categories board rank to capture — engine accuracy for those flows is covered by `pitcher-start` and `batter-day`, which price the same slate through the same L2 layer.

## Snapshot context

Context is the slice vocabulary: every conditional finding the scorecard can ever run is limited to what capture stamped, and new slices only work from the day their key starts being captured.

**Modifier attribution.** Both slate engines stamp the same shape: `context.knobs.<knob>.<stat>` is the multiplier one L2 knob applied to one stat's *rate*, and `context.mods.<stat>` is their product (matchup rate ÷ talent rate), so `predicted.<stat> ÷ mods.<stat>` is the talent-only forecast at the forecast exposure. Batter rows have carried it since 2026-09-01 (`BatterModifierKnobs`, knobs `pitcher` / `park` / `weather` / `order` / `platoon` / `hand` / `teamSb`). Pitcher rows have carried it since 2026-09-04 (`PitcherModifierKnobs` in [pitching/forecast.ts](../src/lib/pitching/forecast.ts), knobs `opp` / `park` / `weather` over `k` `bb` `hr` `h` `er` `ip` `pa`) — attributed **sequentially** along the chain the engine runs (talent → opp → park → weather), each knob being the stat's rate after that stage over its rate before, so cross-terms land where the engine puts them (opp K/BB move the contact rate that HR and hits ride on, so they land on `opp`). Three pitcher multipliers are deliberately *not* knobs: `platoon` scales only the L3 composite, `velocity` is a fixed 1.0, and `bullpen` prices W through `wParts`; none enters a graded stat line, and platoon is the same OPS-vs-hand scalar `opp` reads (log correlation 0.999 over the season), so a column for it could never be separated. Pitcher rows still carry `context.mults` — one breakdown-UI scalar per multiplier for the whole start — for the scorecard's knob slices and for continuity with older rows, but it is *not* what the forecast applied and the fit does not read it when `knobs` is present.

Beyond the modifier attribution, snapshots carry two kinds of fields added for the confounder screen (2026-07):

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

**Live snapshots are never deleted on a version change.** The old-version data is the control group for the before/after that proves the change helped — deleting it deletes the proof, and live snapshots can't be regenerated (they're frozen world-states). Retro rows are the opposite case — regenerated wholesale and always stamped with the build that produced them, so a retro cohort is one version by construction ([why](#retro-rows-are-reconstructions)); the `MODEL_CHANGELOG` entries that name `retro-*` engines exist so the scorecard segments correctly *between* regenerations, when old-version retro rows are still on disk. Nor are snapshots knob-separable: a single batter-day row bundles PA and every stat at once, so there's no "just the PA knob's data" to flush — that separation only exists at read time. So instead of flushing, the scorecard reads by **live cohort** (`liveCohortVersions`):

- A stat **no change since touched** pools every version into one unbroken, growing sample. A batter-PA tune never touched pitcher K, so pitcher K keeps accumulating straight across the bump.
- A stat a change **did touch** resets: the headline shows only post-change data (its `pool` count drops to `1v`), while the older versions live on in the **By model version** table as the before-data.

The single global `MODEL_VERSION` string would otherwise over-segment — bumping it for a batter tune would reset the clock on unrelated pitcher stats. The manifest is what prevents that: it tells the scorecard exactly which metrics a bump invalidated, so everything else keeps compounding. The one legitimate deletion is *buggy* data (a capture defect, garbage inputs) — a surgical integrity cleanup, never a routine version bump.

## Retro: as-of-date forecasts from the Statcast corpus

The ledger only sees days the app was open, and it lost most of Aug 2026 to two upstream outages ([history.md](./history.md)). A per-knob fit (above) needs tens of thousands of graded rows, which live traffic won't supply for a season. **Retro** rebuilds forecasts for past dates from inputs *as they stood the morning of the game* — no future leakage — so a whole season becomes fit data. Michael's constraint: no modeling without the Savant inputs, so the retro path had to recover those as-of too.

Module home: `src/lib/retro/`. Storage: `statcast_events` (Postgres; a rebuildable bulk corpus, **not** ledger data — see [data-architecture.md](./data-architecture.md#the-three-storage-legs)). Nothing in `src/lib/retro/` is imported by engine code.

### Retro rows are reconstructions

Immutability and first-write-wins exist because a live snapshot is an **observation**: "what did the model say last Tuesday" is unrecoverable once Tuesday's probables, forecast weather and talent state are gone. A retro row is a **reconstruction**: every one of its inputs — the pitch corpus, the MLB game logs, the completed schedule, the engine code — is still here, so the row can be recomputed at any time, and an older reconstruction has no evidentiary value (check out the old code if you want it back). Treating the two alike (which the ledger did until 2026-09-04) meant a re-run of an already-captured date wrote zero rows, so a change to *what capture records* could never reach the 41k-row retro cohort, and the cohort was pinned to the build that first produced it (all of it sat at `2026.07.25.2` while the shipped platoon and PA-hook fixes were three versions on).

The rule, drawn in `insertSnapshots` ([ledger/capture.ts](../src/lib/ledger/capture.ts)) by the engine-key prefix and nowhere else:

- **Live engines** (`pitcher-start`, `batter-day`, `batter-week`, `points-*`): insert, `ON CONFLICT DO NOTHING`. Forever.
- **Retro engines** (`retro-*`): insert, `ON CONFLICT DO UPDATE` — the current build's row replaces the earlier one under the same identity and is stamped with the current `MODEL_VERSION` and `captured_at`. After a date's rows are written, `retroCaptureDay` sweeps that date's rows *for that engine* that the run did not touch (identities the current build no longer produces — e.g. a starter who lost his talent stamp); the sweep only runs when the rebuild wrote at least one row, so a failed rebuild never empties a date. `player_game_actuals` is never touched — it is keyed by (date, player) independent of engine and is the expensive half of the join.

Rejected alternative: putting `model_version` into the identity for retro engines. It would keep every reconstruction, but every reader of the cohort (the fit scripts, the scorecard sections) would then have to filter to the latest version or silently double-count — and the older reconstructions are exactly what nobody needs. Regeneration does **not** bump `MODEL_VERSION`: changing what is *recorded* changes nothing about what is *predicted* (the same rule the streaming scalars follow, above), and the regenerated rows inherit whatever version the engine code is at — which is the point. The full-season pitcher regeneration was verified output-neutral before it ran: every `predicted` value on three test dates matched the pre-refactor rows to the last bit, and the 2026-08-09 golden test against the live lead-0 rows was unchanged.

**Why Savant is recoverable as-of.** The talent layer reads Savant's *season* leaderboards (`src/lib/mlb/savant.ts`), which exist only as season-to-date totals — a July forecast rebuilt from them today would include August. Savant's `statcast_search/csv` export returns every pitch for a date range with the fields those leaderboards are built from (`estimated_woba/ba/slg_using_speedangle`, `launch_speed/angle`, `launch_speed_angle` (6 = barrel), `description`, `pitch_type` + `release_speed`, `delta_run_exp`, hands). Owning the events lets us aggregate them through any date.

Pieces, in pipeline order:

| Piece | Where | What it does | Validation |
|---|---|---|---|
| Puller | `pullStatcastDay` (`statcast.ts`); `scripts/retro-pull-statcast.ts <from> [to]` | One game date of raw pitches → `statcast_events` (upsert — Savant revises estimates after the fact). Reconciles each game's PA/K/BB/HR/H against the MLB box score as it runs. Postponed entries are skipped. | Jul + Aug 2026: every game exact once `truncated_pa` (an at-bat cut off by an inning-ending baserunning out) is excluded from PA |
| Formulas | `scripts/retro-validate-aggregates.ts <batter\|pitcher> <from> <to>` | Per-player aggregates over a window vs Savant's own per-player summary for the same window | Counts exact; xwOBA \|diff\| ≈ 0.001, xBA/xSLG ≈ 0.002; K%/BB%/hard-hit%/barrel rate to displayed precision. Conventions: BB includes IBB; whiffs include foul tips; xwOBA = `est_woba` on tracked BIP else actual `woba_value`, over Savant's `woba_denom`. Hard-hit% denominators differ by surface: the summary export uses *tracked* batted balls, the skills leaderboard the engine reads uses *all* — the aggregator follows the leaderboard |
| xERA | `fetchXeraMapping` / `xeraFromXwoba` (`xera.ts`); `scripts/retro-xera-mapping.ts` | Savant's xERA formula is unpublished, but on the season pitcher leaderboard it is a smooth function of xwOBA alone. Fit a cubic per season (run-environment scale) and apply it to as-of xwOBA | 2026: rmse 0.004 ERA in-sample (PA ≥ 50), hold-out rmse 0.03; residual uncorrelated with PA, xSLG, xBA |
| As-of aggregator | `pitchersAsOf` / `battersAsOf` (`asOf.ts`); `scripts/retro-asof-check.ts <asOf>`; `scripts/retro-asof-leaderboard-check.ts [asOf]` | `StatcastPitcher` / `StatcastBatter` rows — the exact shape `savant.ts` produces — from events **strictly before** `asOf`. Returns `coverage` (window seen, `seasonComplete`) so a partial corpus is never mistaken for season-to-date. Actual wOBA uses season linear weights over AB+uBB+SF+HBP (`WOBA_WEIGHTS`, refit with `scripts/retro-woba-weights.ts` — the export's per-pitch values are rounded generic weights and run +0.007). `era` stays null (not derivable from pitches; the engine takes actual ERA from MLB stat lines) | **Definitive check** (corpus complete Mar 25 → yesterday, as of 2026-09-02) against the season leaderboards the engine reads, 478 pitchers + 432 batters ≥100 PA: PA exact for every player, xwOBA 0.001, wOBA 0.000, xwOBAcon 0.000, xERA 0.02 (max 0.13), K%/BB%/whiff/barrel to display precision, hard-hit 0.1, usage-weighted fastball velo 0.02 mph; 0 players with PA past the cutoff |

Pull cadence: month-sized runs inside the prod container (`docker exec <app> npx tsx scripts/retro-pull-statcast.ts 2026-07-01 2026-07-31`, ~3 min); dev takes a `copy … to stdout with csv` from prod rather than a second Savant pull. Corpus: the full 2026 regular season from Mar 25 (~615k pitches, 2,084 games, every game reconciled). Keep it current with a daily one-day pull. Status detail: the session memory note `project_retro_corpus`.

| Per-knob fit + knob studies | `scripts/retro-knob-fit.ts`, `scripts/retro-platoon-diagnose.ts`; Poisson IRLS in `retro/fitEval.ts` | Estimate a calibration coefficient per L2 knob per stat over the graded cohort, on the rate basis. `retro-platoon-diagnose.ts` is the per-knob deep dive: population-vs-player decomposition, interaction-only identification, usage and exposure splits, and a train/holdout time validation | See [Per-knob calibration fit](#per-knob-calibration-fit-2026-09-full-season-retro-cohort) |
| PA model re-fit | `scripts/retro-pa-model-fit.ts` | Re-fits `paBySpot.ts` from the graded ledger: the starter share per lineup spot, and the platoon hook on top of it. Runs against the live `batter-day` cohort too, as an independent sample | See [projection.md](./projection.md#pa-by-lineup-spot) |
| Corpus-only studies | `scripts/retro-statcast-value.ts`, `scripts/retro-statcast-rigor.ts`, `scripts/retro-platoon-usage-check.ts` | Questions about baseball rather than about the engine, answered from `statcast_events` with no forecast in the loop — far quieter than a residual, and available for any season the corpus covers | Permutation nulls, cross-validation and BH correction in `retro/fitEval.ts` |
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

**Exposure: read a rate dial on the rate basis.** Every batter knob multiplies a per-**PA rate**, but the row being graded is a per-game **count** — that rate times a plate-appearance forecast belonging to a different model (the lineup-spot PA model). Grading the rate dial on the count charges it for the PA model's error, and the two are not independent: platoon-advantaged bats are the ones lifted for a pinch hitter, so they collect ~4% fewer PA than the spot model says, which cancels the rate gain the knob correctly predicted (the full mechanism is under [the platoon knob](#the-platoon-knob)). So the fit carries `log(actual PA / forecast PA)` as a control wherever both sides record PA, and the table below is on that **rate basis**. `count` restores the uncontrolled view.

The gap between the two bases is itself a finding, and it splits the knobs into two kinds:

- **Batter-specific knobs (platoon, lineup spot).** The count basis is simply wrong for these — the PA distortion is a confounder, driven by the same lineup-card decision as the rate effect. Platoon reads 0.01 to −0.46 on the count basis and 0.48 to 1.03 on the rate basis. Read the rate basis.
- **Run-environment knobs (park, opposing pitcher, weather).** These genuinely *do* move team PA — a better park or a worse pitcher means the lineup bats more — and the spot model models none of it. So their count-basis coefficient is inflated by a PA-model gap, not by a well-scaled multiplier. Park reads 1.01 on the count basis and 0.58 on the rate basis for TB; the multiplier is over-applied by more than the count fit admits, and separately the PA model should respond to run environment and doesn't.

| | talent b | opposing pitcher | park | platoon | order |
|---|---|---|---|---|---|
| TB | 0.92 | **0.53** | **0.58** | **0.73** | — |
| H | 0.96 | **0.36** | **0.34** | **0.53** | — |
| HR | 0.84 | 0.76 | **0.42** | 0.81 | — |
| R | **0.67** | **0.41** | 0.77 | 1.03 | 1.35 |
| RBI | **0.65** | **0.42** | 0.75 | 0.82 | 0.95 |
| K | 1.02 | **0.77** | **0.52** | **0.48** | — |
| BB | 1.03 | **0.64** | **0.37** | 0.82 | — |

Bold = differs from 1.00 at p < 0.05. Read together with the scorecard's over-spread slopes, which are the same story from the outcome side:

- **The opposing-pitcher modifier is the worst-scaled knob on the page** — 0.36–0.77, so roughly half its swing is justified. This is a bigger correction than the count basis suggested (0.50–0.86) and it is consistent across every stat.
- **Park is over-applied on every stat** (0.34–0.77), not stat-dependent as the count basis implied. See the home/away split below for why.
- **Talent is well calibrated for the stats the box score measures directly** (K 1.02, BB 1.03, H 0.96, TB 0.92) and badly over-spread for R/RBI (0.65). Most of what looked like a talent problem on the count basis (TB 0.82, H 0.82) was PA-model error.
- **Platoon is not the dead knob it appeared to be.** [Its own section](#the-platoon-knob) is below.
- **Lineup-spot run context** is close on both stats (1.35 / 0.95) once PA is controlled; the 1.57 on the count basis was the spot model's PA error re-entering through the same column.

**The park knob is two different problems, and splitting home from away separates them** (`retro-knob-fit.ts <engine> <minRows> home|away`):

| | TB | H | HR | R | RBI | K | BB |
|---|---|---|---|---|---|---|---|
| home | 0.33 | 0.24 | 0.17 | 0.57 | 0.50 | 0.46 | 0.18 |
| away | 0.75 | 0.40 | 0.60 | 0.96 | 1.00 | 0.51 | 0.58 |

For the batted-ball and run stats the home coefficient is a fraction of the away one — away reaches 0.96 / 1.00 on R and RBI and roughly doubles the home value on TB and HR. That is the signature of **double-counting**: the talent baseline is built from season stats that already contain roughly half of the player's home park, so applying the full park factor at home charges for it twice, while on the road the baseline is near-neutral for that venue and the full factor is warranted. The engine has hit this exact class of bug before — the pitcher velocity multiplier was fixed to 1.0 in 2026-05 for the same reason, because velocity trend already fed the talent layer's regime probe. Park-neutralising the baseline is the corresponding fix here, and it is a talent-layer change, not a modifier re-scale. **K and BB are a separate problem**: low both home and away, which is straightforward over-application of a small, noisy factor that wants regressing toward 100.

**Park data itself is not the gap.** `parks.ts` already carries Savant's Statcast park factors comprehensively — overall wOBA, HR, BB and SO each with left/right handedness splits, plus 2B, 3B, BACON, xBACON and HardHit, on a 3-year rolling window (`scripts/scrape-park-factors.mjs`).

#### The pitcher side (2026-09-04, 4,192 graded starts, full-season regeneration)

Pitcher rows carry per-stat `knobs` since 2026-09-04 (see [Snapshot context](#snapshot-context)); the whole retro pitcher cohort was regenerated under [the reconstruction rule](#retro-rows-are-reconstructions), so every row below is one build. Before this the fit read the breakdown-UI `mults` and returned `opp` / `platoon` at ±10 to ±40 — unreadable by construction, not for lack of data ([history.md](./history.md#2026-09--pitcher-per-stat-knob-attribution-the-mults-fit-was-unreadable-by-construction)). Standard errors on the applied knobs are now 0.10–0.22 for K, BB, ER and H.

**Read pitchers on the count basis.** The exposure control that makes the batter table honest is *batters faced* here, and for a pitcher that is an outcome, not an exposure: every hit and walk adds a batter faced, and a blow-up ends the start early. Conditioning on it biases the H / HR / ER coefficients (opp on H swings from 0.91 on the count basis to −0.73 with the control). K and park coefficients barely move between bases (opp K 0.59 → 0.72, park K 0.64 → 0.61), which is the sanity check. The two volume stats (`pa`, `ip`) are the exposure itself and are always fitted on the count basis.

| | talent b | opp | park | weather |
|---|---|---|---|---|
| K | 0.94 | **0.59** ±0.10 | **0.64** ±0.12 | — |
| BB | 0.82 | 1.63 ±0.43 | 0.78 ±0.22 | — |
| H | 1.20 | 0.91 ±0.38 | 0.71 ±0.18 | 2.17 ±0.94 |
| HR | **0.44** | (−0.34 ±0.77) | 0.66 ±0.21 | 0.89 ±1.43 |
| ER | 0.68 | **0.36** ±0.15 | **0.34** ±0.12 | 2.08 ±0.85 |
| IP | **1.53** | **−0.24** ±0.25 | — | — |
| PA | **1.45** | **−0.33** ±0.19 | — | — |

Bold = differs from 1.00 at p < 0.05. The opp HR cell is in parentheses because `opp` reaches HR only through the contact rate (a few tenths of a percent per start) and is not identified there.

**The answer to "is the pitcher matchup layer under-applied?" is no — it is over-applied, the same way the batter layer is.** The under-application hypothesis rested on the `mults` ranges (0.950–1.044 for `opp`, 0.905–1.075 for `park`), but those were display scalars the forecast never applied. What the engine actually applies per stat swings four to five times harder — log-SD 0.075 for opp K, 0.089 for park HR, 0.088 for park ER, against 0.016 for the `mults.opp` scalar — and the cohort supports roughly half to two-thirds of it: opp K 0.59, park K 0.64, park ER 0.34, opp ER 0.36, park H 0.71, park HR 0.66. Knob by knob:

- **Opp on K (log5 against the lineup's K rate vs hand) is the best-identified pitcher knob and it is over-applied at ~0.6.** The K rate log5 pushes the forecast ~40% further than the lineups deliver.
- **The park tracks are over-applied on every stat** (0.64–0.78 on rates, 0.34 on ER) — the same picture as the batter park knob. Splitting home from away (`home|away`, count basis): **K is the same both sides** (0.66 home / 0.58 away), plain over-application of the SO track. **H / HR / ER are the mirror image of the batter finding**: home 1.11 / 0.97 / 0.72 and away 0.26 / 0.36 / 0.00. At home the batted-ball park factor is right; on the road it is close to inert. That is *not* the batter double-counting signature (which reads low at home), and the cause is open — candidates are that pitcher talent enters through Statcast expected stats (xwOBA → xERA) that are already largely park-neutral, so there is no home double-count to see, and a mild opp–park correlation on the road (0.18 on H) that the home slice lacks. Do not re-scale the park track until the road half is understood.
- **Opp on ER (0.36) is a compound**: it inherits opp K, opp BB (1.63, over-swung the other way but SE 0.43) and the OPS factor on contact value. The K over-application alone predicts part of it.
- **Weather is the one knob that points the other way** — 2.1–2.5 on H and ER — but at SE 0.85–1.3 it is 1.2σ from 1.00 and not a finding. It is also the smallest swing on the page (log-SD 0.013 on HR).
- **The workload knob is wrong-signed.** `oppWorkloadFactor` shortens the forecast start against strong lineups (and `paPerInning` lengthens PA per inning); the cohort reads −0.24 on IP and −0.33 on PA. Strong lineups do not shorten starts in this season's data, and the engine should stop pretending they do — a volume-model fix in `buildGameForecast`, not a modifier re-scale.
- **Talent: IP and PA are under-spread** (1.53 / 1.45 — `ipPerStart` is too compressed; pitchers who go deep go deeper than forecast), **HR is badly over-spread** (0.44 — the `hrPerContact` talent, the pitcher twin of the batter R/RBI finding), ER 0.68, K 0.94, BB 0.82. These are talent-layer items and belong to the prior-strength work, not to the matchup layer.

`velocity`, `platoon` and `bullpen` do not appear because they are not applied to any graded stat; the earlier "usable" `bullpen` coefficient was a team-quality proxy.

#### The platoon knob

`scripts/retro-platoon-diagnose.ts` is the worked example of how to interrogate one knob, and the reason the exposure control above exists. Decisions and rejected alternatives: [history.md](./history.md#2026-09--batter-platoon-recalibrated-the-knob-was-never-inert-and-the-per-knob-fit-was-mis-specified).

On the count basis the knob read as inert — 0.01 (TB), −0.42 (H), −0.46 (RBI) — with independent variation (log-multiplier SD 0.035–0.055) that predicted nothing, and no collinearity with the opposing-pitcher knob to blame (correlation 0.011). The mechanism turned out to be the lineup card. A batter with the platoon advantage is the one his manager lifts when the opposing bullpen brings a same-hand arm, so he banks 4–8% **fewer** PA than the spot model forecasts (LB/RHP 0.970, RB/LHP 0.958 actual÷forecast PA) while the disadvantaged batter, who is a full-time player by definition, banks slightly more (LB/LHP 1.009). Same decision on both sides of the ledger, so the PA loss cancels the rate gain and the count fit reads zero. The volume half is now modelled too — `PLATOON_HOOK` in [paBySpot.ts](../src/lib/mlb/paBySpot.ts), re-fit with `scripts/retro-pa-model-fit.ts` ([history.md](./history.md#2026-09--the-platoon-hook-batter-pa-volume-moves-with-the-matchup)); rate and volume are separate outputs, so carrying both is not double-counting.

Three things the script does that the combined fit cannot, each with a different fix attached:

1. **Grade per PA** — model-free cell tilts on a `Σactual / Σ(rate × actual PA)` basis, and the regression control above.
2. **Decompose** the applied multiplier into the population table `popTarget(bats, facingHand)` and the batter's own deviation from it. They fail independently. The deviation term fits at 0.31±0.21 (K) and 0.08±0.22 (BB) — the player's own regressed vs-hand split earns almost none of the movement it is given, which is what took the K/BB priors from 450 to 1000.
3. **Identify off the interaction only.** Park factors are split by batter hand too, so a batter-hand *main* effect is shared between the park and platoon columns. Free dummies for batter hand and pitcher hand leave platoon identified purely by the hand × hand interaction, which is the only thing it claims.

Ruled out along the way: **dilution** (the multiplier is applied to the whole game, but the corpus says a batter spends only 0.68–0.89 of his PAs facing the starter's hand — discounting the table by each row's true share pushes the coefficients past 1.0 rather than onto it, so the sourced per-PA numbers are already, coincidentally, day-level); and **survivorship** (managers benching the platoon-disadvantaged does not explain it — the table works *better*, not worse, for the bats that get sat down).

What the cohort delivers against what each row claims, as the hand × hand interaction contrast:

| | TB | H | HR | R | RBI | K | BB |
|---|---|---|---|---|---|---|---|
| table claims | 0.853 | 0.897 | 0.773 | 0.900 | 0.900 | 1.272 | 0.798 |
| cohort delivers | 0.920 | 0.971 | 0.829 | 0.951 | 0.979 | 1.107 | 0.754 |

The shipped calibration (`PLATOON_TILT_SCALE` in [platoon.ts](../src/lib/mlb/platoon.ts)) is K 0.60, BB 1.25, everything else 0.80, applied on top of a row that is first re-centred on the league PA mix so it carries no level bias — the RHB walk row averaged 0.973 over a typical schedule, under-forecasting walks for ~70% of the league. Re-grading the same cohort against the shipped table: TB 0.99, H 0.81, HR 1.06, R 1.26, RBI 0.99, K 0.88, BB 1.13 — not one differs from 1.00 at p < 0.05, and the held-out second half agrees (0.35–1.19, every SE spanning 1.00).

**Heterogeneity by manager usage is real, and it is the largest thing left in the batter model.** Split the cohort by how far a batter is shielded from his weak hand (his own share of PA against it, over the league's) and the table is delivered at ~0.2–0.4× for everyday bats and ~1.8–3.2× for shielded ones. Through engine residuals that did not survive a time split, and it was left out. Asked of the corpus directly it replicates cleanly — see [the usage check](#does-manager-usage-predict-split-size) below. The engine holds the input in spirit (`paVsL` / `paVsR`) but not cleanly enough to use yet.

Honesty limits, accepted: retro cannot see scratches / late lineup changes / forecast weather (it uses actual starters, posted lineups and observed weather), so its DNP and weather findings are not comparable to live captures. Retro rows must therefore carry their own tag and never pool with live snapshots in the scorecard. The scorecard grades `retro-*` engines exactly like their live twins (kind derived from the key with the prefix stripped) but as separate sections. Retro capture now covers the full season for both engines (the batter cohort was captured 2026-09-02, the pitcher cohort regenerated 2026-09-04). Still to build: the per-knob fit that reads live + retro rows together.

### Does manager usage predict split size?

`scripts/retro-platoon-usage-check.ts` asks the platoon-heterogeneity question of the pitch corpus instead of the engine's residuals, which is both cheaper and cleaner — no forecasts, no talent layer, no as-of machinery, so nothing but the batter is in the comparison. Window A measures **shield** (the batter's own share of PA against his weak hand over the league's share for his stance); window B, strictly later, measures his split. The estimator is conditional — same-hand count out of same-plus-opposite count with `log(PA_same / PA_opp)` as the offset — so the batter's own overall rate cancels out of the likelihood and no reference rate is needed. That is what lets the whole league contribute: a right-handed batter's opposite hand is LHP, only ~32% of his plate appearances, and any design needing a well-measured opposite-hand *rate* quietly discards him.

Restricted to plate appearances against **starting** pitchers, which is the only case the slate surfaces forecast — same-hand ÷ opposite-hand rate, shielded (shield < 0.80) against everyone else:

| split date | TB | H | HR | K | BB |
|---|---|---|---|---|---|
| 2026-05-25 | 0.903 → **0.637** | 0.942 → **0.772** | 0.827 → **0.282** | 1.130 → 1.199 | 0.771 → 0.784 |
| 2026-06-25 | 0.914 → **0.671** | 0.957 → **0.813** | 0.825 → **0.350** | 1.109 → 1.203 | 0.810 → 0.800 |
| 2026-07-20 | 0.934 → **0.687** | 0.986 → **0.850** | 0.818 → **0.268** | 1.113 → 1.264 | 0.732 → 0.720 |

Bold = permutation p ≤ 0.015 against a 200-draw null with shield reshuffled among batters of the same stance. **15 of 45 tests survive Benjamini–Hochberg at 5%.** K and BB show nothing at any split — the same division the knob fit found, and the expected one: the strikeout and walk platoon effect is mechanical and applies to everyone, while contact quality is a skill managers can see and roster around.

Three things had to be right, and each was wrong in the earlier attempt: the effect is a **tail** below shield ≈ 0.80 rather than a ramp (threshold sensitivity is monotone, TB −0.456 / −0.309 / −0.221 at cuts of 0.75 / 0.80 / 0.85, so it is a gradient in the tail and not a knife edge); the outcome has to be a within-batter comparison rather than a forecast residual; and the estimator has to condition rather than divide. The confound that would have made it unusable — a shielded batter meets his weak hand mostly through a relief specialist brought in to beat him — is ruled out by the starters-only restriction *increasing* the effect. Decisions and the conversion needed before it can be applied: [history.md](./history.md#2026-09--manager-usage-predicts-platoon-split-size-the-effect-is-a-tail-not-a-ramp).

## Operating it

1. Browse the app normally — the streaming/lineup pages write snapshots through as a side effect. `/admin/forecast` → "Capture today's slate" covers days nobody opened the app.
2. Every few days: "Score pending actuals" (idempotent; failures stay pending).
3. Read the scorecard. Sample-size honesty: slate-wide bias is meaningful after a few weeks; per-player misses need a month-plus.

There is no scheduler yet — capture depends on traffic or the manual button. If gaps become a problem, a cron hitting `POST /api/admin/forecast/capture` + `/score` is the designed extension point.
