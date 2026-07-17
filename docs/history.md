## History

Decision log. Each entry: what we used to do, why we did it, why we stopped, what replaced it. The bar for an entry is "an LLM later might propose to re-introduce this pattern, and without context for why we stopped, they'd be right to try." Minor edits don't qualify; rebuilds, deletions of canonical functions, retired patterns, and architecture shifts do.

Reverse-chronological. Add new entries at the top.

> **For LLMs:** when you delete a canonical engine/function, deprecate a calibration constant, or remove a documented pattern, add an entry here before merging. See [architecture.md](./architecture.md#rules-for-retiring-a-pattern) for the bar.

---

## 2026-07 — Roster auto-concede: per-cat reachability replaced by the chase coalition

The roster page's auto-concede used to be a per-category rule: concede iff no rank-1/2 target within `REACHABLE_GAP_MOVES` (2.0) of *that cat alone* (batters), or a z-deficit rule (pitchers). On any mid-pack competitive roster this concedes nothing — a team ranked 3rd everywhere sees nine individually-"reachable" rank-1 targets whose combined price (~8 moves on live July data) no manager can pay. Every tile said "chaseable with moves," every tile got a "→ 1st" chip, and the caption literally fell through to "chaseable with moves" even when `movesToTarget` was undefined (the SV case: 0.00 projected saves, rank 10, no target — labeled chaseable). Owner verdict that triggered the rebuild: "when I'm chasing everything, I'm chasing nothing."

**Replaced with:** the chase coalition in `computeCategoryLeverage` — one call over BOTH sides' cats: banked leads (rank ≤ 2) count free, unpriced above-middle cats ride along, and priced chases are funded cheapest-first from a single `CHASE_BUDGET_MOVES` (3.0) pool, extended past budget only while short of the winning number (`⌊N/2⌋+1` of all scored cats). Everything unfunded auto-concedes with a reason (`'unreachable'` vs `'budget'`); user contest/concede overrides participate in the budget arithmetic. Canonical write-up: [roster-strategy.md#the-chase-coalition](./roster-strategy.md#the-chase-coalition).

Don't reintroduce:

- **Per-cat-only reachability as the concede rule.** Any cat-level "is this chaseable" check must be joined to the shared budget/winning-number logic — reachable-in-isolation is the exact illusion this replaced.
- **Per-side leverage stores or hooks.** `useRosterCategoryWeights` takes both sides in one call (persist key `mlboss-roster-concede:v2:{league}`); splitting per side lets each side chase its own majority, which is not how a matchup is won. The v1 per-side keys (`:bat`/`:pit`) are orphaned on purpose — they carried stale overrides (an SV 'contest' pinned during the all-zeros-SV era that blocked auto-concede entirely).
- **"Chaseable with moves" as a fallback caption.** Captions must distinguish funded chases from unfunded ("moves better spent") and unreachable ("out of reach") states.

Known v1 approximation (accepted, documented in the doc section): chase costs sum as if independent; correlated cats make the true combined cost lower. The full concede-set optimizer (re-run projection under each punt set) remains the recorded future direction.

## 2026-07 — Categories pitcher batch: relievers un-ghosted, SV modeled, points fork folded in

`getPitcherTalentBatch` (the categories-side pitcher assembly feeding the L6 forecast and the roster pitchers tab) used to fetch only the SP-filtered season line (`sitCodes=sp`). Pure relievers have no SP line, so every RP in the league came back `role: 'inactive'`, `isGhost: true` and was silently skipped by the neutral-week projection — no K/IP/ERA/WHIP contribution from any bullpen, active closers flagged as IL-stash candidates on the roster page, and SV unmodelable. The league forecast still emitted an SV entry with every team at 0, ranked by stable-sort input order (= standings order), producing the absurdity that surfaced this whole area: the standings leader saw "SV 1st" while rostering zero relievers and sitting last in actual saves.

Two deliberate decisions from that era are hereby reversed, with reasons:

- **"The points module owns its own pitcher assembly rather than change the shared batch"** (old `pitcherInputs.ts` header). Made when the reliever gap was "fine for the categories roster page." It stopped being fine the moment categories needed SV — and the duplication was exactly the drift risk the docs discipline warns about. The shared batch now fetches the OVERALL line too (role/liveness from starts+relief, reliever workload signals, `seasonSaves`/`seasonGames` in metadata, cache key `pitcher-talent-batch:v2`), and `getPointsPitcherInputs` is a thin adapter over it.
- **"Closer SV-opportunity projection: not load-bearing for any decision"** (2026 bullpen-splits entry below). The L6 forecast now needs it. SV is modeled as `observedSavesPerAppearance(seasonSaves, seasonGames) × appearancesPerWeek`, relievers only — the save-conversion helper moved to [`pitching/talent.ts`](../src/lib/pitching/talent.ts) as the one home shared with the points rate vector. Rationale: [roster-strategy.md#saves](./roster-strategy.md#saves).

Don't reintroduce:

- **A second pitcher-input assembly.** If a consumer needs a new pitcher signal, add it to `getPitcherTalentBatch` metadata; don't fork the fetch pipeline again.
- **Role/liveness from the SP-filtered line.** `isGhost`/`role` must come from the OVERALL line or they misclassify every pure reliever.
- **An all-teams-zero forecast entry as "harmless."** `computeLeagueForecast` ranks whatever it's given; an unmodeled cat must either be modeled or produce no entry — a tied ranking renders as confident nonsense.

Still unmodeled after this change: HLD (needs a holds field on `PitcherOverallLine` plus the same appearance-rate treatment), and SV on the L4 schedule-aware path (`projectRelieverPlayer` in `pitcherTeam.ts` still leaves SV at 0, so weekly matchup surfaces — Boss Card, GamePlanPanel corrected margins — don't project saves; `CORRECTED_COUNTING_SCALE` already carries an SV weight for whenever that lands).

## 2026-07 — Points /streaming rebuilt around the unified week-moves board

The points streaming page was two separate ranked boards (FA pitcher streams, FA batter plugs) under a display-only week-plan header. Rebuilt around the owner's framing — "I have N moves left this week, what's the best way to spend them?" — as one value-sorted board of net add/drop moves (`weekMoves.ts`, client-side over new streaming facts) with a moves-budget header and a session plan. The old boards survive below as browse sections. Detail: [points-leagues.md#week-moves](./points-leagues.md#week-moves).

Decisions an LLM would otherwise re-litigate:

- **The plan is session-only, on purpose.** React state, dies on reload, nothing in localStorage/Redis. We designed a persisted plan first and killed it: a stored plan needs staleness detection, sniped-player repair, and invalidation — all of which vanish when reality (the actual roster) is the durable state and each visit re-prices from it. Don't add persistence back without solving what it re-creates.
- **The board is strictly value-sorted.** Grouping rows by go-live day was proposed and rejected (owner: the ranked list IS the product); timing lives in day chips on rows and marker dots on the week-plan strip.
- **Drops come only from the VOR churn pool** (talent-neutral, points-team facts); the week window then prices the cost. Pure week-window drop pricing alone would volunteer slumping stars.
- **Explanatory copy was removed** from the points streaming page (header subtitles, week-plan explainer text) — owner mandate: communicate structurally, don't re-add copy that explains mechanics.
- **P-slot capacity is unmodeled** for arm adds — documented simplification, not an oversight.

## 2026-07 — Points roster page rebuilt (position-aware moves; greedy batter swaps retired)

The points `/roster` page was a moves list + rostered-only value table, and its batter moves came from `recommendSwaps` — a position-naive greedy upgrade loop (batter-vs-batter by weekly points, no slot fit). The page's actual job (owner): "who out there could provide more points than who they have, but can fit within the roster position slot picture." Greedy matching can't answer the second half.

Replaced with the shared position-aware machinery: batter moves route through `generateSwapSuggestions` (roster/depth.ts) fed role-share-adjusted pts/wk — the engine is score-agnostic, so points got multi-position shuffles, gap weighting, drop resistance, and open-slot pure adds with zero new optimizer code. `recommendSwaps` survives pitchers-only until the joint categories+points pitcher effort. Three shared extractions keep the two pages from drifting: `lib/roster/openSlots.ts` (cap + placement gate), `components/shared/RosterMoveCard`, `components/shared/PositionalDepthTable` (categories page refactored onto all three, behavior-identical — smoke byte-identical).

Rate substrate riders in the same effort: per-player regressed 2B/3B/HBP rates (MLB stat lines carried doubles/triples all along — `parseSplitLine` read them just to derive TB and threw them away; HBP added to `RawStat`); `batterPointsValue` gained roleShare so points VOR/moves stopped crediting part-timers with everyday volume (the same fix the categories forecast route got in the roster-value rebuild).

Deliberately NOT added, owner decisions: no strategy/standing header on the points roster page (weekly points are streaming-dominated for good teams — that concept belongs to the /streaming overhaul; standing to /league); no leverage/concede analog (single objective, nothing to weight); pitchers stay table-only pending the joint effort.

Don't reintroduce: (a) greedy value-only BATTER swaps — slot fit is the page's job; (b) a points strategy header ranking weekly points against the league; (c) a second moves-card or depth-table implementation — extend the shared components.

## 2026-07 — Roster value rebuilt: `blendedCategoryScore` + Quality/Rising bonuses + chase-weighting retired

The roster page's player scores, upgrade targets, depth-chart starter picks, and swap optimizer all ran on `blendedCategoryScore` (`src/lib/roster/scoring.ts`, deleted): a per-cat normalized-rate sum with chase cats doubled and punted cats excluded (the user's chase/hold/punt focus map), plus two Statcast bonuses stacked on top — Quality (xwOBA blend, up to ~25% of a score) and Rising (current-vs-prior xwOBA delta).

Why we used it: it shipped the original roster page and the focus map gave the user a strategy lever. Why we stopped, in the July 2026 Albies incident (Albies scored 4.94 vs FA bats above 9 despite out-producing them):

1. **It was a parallel value engine.** The same page's focus panel and league forecast ran on the canonical L1→L4' path (`talentModel` → `getBatterRating` → `projectBatterNeutral`), while the tables ran on this separate implementation — two answers to "how good is this batter" on one page, drifting independently. `engines.md` had already flagged the bare-number return as L3 Rating-shape drift.
2. **One signal counted three times.** AVG/H rates were pure xBA (talent path), then Quality added xwOBA again, then Rising added an xwOBA delta again. An expected-stats overperformer (Albies archetype: fast, high-contact) was triple-penalized; an underperformer (Nimmo) got 39% of his score from the bonuses alone. The 2026-05 talent-baselines entry had already called the bonuses "partially redundant" and banned consumer-layer Statcast bonuses; this completed the thought by deleting them (`statcastQualityScore`/`risingBonus` gone with the module).
3. **Team-blind + a step-function lever.** A player's SB production scored identically whether the team was locked 1st or hopeless 9th in SB, and the chase ×2 / punt ×0 weights were the same arbitrary 3-state step the matchup pages retired in the pivotality migration. Stale localStorage focus overrides (persisted 3-state flips from weeks earlier) silently steered scoring — the incident's proximate cause.

**Replaced with** the leverage-weighted value engine (`src/lib/league/rosterValue.ts` + `useRosterCategoryWeights`): per-player neutral-week category lines from the canonical projection (role-share scaled, computed in the forecast route and returned as `playerValues`), valued per cat in RUPM move units, weighted by `pivotality(distance)` where distance = moves-from-a-winning-rank (batters) / z (pitchers, pending pitcher RUPM), concede/contest as the only user lever, 0-100 pool index for display. `league/forwardFocus.ts` (v2 anchors/swings/concedes, v1 z-bands, `forecastToAnalysis`), `useSuggestedFocus`, and `focusPanel.tsx` deleted with it — this was pivotality-migration Phase 6 for the roster surface. Verified live: Albies 86 vs Benge 82 vs Nimmo 70 (was 4.94 / 9.40 / 9.29).

Don't reintroduce: (a) a second batter-value implementation outside the L1→L4' path — if a surface needs a scalar, derive it from `projectBatterNeutral`/`getBatterRating` outputs; (b) Statcast bonuses at a consumer layer — predictive signal goes into the per-cat baselines where every consumer benefits; (c) fixed chase/punt multipliers as team strategy — leverage from the league forecast is the substrate, concession the only override; (d) raw move-units in the UI — the owner explicitly rejected them ("does 0.34 moves mean pull the trigger?"); tables show the 0-100 index, suggestion cards speak standings language.

Still open (the remaining pivotality-migration leftovers, now L5-side only): the `Focus` union + `focusToCategoryWeights` bridge in the rating engines, `suggestedFocus` emission in `analyzeMatchup`, streaming boards' Focus-typed props, and the bossBrief legacy reads.

## 2026-07 — Per-cat batter baselines: expected-stat blend (60/40) + TB on the talent path

The talent path for AVG/H surfaced pure regressed xBA, *replacing* actual rates entirely once `effectivePA ≥ 100`; TB stayed on the raw blend (the xSLG wiring was a documented open follow-up). A July 2026 research pass (triggered by the owner asking "are xBA/xwOBA actually that predictive?") found: xwOBA predicts next-season wOBA only modestly better than wOBA (r ≈ .57 vs .54); blends beat both (Tango's Predictive wOBA, r ≈ .59–.61); the actual-minus-expected residual is mostly noise year-to-year (r² ≈ .17) **except** for persistent archetypes — fast/contact hitters beat xwOBA by ~15–22 points of wOBA through legs and bat control, not luck.

Changed in `blendedBaselineForCategory`: AVG/H/TB now blend the expected-stat rate at `XSTAT_BLEND_WEIGHT` (0.6) with the raw actual blend (the actual side carries each player's persistent residual); TB joined the talent path via `xSLG × (1 − bbRate)`; K/BB unchanged (their talent rates are regressed actuals — nothing to hedge); HR stays raw (no Savant expected primary isolates HR). Wide-blast by design: lineup, streaming, roster, and points rates all moved ≤ 2 rating points; `test-batter-rating` stayed in range, `test-pitcher-eval` byte-identical.

Don't reintroduce: pure-expected pricing for AVG/H/TB ("xBA is the deserved AVG, trust it fully") — the replacement was exactly what made the engine systematically underrate the speed/contact archetype. If the blend weight needs tuning, move it with a citation, not a vibe — see unified-rating-model.md#calibration-anchors.

## 2026-07 — Lineup-spot store moved out of the `cache:` namespace (`getCachedLineupSpots` → `getObservedLineupSpots`)

The per-batter last-observed batting-order store ([src/lib/mlb/lineupSpots.ts](../src/lib/mlb/lineupSpots.ts)) originally wrote through `cacheResult` under `cache:static:batter-lineup-spot:{id}` with a 7-day TTL. Two problems surfaced in a cache audit: the 7-day TTL violated the static tier's 24–48h contract, and — the real bug — an `/admin/cache` Clear All destroyed a week of lineup observations that **cannot be refetched** (MLB only posts lineup cards for D+0; the history exists nowhere upstream). Future-day projections silently lost the batting-order opportunity multiplier until observations re-accumulated.

Moved to `obs:batter-lineup-spot:{id}`, written via `redisUtils` directly, functions renamed `getObservedLineupSpot(s)`. See [data-architecture.md](./data-architecture.md#observation-stores) for the observation-store rule this created.

Don't reintroduce: moving these keys back under `cache:static:` for tier-discipline tidiness — the tier rule applies to *refetchable* data only, and putting observations back in the cache keyspace re-arms the Clear All data-loss bug this entry exists to prevent.

## 2026-06 — Endgame rewrite of auto-sit: `isGamePlanSitWorthy` one-locked-cat gate replaced by `computeSitPlan`

The shipped sit-for-ratio gate armed on **one** locked counting cat + a contested-losing K/AVG — a normal mid-week state, so an endgame maneuver ran routinely. Worse, once armed the optimizer scored every bat by raw sit-net against a zero-cost empty slot, ignoring `SIT_DEADBAND` (which only gated the advisory). Real-world failure: a bat whose net hovered at ±0.005 (K harm ≈ pivotality-weighted counting value because H/TB were locked) got benched on noise with no explanation, and the decision flip-flopped with every 5-min cache refresh. Verified by replaying the optimizer's exact pipeline against live cache data — his net was +0.005 (start) hours after the optimizer computed it just below 0 (bench).

Replaced by `computeSitPlan` ([src/lib/lineup/sitValue.ts](../src/lib/lineup/sitValue.ts)) — greedy, one bat at a time, margins re-derived after each sit. It addresses all three conditions the pulled sit-to-flip PRD demanded (entry below): **(a) locked-counting fragility** → every higher-better counting cat must be conceded or locked, AND each prospective bench is pre-checked against the post-sit margins — if a lock would drop below `LOCKED_THRESHOLD`, sitting stops (no explicit weekProgress gate needed; seven simultaneous locks are unreachable early-week); **(b) stopping condition** → the chase disarms once the protected cat's margin flips past `SIT_WIN_BUFFER` (+0.1); **(c) reachability** → if the race can't flip, sitting continues only while it stays genuinely free (everything else locked and surviving), which is correct play in that state. Per-bat noise floor: a bat sits only when `shouldSit` (net < −`SIT_DEADBAND`), now enforced in the optimizer path, not just the advisory. The plan is computed once and shared by the optimizer (sat bats score −2, below idle −1 and empty 0) and the advisory panel, so action and explanation can't disagree.

Scope cuts that are deliberate, not omissions: **today-only** (Optimize Week always fills — pre-benching Sunday from Thursday margins spends information we don't have; each day re-decides), and **no sitting on incomplete data** (any scored batter cat without comparable corrected values → plan disarms).

Don't reintroduce: (a) an "any one locked counting cat" arming condition — it fires on normal weeks; (b) raw-net benching without the deadband — knife-edge nets flip-flop with cache refreshes; (c) sit logic in `optimizeWeek` — future days are re-decidable; (d) a static margin snapshot across multiple sits — margins must be re-derived per bench or locks erode silently.

## 2026-06 — Opponent-total sit-to-flip PRD pulled (problem still open)

After the chase/hold/punt retirement (see the 2026-05 entry below), we proposed `docs/sit-to-flip-prd.md` — a successor to `computeBatterSitValue` that would (a) anchor each manageable cat (AVG, batter K) to the opponent's projected weekly total instead of penalising raw K/AVG harm, (b) greedily sit only enough bats to clear the bar with a small buffer, and (c) refuse to sit at all if even maximum sitting couldn't close a target's gap (`flipReachable: false`). It captured the right *direction* — sit-just-enough beats per-bat blanket penalties — but pulled the PRD before building because the failure mode kept revealing itself: the "locked" counting cats the engine would sacrifice from aren't actually locked early in the week. Margin ≥ 0.7 assumes you keep playing; the moment you start sitting bats, the locked margin erodes (opp keeps accruing, you don't), and a feature designed to flip ratio cats can quietly cost you counting cats whose locks were fragile.

The clean-slate redesign on the table — gate sit-for-ratio on `weekProgress ≥ ~0.6` (Friday-ish) **and** require deep-lock counting (`margin ≥ ~0.85`) **and** the original PRD's stopping condition — felt like the right shape but more complex than the user wanted to commit to in this iteration. Parked indefinitely; the user is still thinking about alternative framings.

What was in the code at the time (post-pull): `isGamePlanSitWorthy` kept the **direction guard** added in [e7178ab](https://github.com/Skinnerbox916/MLBoss/commit/e7178ab) — sit-for-ratio engaged only when a manageable cat was contested *and being lost* (`margin ≤ 0`), preventing the empty-lineup regression on winning weeks. Beyond that, the per-bat sit math was conservative pivotality-weighted with no stopping condition. **Superseded** by the endgame rewrite (entry above), which finally addressed all three conditions.

Don't reintroduce a sit refinement that doesn't address all three: (a) the locked-counting fragility (gate on week confidence), (b) a per-cat opponent-total bar with a stopping condition, (c) refusal to sit when the target can't be reached. Any one of these in isolation is the failure mode that pulled this attempt. (`computeSitPlan` — entry above — is the implementation that cleared this bar.)

## 2026-06 — Deleted the generated docs index (`docs/index.json`) and `for-ai-developers.md`

Deleted in a docs-staleness sweep:

- **`docs/index.json` + `docs/index-simple.json` + `scripts/generateDocsIndex.js` + the `doc:gen-index` npm script and `mlbossDocs` package.json block.** An auto-generated machine-readable docs index. Nothing in the codebase ever consumed it, it required a manual regeneration step nobody ran (last regenerated 2026-05-01, five doc restructures stale by deletion time), and a stale index is worse than none — it presents deleted/renamed docs as authoritative. [README.md](./README.md) is the single hand-maintained index. Don't reintroduce a generated index unless something actually consumes it *and* generation is hooked into CI; a second index that can drift from README.md violates one-concept-one-home.
- **`docs/for-ai-developers.md`.** Nearly all content duplicated README.md (reading order), [architecture.md](./architecture.md) (doc principles), and CLAUDE.md (gotchas, commands) — and the duplicates had drifted (it still said "use ngrok" after the Cloudflare tunnel migration, carried PowerShell commands). The only unique content — the `position_types` parsing gotcha — moved to [data-architecture.md](./data-architecture.md) "Common gotchas"; the `flushdb` and cache-key-namespace gotchas were already documented there. Don't recreate a separate "for LLMs" doc: CLAUDE.md plus README.md *are* the LLM entry points, and a third one is a drift surface.

## 2026-05 — Chase/hold/punt retired as the weight driver (pivotality + concede-only)

The whole category-emphasis system used to be a per-cat label, `Focus = 'chase' | 'neutral' | 'punt'`, with pre-renormalisation weights `chase=2 / neutral=1 / punt=0` feeding the rating composite (`buildWeightVector` in `batterRating.ts` and `pitching/rating.ts`), and `analyzeMatchup`'s `suggestFocus` auto-assigned the label from the corrected margin (`|margin| ≥ 0.7 → punt`, `margin ≤ 0 → chase`, else `neutral`). One 3-state lever drove the weights, the panels, the sit logic (via `cat.focus`), and the bossBrief copy.

Why we used it: a clear, legible vocabulary that pulled triple duty as the user lever (chase/punt overrides), the engine signal (weight magnitude), and the display label. Worked well enough to ship the original product.

Why we stopped:

1. **The 3-tier label was a step-function over one underlying axis** — how contested a category is. The flat `2×` chase boost was arbitrary; the gap between chase and neutral was hard-coded magnitude with no calibration. Direction was redundant with `betterIs`, not encoded in the label.
2. **"Chase everything you're losing" over-commits.** A reachable deficit and a hopeless one both became `chase` and got the same `2×` boost. The user noticed this in matchups where the engine kept pushing for cats that were genuinely out of reach.
3. **Auto-punting locked wins broke the composite in extreme weeks.** `suggestFocus` marks both decided wins **and** decided losses as `punt` (weight 0). In an all-locked week (every cat a locked win), every weight zeroed → the composite preMult fell to the neutral-50 fallback → the whole streaming pitcher board flatlined to 50/FAIR with no differentiation. The same `punt`-bucket conflated "we've got this" (no need to chase further) with "concede" (give it up), which were never the same thing.
4. **The sit logic inherited the conflation.** `categoryWeight(focus, margin)` had to split `punt+margin>0` (locked win, partial value via `LOCKED_WIN_RESIDUAL=0.35`) from `punt+margin≤0` (loss, zero) — a band-aid for the conflation.

What replaced it (Phases 1-5 of [pivotality-migration.md](pivotality-migration.md)):

- **`pivotality(margin) = exp(−margin²/2w²)`** ([`src/lib/rating/pivotality.ts`](../src/lib/rating/pivotality.ts), `w=0.35`) — a smooth Gaussian on the corrected matchup margin. Peaks at coin-flip (margin 0), decays symmetrically. Same primitive on both layers; each produces its own `distance`.
- **Concession is the only user lever.** A category is either in play (weighted by pivotality) or conceded (weight 0). Auto-concede fires only on a **decided loss** (`margin ≤ −0.7`); a locked win stays in-play with its naturally-small pivotality weight. `useCategoryWeights` ([`src/lib/hooks/useCategoryWeights.ts`](../src/lib/hooks/useCategoryWeights.ts)) replaces `useSuggestedFocus` on the matchup pages, with a concede/contest override store in localStorage.
- **The Game Plan panel collapsed** from `FocusSectionTrio` (Chase/Hold/Punt + 3-state segmented control) to **In play** (ranked by pivotality) + a **Conceded** shelf with a 2-state concede/contest toggle (`GamePlanPanel.tsx`).
- **`sitValue` runs on pivotality**: every cat weights by its `categoryWeights[id]`, no focus ternary, no fixed locked-win residual (a locked win's pivotality of ~0.07-0.13 *is* the residual now, derived not asserted).
- The legacy `Focus` union, `useSuggestedFocus`, the `focusPanel.tsx` building blocks, and the `cat.focus` field still exist transitionally because the L6 roster page (`RosterFocusPanel` / `RosterManager`) hasn't been converted yet. Phase 6 deletes them.

Considered and explicitly rejected during the design:

- **A global majority optimizer.** Earliest draft was "maximise `P(win a majority)`": auto-punt long-shots with a `KEEP_THRESHOLD`/`BUFFER`/greedy-fill apparatus that selected which cats to commit to and which to concede in one global pass over batting + pitching. Killed because (a) when you're behind everywhere, every point matters and you shouldn't force-concede contestable cats just to satisfy a majority quota; (b) coupling batting and pitching through one global count cost a lot of legibility for not enough correctness gain. Batting and pitching are independent now.
- **Auto-conceding decided wins.** The first transitional `buildCategoryWeights` zeroed every `punt` cat regardless of direction — same conflation as the old system, just spelled differently. Caused the all-50 pitcher board. Fixed by keying concession to `punt && margin ≤ 0` and then properly to "decided loss only."
- **A strong blanket sit-target weight** for contested manageable cats (`SIT_TARGET_WEIGHT=2` applied uniformly to non-conceded AVG/K). It worked in the trivial sense — un-conceding K *did* bench bats — but with no stopping condition it benched the entire lineup, throwing away counting production for zero gain. Reverted before commit. See the 2026-06 entry below ("Opponent-total sit-to-flip PRD pulled") for the follow-up proposal that was also pulled.

Don't reintroduce: (a) a 3-tier `Focus` label as the weight magnitude — pivotality on margin is the substrate; (b) auto-punting locked wins — they stay in-play; (c) a fixed `LOCKED_WIN_RESIDUAL` in `sitValue` — pivotality of margin already does this; (d) a blanket sit-target weight without a per-cat stopping condition — see the 2026-06 sit-to-flip entry; (e) coupling batter and pitcher focus through any global majority count.

## 2026-05 — Per-category platoon (Bayesian; replaced the composite OPS multiplier)

After handedness display was fixed, a user noticed a lefty/switch batter's per-category **AVG** was identical facing a LHP vs a RHP, even though the composite score moved. Root cause: batter platoon was a single **OPS-derived, composite-wide multiplier** applied post-normalization to the whole score (`getPlatoonAdjustedTalent` → `buildPlatoonMultiplier`). It never touched the per-category expected rates, so every category row was platoon-blind, and the one number it did move was an OPS proxy applied uniformly.

Before rebuilding we researched the literature rather than trusting the in-code comments. Findings: (1) the thin-side regression points (LHB ~1000 PA, RHB ~2200 PA vs LHP) are genuinely from The Book; the old dominant-side priors (700/500) were unsourced extrapolation. (2) Individual platoon-skill *spread* is small (~0.015 wOBA SD; FanGraphs/The Book) — a thin observed split is mostly noise and must regress hard, but a large persistent split over a full career is real. (3) The split is **not uniform across stats**: concentrated in K (and BB) — large, sticky, fast-stabilizing — small on BABIP/AVG (~7–8 pts BABIP), ~flat on HR/FB (the HR-rate gap is contact-shape/GB%, not a HR skill).

A first cut applied **pure population** component factors (no individual term). A user then pointed out two problems that drove the final design: switch hitters were forced to neutral even though their vs-L/vs-R lines are their distinct right-/left-stance profiles and are fully predictable from the SP's hand; and ignoring a hitter's own splits entirely contradicts "use the data." Both are resolved by going Bayesian.

**Final design — [`platoonFactor`](../src/lib/mlb/platoon.ts):** per category, regress the batter's OWN observed vs-hand ratio (`his vs-hand rate / his overall rate`, plumbed through from `getBatterSplits`) toward a population target, weighted by his PA on that side: `(paVsHand·obs + prior·pop)/(paVsHand + prior)`. Per-cat `PRIOR` encodes finding (3) — K/BB ~450 PA (trust the player sooner), AVG/H/R/RBI ~1000, TB/HR 1300–1500. Applied per-cat inside `buildBatterForecast`; the composite in `getBatterRating` dropped `× platoon.multiplier` (now only `× opportunity`). **Switch hitters are not a special case** — their population target is ~1.0 (no same-hand penalty) and their observed split regresses against it, so a persistent weak side shows through with sample. Per-cat vs-hand ratios are carried on `BatterSeasonStats.ratiosVsL/ratiosVsR` (and `PlayerPlatoonSplits`). The old OPS-based `getPlatoonAdjustedTalent` + its POP_/PRIOR_ constants were removed from `analysis.ts`.

**Display:** platoon and weather are per-category, not composite multipliers, so the breakdown panel no longer shows them as standalone "multiplier" rows (only PA opportunity, which truly multiplies the score, remains). Their effect appears on each category row as `vs LHP -5%` / `wind-boost` hints. This is the convention: a value shown as a composite multiplier must actually multiply the composite; per-cat signals are shown per-cat.

**Don't reintroduce:** (a) a single composite/OPS platoon multiplier on the batter score — platoon is stat-specific and per-category; (b) using raw observed splits *without* sample-weighted regression — a 58-PA .190 is noise; (c) a uniform per-cat factor — K and AVG don't move together; (d) a special-case neutral for switch hitters — the regression handles them. If refining: the BB/TB/R/RBI population targets and the per-cat PRIOR values are conservative estimates (K/AVG targets are hard-sourced); a clean league BB%/ISO-by-matchup table and per-cat split-stabilization numbers would let them be tightened.

## 2026-05 — Handedness is honestly nullable (no more `?? 'R'`)

A user spotted every opposing SP in the lineup card labeled "RHP", including obvious lefties. Root cause: `getGameDay` dropped the MLB `probablePitcher` hydrate (ESPN owns pitcher names now), so every pitcher is built by `stubPitcher` — which hardcoded `throws: 'R'` — and `enrichPitcher` never copied the real handedness back from the identity lookup. Every pitcher read as a righty, which silently mis-platooned batters (vs-RHP split applied vs actual LHPs in `getPlatoonAdjustedTalent`), tilted the SB forecast, mis-resolved switch-hitter park factors, and picked the wrong opponent OPS-vs-hand split in the pitcher rating engine (`buildPlatoonMultiplier` / `buildGameForecast` / `buildOppMultiplier`).

The deeper issue was a repeated pattern: `resolveMLBId` and several call sites collapsed unknown handedness to `'R'` via `?? 'R'`, even though the whole downstream (platoon, park, SB, opp-multiplier) was already built to treat unknown as neutral. The confident-wrong default defeated that design.

**Replaced with:** handedness is now `'L' | 'R' | 'S' | null` end-to-end. `resolveMLBId` returns `null` when the MLB record carries no `batSide`/`pitchHand`; `stubPitcher` starts `null` and `enrichPitcher` fills it from identity; every consumer's 2-way `throws === 'L' ? L : R` became a 3-way that routes `null` to the bats-agnostic overall split (or marks the platoon read unavailable). The same fix surfaced and closed the mirror bug on the batter side (`MLBPlayerIdentity.bats` was likewise `?? 'R'`, making the `bats ?? null` and the unknown-`bats` branches in `getPlatoonAdjustedTalent` unreachable). The dead `parsePitcher` / `parsePitcherStats` chain (vestigial since the hydrate was dropped) was removed.

**Don't reintroduce:** a `?? 'R'` (or `?? 'L'`) default for `bats`/`throws` anywhere — in `identity.ts`, the schedule stub, or any projection route. Unknown handedness must stay `null` and degrade to the neutral/overall path. If a consumer needs a hand and gets `null`, that's a real "we don't know", not a cue to guess righty.

## 2026-05 — League rate calibration refresh (revealed by SP/RP blend)

After the SP/RP blend shipped, every batter rating in the lineup optimizer dropped systematically — most visibly on the AVG cat (chase-AVG panels flipped from "lead" to "narrow deficit" across the board). Root cause was not the blend itself but **stale league rate constants** that the blend exposed.

The log5 anchors (`LEAGUE_AVG`, `LEAGUE_K_PER_PA`, `LEAGUE_BB_PER_PA`, `LEAGUE_H_PER_PA`, `LEAGUE_HR_PER_PA` in batterForecast.ts) were set in 2024. Pre-blend, log5 fired once per cat against the SP rate alone — if both the anchor and the SP rate were slightly off in the same direction, log5 still landed near the batter's baseline (the anchor error mostly cancelled). With the blend, log5 fires *twice* (SP + RP) and pulls toward both pitcher rates; the anchor error compounded.

Worked example for a .275 batter facing average matchup with stale anchor (0.243) vs refreshed (0.239):

| | SP log5 | RP log5 | Blended |
|---|---|---|---|
| Stale anchor | 0.268 | 0.259 | 0.265 |
| Refreshed anchor | 0.273 | 0.263 | 0.269 |

The 0.004 gap is exactly the user-visible "post-deploy drift" — refreshing the anchor mathematically cancels it.

**HR was even worse:** stale `LEAGUE_HR_PER_PA = 0.034` vs reality 0.0275. The ratio-clamp (`pitcherRatioClamp(rate / 0.034, 0.85, 1.18)`) was below 1.0 even for an average pitcher; the floor 0.85 was biting for the RP side. Refresh moved the league multiplier from ~0.86 to ~1.0 — a real HR-projection lift that should have been there all along.

**Refreshed values** (all sourced from `/api/v1/teams/stats?stats=season&group=pitching` for the current season, mid-2026):

| Constant | Was | Now |
|---|---|---|
| `LEAGUE_AVG` (and `categoryBaselines.ts` stat 3 `leagueMean`, `talentModel.ts` `LEAGUE_XBA`) | 0.243 | 0.239 |
| `LEAGUE_H_PER_PA` (and stat 8 `leagueMean`) | 0.215 | 0.212 |
| `LEAGUE_K_PER_PA` (and stat 21 `leagueMean`, `talentModel.ts` `LEAGUE_K_RATE`) | 0.223 | 0.221 |
| `LEAGUE_BB_PER_PA` (and stat 18 `leagueMean`, `talentModel.ts` `LEAGUE_BB_RATE`) | 0.084 | 0.094 |
| `LEAGUE_HR_PER_PA` (and stat 12 `leagueMean`) | 0.034 | 0.0275 |

The zero-sum constraint (every pitcher PA equals one batter PA) means batter-side and pitcher-side anchors must agree; all three locations updated in lockstep.

**Don't reintroduce:**
- A 2024-anchored league rate constant if you're tuning for the current season. These need an annual offseason refresh (see [league-baselines.md](./league-baselines.md#updating-these)).
- A constant called "LEAGUE_X" without a comment dating its source. The fact that some of these said "2024 MLB average" in a 2026 codebase is what let the drift hide.

**Deliberately out of scope:** `LEAGUE_HR_PER_CONTACT` (HR per ball in play, used in pitcher talent regression — not the same as HR/PA), `LEAGUE_XSLG`, `LEAGUE_XWOBACON`. These need a separate Savant-side probe; not refreshing them here keeps the blast radius contained.

## 2026-05 — Batter forecast SP/RP blend (orphan `staffEra` clamp removed)

`buildBatterForecast` treated every batter PA as though it was against the opposing starter — log5 against `sp.talent.kPerPA`, `sp.baa`, etc. applied to all 9 innings. In practice an average SP pitches ~5.3 of 9 IP, so ~40% of a batter's PAs in a typical game are against the bullpen. The SP-only model systematically overweighted the SP signal and silently misforecast batters facing teams where bullpen quality diverged from rotation quality (Reds-style 2025 profile: average-ish SP, soft bullpen).

The only opposing-team-pitching signal the forecast layer used was `staffEra` (overall team ERA) as a `sqrt(staffEra / 4.2)` ratio clamp applied **only to the R cat**, not RBI. That code (a) double-counted the SP since team-total ERA includes SP innings, (b) asymmetrically excluded RBI despite RBI per-PA being similarly team-mediated, and (c) used the wrong signal (overall, not RP-only) for what it was trying to capture (bullpen contribution).

**Replaced with:** every per-PA modifier in `buildBatterForecast` now blends SP and bullpen signals weighted by `spShare`. The blend covers AVG, K, BB, H, TB, HR, R, RBI, and SB. The orphan `staffMod` clamp on R is gone — the blend captures both rotation and bullpen contributions in one pass.

Mechanics:
- `spShareBase = clamp(sp.talent.ipPerStart / 9, 0.30, 0.85)` — per-pitcher, driven by talent-layer-regressed `ipPerStart` (anchored to `LEAGUE_IP_PER_START = 5.4`)
- `rpConfidence = clamp(team.rp.ip / 100, 0, 1)` — shrinks the bullpen weight when the team RP aggregate is thin (early-season cold start, etc.)
- `spShare = spShareBase + (1 - spShareBase) × (1 - rpConfidence)` — falls back to 1.0 (SP-only) when there's no usable bullpen data; full bullpen contribution at 100+ team RP IP

Data layer: new `fetchTeamStaffSplits` in [schedule.ts](../src/lib/mlb/schedule.ts) hits MLB Stats API `statSplits` with `sitCodes=sp,rp` — one call returns all 30 teams × 2 roles with K/BB/H/HR/SB/IP/BF/BAA/ERA per role. Stamped onto `MLBGame.{home,away}Team.staffSplits` alongside the existing `staffEra` field. STATIC-tier cache.

Parallel pitcher-side win in same change: [`buildBullpenMultiplier`](../src/lib/pitching/forecast.ts) (used by W-probability) used `staffEra` as a proxy for relief-only ERA with an in-code comment acknowledging the ~0.7 correlation cost. After this change it reads `team.staffSplits.rp.era` directly, with `staffEra` as a fallback only when splits are missing.

SB cat: previously a flat `1.05` bump vs RHP and nothing else (with a `batterRating.ts` line-47 comment noting "no per-pitcher SB-allowed signal"). The hand-bump is retained as SP-specific signal; layered on top is now a team-aggregate SB-allowed-per-IP multiplier blended SP/RP and clamped to `[0.80, 1.25]`. League SB-allowed-per-IP is computed from the same `statSplits` response (sum SBs / sum IPs) and exposed via `getLeagueSbAllowedPerIp`.

**Don't reintroduce:**
- The standalone `staffMod = sqrt(staffEra / 4.2)` clamp on R only. It was double-counting + asymmetric. The blend is correct.
- Treating the SP's per-PA rates as if they covered all 9 IP. The bullpen contributes ~40% of PAs and has measurably different rates on many teams; ignoring it is a known-sized error.
- A separate "opposing bullpen pill" UI. The opposing-staff pill in [analysis.ts](../src/lib/mlb/analysis.ts) is intentionally an overall-staff-at-a-glance verdict and reads `staffEra`, not the splits — both fields are populated and serve different purposes.

**Deliberately out of scope** (with `// TODO` markers for the next pass):
- **Opposing bullpen in pitcher W probability.** A bad opposing bullpen makes late-inning run support more likely for the user's team. ~±2-3% W effect; needs co-modeling of the user's team's offense, which is broader work.
- **Closer SV-opportunity projection.** `statSplits` returns saves / save opportunities / blown saves / holds per role per team; could improve `buildReliefWeekForecast`. No reliever-streaming surface exists yet, so the data isn't load-bearing for any decision.

## 2026-05 — Boss Card pitcher block: daily start-count strip removed

The Boss Card pitcher block used to show a Mon..Sun "day strip" with one circle per day, sized larger for "spike" days where one side had 3+ probable starts. The framing was head-to-head daily ("you have 1 Sunday, opp has 3"), and a `SPIKE_THRESHOLD = 3` constant in `WeekProgress.tsx` drove an emphasized visual.

**Why it shipped:** the original Boss Brief design imagined that "Sunday spike" days were leverage moments where a manager could anticipate a swing in ratios.

**Why we stopped:**
1. **The framing didn't match the matchup.** Fantasy weeks settle on cumulative weekly totals, not daily counts. A manager doesn't win anything by having more starts on Sunday; they only win when their week-cumulative IP/K/QS lead at week's end. The daily head-to-head visual implied a competition that doesn't exist.
2. **Relievers were invisible.** Counting probable starts ignored the IP from rostered RPs entirely — a roster with four bullpen arms looked identical to one with zero. The right primary signal is **expected IP remaining (SP + RP)**, not start count.
3. **Multi-start days clustered illegibly.** A day with 4 SP probables rendered as `✓✓✓✓` jammed into a 20px column, breaking the 7-day visual rhythm and pushing day labels out of alignment with their indicators.
4. **Today's already-concluded starts double-counted.** A finished 1pm game at 6pm still showed as "remaining" and inflated the count.

**Replaced with:** a bare-IP headline (`~N IP left`) per side, sourced from L4 [`projectPitcherTeam`](../src/lib/projection/pitcherTeam.ts)'s `weeklyIp` (SP + RP). Today's already-concluded games filter out at the [`/api/projection/pitcher-team`](../src/app/api/projection/pitcher-team/route.ts) route via the shared [`isStartConcluded`](../src/lib/mlb/gameState.ts) helper. The SP/RP split lives on a hover-tooltip; per-day schedule context (when starts fall, multi-start days, etc.) moves to the streaming page's `DateStrip` / `StreamingBoard`, where it actually feeds pickup decisions.

**Engine work that landed alongside:**
- L1 `PitcherTalent` gained `role`, `appearancesPerWeek`, `ipPerAppearance`.
- L2 [`buildReliefWeekForecast`](../src/lib/pitching/forecast.ts) — per-week IP/K/BB/HR rollup for relievers.
- L4 `projectPitcherTeam` routes by `talent.role`, adds a `projectRelieverPlayer` per-reliever primitive, reports `weeklySpIp` / `weeklyRpIp` / `weeklyIp`.

**Don't reintroduce:**
- A start-count headline on the Boss Card pitcher block. Lead with projected IP — that's the cumulative-week signal that drives "can I catch up on K/W/QS".
- A "spike" emphasis on daily start counts. The matchup isn't head-to-head daily.
- A pure-SP IP projection that ignores rostered RPs. The reliever engine exists; consume it.
- A today-completed filter applied only inside `useWeekProbables` — apply it at the projection route so all downstream consumers (corrected-margin pipeline, etc.) benefit. The 2026-05 first attempt to fix this inside the hook alone was reverted for that reason.

## 2026-05 — Batter L2/L3 split (`buildBatterForecast` extracted)

The batter rating engine was one big function — `getBatterRating()` in `src/lib/mlb/batterRating.ts` inlined the entire per-PA forecast (via `applyMatchupModifier`) alongside the normalization, weighting, composite multipliers, tier mapping, and confidence aggregation. The pitcher side already had a clean two-layer split: `buildGameForecast` (L2 forecast) → `getPitcherRating` (L3 rating). The batter side documented the same architecture but didn't have it in code.

**Replaced with:** a new [`src/lib/mlb/batterForecast.ts`](../src/lib/mlb/batterForecast.ts) exporting `buildBatterForecast(stats, ctx, battingOrder, scoredCategories) → BatterForecast`. The forecast struct is keyed by stat_id and carries `{ baseline, expected, effectivePA, modifierHint }` per cat. The L2 helpers (`applyMatchupModifier`, `log5`, `pitcherRatioClamp`, `weatherCatFactor`, SP talent wrappers, league constants, `PITCHER_SWING_*` calibration anchors) all moved with it. `getBatterRating` now calls `buildBatterForecast` once at the top of the per-cat loop instead of inlining the per-cat math.

**Behavior:** identical to the bit. A 10-profile numerical equivalence harness (`/api/admin/test-batter-rating`) exercises every branch in `applyMatchupModifier` plus the degenerate paths; outputs match pre- and post-refactor JSON-stringify-exact.

**File sizes:** `batterRating.ts` shrank from 746 lines to 460. `batterForecast.ts` is 350 lines.

**Why this matters:**
- Consumers that want batter per-PA forecasts without paying for full rating composition now have a clean entry point. Currently `batterTeam.ts:261` re-extracts per-PA from `rating.categories[]`; future work could call `buildBatterForecast` directly.
- The batter and pitcher sides are now architecturally parallel, which is the precondition for an eventual Rating discriminated union (Tier 3 in the rating-cleanup plan).

**Don't reintroduce:** inlining the per-cat matchup math inside `getBatterRating`. The L2/L3 split is load-bearing and the boundary is the natural cut point (forecast is pure-function over per-PA rates; rating composes them with focus/weighting/scoring).

## 2026-05 — Rating unification: orphan canonical module removed

`src/lib/rating/types.ts` was deleted. The file documented the target unified Rating shape — `engine: 'batter' | 'pitcher'` discriminator, `composite.multipliers` map, `surface.multipliers` map, one `CategoryContribution`, one `ContextMultiplier` — but zero engine or consumer ever migrated to it. The 2026-05 "Single `MatchupContext`, single `Rating`" entry below described the intended *outcome* of that rebuild; only the `MatchupContext` half landed. The `Rating` half stayed orphan.

The engines (`getBatterRating`, `getPitcherRating`) still return engine-specific shapes with flat multiplier fields (`BatterRating` has `platoon/opportunity/weather`; `PitcherRating` has `velocity/platoon/park/weather/opp`) and no `engine` discriminator. The "shared" `ScoreBreakdownPanel` is in `src/components/shared/` but is pitcher-only; the batter equivalent is `PlayerSplitsPanel`.

**Also in this pass:**
- `type Focus = 'neutral' | 'chase' | 'punt'` moved from `src/lib/mlb/batterRating.ts` (where it was stranded in a batter-specific file but imported by 21 files including the pitcher engine) to `src/lib/rating/focus.ts`.
- `PitcherCategoryContribution` in `src/lib/pitching/scoring.ts` was renamed to `StreamingCategoryRow` to resolve the same-name-different-shape collision with the type of the same name in `pitching/rating.ts`.

**Don't reintroduce a canonical Rating type without also migrating the engines.** An empty canonical module is worse than no canonical module: the docs cite it, future LLMs trust the docs, then either half-finish the migration on top of it (adding more aspirational scaffolding) or break the working engines trying to reconcile. If you're going to add a unified Rating shape, plan the engine migration in the same PR.

## 2026-05 — Per-cat batter baselines: talent-aware, not raw-rate

The per-category Bayesian baselines that drive every batter consumer — matchup-aware `getBatterRating` (lineup, streaming, projection, lineup optimizer, Boss Brief) AND season-long `blendedCategoryScore` (roster page, league forecast, swap strategy) — pulled raw counting stats (`s.avg`, `s.hr / s.pa`, `s.strikeouts / s.pa`, etc.) and Bayesian-blended them against league mean. Statcast batter data was fetched, regressed, and stored on `BatterSeasonStats.xwoba` / `xwobaCurrent` / `xwobaTalentPrior` — but only consumed by the roster Quality / Rising / luck-arrow overlays, never by the per-cat baselines themselves.

The doc ([unified-rating-model.md](./unified-rating-model.md)) described AVG as `log5(talent.avg, SP BAA)` and K as `log5(talent.K%, SP K%)` — but `talent.avg` and `talent.K%` resolved to raw blends, not the regressed component talent. Drift between documented intent and code.

**Symptom** (the user-facing case that surfaced this): a Yelich back-from-IL hitting .297 in 18 GP graded "POOR" with all cats HOLDed because the blend pulled toward his 2025 raw .264 AVG; meanwhile a hot-stretch Marsh against an ace (Burns) graded "NEUTRAL" because raw hot-streak AVG (.327) inflated his blend with no underlying-quality check. The "we have sophisticated prediction engine" claim was only true on the pitcher side; the batter side was running 2017-era YTD-slash-line logic.

**Replaced with:** `blendedBaselineForCategory` now has a two-path structure:
- **Talent path** (preferred): when `stats.xwobaEffectivePA ≥ TALENT_GATE_EFFECTIVE_PA` (100) AND the cat is one of {AVG, H, K, BB}, surface the talent-derived rate directly. AVG ← `talent.xba`; H ← `talent.xba × (1 − talent.bbRate)`; K ← `talent.kRate`; BB ← `talent.bbRate`. These rates are already Bayesian-blended inside the talent layer — no second regression.
- **Raw path** (fallback): the legacy raw + prior + league blend. Used for cats outside the talent set (HR, TB, R, RBI, SB) and for thin-sample batters with no Statcast coverage.

**Plumbing added:** `computeBatterTalentXwoba` (in `talentModel.ts`) now exposes `xba` and `xslg` at the top level of `TalentResult`, Bayesian-regressed in the same shape as `xwoba`. `BatterSeasonStats` and `PlayerTalent` surface `kRate`, `bbRate`, `xba`, `xslg`. The two adapters (`toBatterSeasonStats`, `fromBatterSeasonStats`) plumb both directions. New calibration constants `LEAGUE_XBA` (.243), `LEAGUE_XSLG` (.404), `PRIOR_XBA_PA` (100), `PRIOR_XSLG_PA` (120) — see [unified-rating-model.md#calibration-anchors](./unified-rating-model.md#calibration-anchors).

**Don't reintroduce:**
- Reading raw per-cat rates (`s.avg`, `s.strikeouts / s.pa`) directly from `BatterSeasonStats` when talent has effective PA. Surface `talent.xba` / `talent.kRate` instead — same Bayesian discipline, but stripping BABIP/luck noise that the raw blend can't see.
- Bolting on Statcast "bonuses" at the consumer layer (the way roster Quality / Rising were added) as a workaround for missing per-cat talent. Per-cat talent goes in `categoryBaselines.ts` so every consumer benefits in one place.

**Open follow-ups** (NOT in this commit):
- **HR / TB on the talent path.** `talent.xslg` is computed and surfaced — the regression's done. Per-cat consumers in `categoryBaselines.ts` still use raw HR/PA and TB/PA. Wiring is one switch-case branch in `talentRateForCategory` once we work out the talent-to-per-PA conversion (xSLG → TB/PA needs the same AB/PA shape as H; xHR is not a Savant primary — derive from xSLG − xBA extra-base component).
- **Quality + Rising bonuses in `roster/scoring.ts` are now partially redundant.** They over-weight current-year xwOBA on top of the per-cat raw blend. With per-cat talent in place they target a narrower signal ("current contact specifically beats regressed talent") — still real, but smaller impact. Re-tune `QUALITY_WEIGHT_FACTOR` (0.4) and `RISING_WEIGHT_FACTOR` (0.15) downward in a follow-up after observing the new ratings.
- **Batter regime-shift probe.** The pitcher side has `computeRegimeShift` that collapses prior-cap weight when leading indicators move together away from prior. Batters don't — `computeBatterTalentXwoba` regresses with a fixed prior cap. For an IL-return / step-change batter, the talent path now reflects current-year Savant signals (xBA, K%, BB%, hard-hit%) directly, which is meaningfully better than the raw blend, but doesn't detect "this is a different hitter than last year." Adding a batter regime probe is the symmetric missing piece.
- **`engines.md` L3 isomorphic-Rating drift.** `engines.md` claims "both engines return an isomorphic `Rating` shape" but `getBatterRating` returns `BatterRating` (categories + multipliers + score + tier) while `blendedCategoryScore` returns a bare number. Either harmonize the shape or update the doc — pre-existing drift, surfaced during this audit.

## 2026-05 — Suggested Swaps → Suggested Moves (pure-add support)

The roster page's move-suggestion card was previously "Suggested Swaps" and the engine (`generateSwapSuggestions`) always required a drop. Open roster slots — bench slots, IL+ slots, or freshly-dropped slots — couldn't generate suggestions because the engine had no "add without drop" code path. Users with open slots had to mentally invert "what's the best swap?" to "what's the best add?" — and the best add isn't necessarily the same as the best swap.

**Replaced with:** `SwapEvaluation.drop` is now `ScoredPlayer | null`. `evaluateSwap(drop=null)` computes `netValue = computeRosterValue(roster + add) − computeRosterValue(roster)` — same machinery, no drop. `generateSwapSuggestions` accepts an `openSlotCount` option; when > 0, it generates pure-add candidates alongside swap candidates and ranks everything together by `netValue`. Pure adds dominate when slots are open (no drop cost).

**Detection:** `openSlotCount = max_team_size − current_roster_size` in `RosterManager.tsx`, computed from the league's `roster_positions` config. Counts all slot types (active, BN, IL) because Yahoo lets you place an added player in any open slot.

**UI:** card renamed to "Suggested Moves." When `move.drop === null`, the row renders "Add to open slot →  PlayerName" instead of "DropPlayer → AddPlayer." Per-cat impact strip and strategy headline render identically.

**Don't reintroduce:** the swap-only assumption. Pure adds are a first-class move type. Any future refactor of the move engine should keep the nullable drop and the dual-mode candidate generation.

## 2026-05 — L6 forecast: add manager-engagement multiplier

The talent-only model treats every team as if their manager perfectly fills all starting slots. But fantasy reality is that managers vary: some optimize lineup daily, others set-and-forget. The "lazy" manager leaves slots empty (player sitting, MLB off-day, missed waiver move), and the team accrues fewer PAs than a fully-engaged team with the same roster.

**Why we noticed:** the user's "I'm 2nd in TB YTD but the model projects me 6th" complaint was partly explained by talent regression on the YTD leaders, but Bad Hombres (YTD rank 10 in TB, projection rank 5) was the giveaway — the model thought they'd been unlucky and bumped them up, but in reality they fill only ~86% of theoretical starting slots vs the league leader's 100%. Their YTD low isn't talent regression; it's structural under-fill.

**The probe** (Yahoo `team_stats` → H/AVG → AB → PA back-calc) confirmed 14% spread between most- and least-engaged managers in a typical 10-team league. Big Bean Burritos at 91% vs Tony's Tip-Top at 100% matched the user's prediction within 1%.

**Implementation:** [engagement.ts](../src/lib/league/engagement.ts). Per team, `engagementRatio = team_YTD_PA / max_team_YTD_PA`. Applied as a multiplier on counting-cat aggregates only — ratio cats (AVG, etc.) are volume-invariant. RUPM is not scaled (it uses per-player projections, which are talent-only by design).

**Empirical effect:** the bottom-engagement team (Bad Hombres at 86%) sees their counting-cat totals scaled down 14% vs the top, dropping them back toward their YTD rank. The user's own team (96% engagement) gets a slight downscale, but less than competitors, improving their relative position in counting cats.

**Don't reintroduce:** ignoring engagement. The model leaves real variance on the table when it assumes every manager fills starting slots optimally. Some teams' YTD position is engagement-driven, not talent-driven, and the projection has to see that.

## 2026-05 — L6 forecast: include IL players in roster projections

The first cut of the forecast excluded any rostered player with `getRowStatus(p) === 'injured'` (IL/IL10/IL60/DL/NA). This asymmetrically distorted the league forecast — a team stashing a star on IL got projected as if they didn't have that player at all. Full count's SB projection dropped from "Acuña-backed dominator" to "mid-pack" because Acuña wasn't in the math, even though Acuña will rejoin the lineup.

**Why we stopped:** the matchup-vacuum frame asks "what does this roster produce in a typical week?" — assuming the roster is healthy. Teams carry IL players because they'll be back; if the player was truly out for the season the team would have dropped them. Excluding them under-projects every team that's stashing a star.

**Replaced with:** include all rostered batters (and pitchers) regardless of IL status. They get projected at the same role-typical volume as healthy players. The starting-lineup optimizer (`assignStarters`) still caps each team at the league's daily starting capacity, so low-talent stash candidates don't displace healthy starters — only IL studs with high talent scores break into the top-10.

**Don't reintroduce:** the IL filter on roster projections. It causes asymmetric distortion based on which teams happen to have stars on IL at the moment we check.

## 2026-05 — Roster focus: median-benchmark + forced-punt cap → rank-1/2 benchmark, no quota

The second cut of the L6 forecast used RUPM-based moves-from-median as the focus criterion (anchor = ≥ 1.0 RUPM above median, swing = within 2.0 below) AND retained the earlier "fill `⌈cats × 0.7⌉` swings, demote the rest to punt" arithmetic. Both were wrong.

**Median was too low a bar.** Above-median in a 10-team H2H league = rank 5 = ~50% win rate per cat = a coin flip. Anchor should mean "winning the cat in expectation," which is rank 1 (~90%) or rank 2 (~80%). Rank 3 (~67%) isn't reliable enough to count as a winning position — and was being targeted by the walk-up logic as if it were.

**The forced-punt cap was an artificial constraint.** The algorithm took `target = ⌈cats × 0.7⌉` (7 for 9 cats), picked the closest-to-anchor swings, and demoted the rest to PUNT — even when those "rest" cats had reachable rank-1/rank-2 targets. The user shouldn't be told to punt H when H is one realistic pickup from rank 2.

**Why we stopped:** the cap was a misreading of H2H math. The 70% figure came from "to reliably win the weekly matchup, you need per-cat win probability around 70%." It treated 70% as the *cap on cats you should commit to*, when it's actually the *floor on the win probability of each cat you do commit to*. The framing got inverted somewhere.

**Replaced with:**
- **Anchor = `me.rank ≤ 2`**. Direct, no median math.
- **Swing = rank > 2 AND target rank (1 or 2) reachable in ≤ `REACHABLE_GAP_MOVES` (2.0)**.
- **Concede = rank > 2 AND neither rank 1 nor 2 reachable**.
- **No quota — every reachable cat becomes a swing.** The plan only punts what's actually unreachable.
- **Strict majority floor** (`⌊cats/2⌋+1` = 5 for 9 cats) is informational only. Below it → `belowMajority = true` signals roster shape problem. The algorithm never demotes swings to satisfy a floor.

**Also fixed in this pass:** the `RATIO_STATS` lookup in `forecast.ts` and `rupm.ts` was checking against `cat.name` (verbose Yahoo label like "Batting Average") instead of `cat.display_name` ("AVG"), so AVG / ERA / WHIP were being treated as counting cats — team rankings used total hits per week instead of batting average rate. Pre-existing bug; surfaced once AVG started entering the focus plan. Fix: introduced `isRatioCat()` helper that checks both.

**Don't reintroduce:**
- Median as the anchor benchmark. Median = coin-flip in H2H weekly play. Anchor needs rank 1-2.
- A forced-punt cap (`target × WINNING_MAJORITY_FRACTION` arithmetic). Punt is decided by what's reachable, not by a quota.
- Rank-3 targets. Below 70% per-cat win probability they don't reliably win the cat.
- The `RATIO_STATS.has(cat.name)` check. Always use `isRatioCat(cat)` or check `display_name`.

## 2026-05 — Roster focus closeability: z-score → RUPM (moves-to-close)

The first cut of the talent-vacuum forecast used z-score against the competitive (non-outlier) field to decide anchor / swing / concede. Std-dev under-counts cats with naturally tight distributions: in a 10-team league, H ranges from ~50 to ~62 weekly hits — a 5% spread — so std-dev is tiny and a 2% deficit reads as −1.5σ "concede." Empirically wrong: the gap is closeable in one decent contact-bat pickup.

**Why we stopped:** std-dev normalizes to *distribution spread*, which has no relationship to *how achievable* a gap is. A wide-distribution cat (SB, ~30% CV) reads as "easy to chase" by z-score, but SB upgrades from the FA pool are tiny (~0.5 SB/week per move) — actually hard. A tight-distribution cat (H, ~5% CV) reads as "uncatchable," but H upgrades are abundant (~3-5 H/week per move) — actually easy. Z-score inverts the real difficulty.

**Replaced with:** **Replacement Upgrade Per Move (RUPM)** — see [src/lib/league/rupm.ts](../src/lib/league/rupm.ts) and [docs/roster-strategy.md](./roster-strategy.md). Per cat, `RUPM = avg(top-K FA per-week output) - avg(bottom-K rostered per-week output)`. Closeability is then expressed in RUPM units: `movesFromMedian = (my_value − competitive_median) / RUPM`. The v2 batter focus assignment switched from z-score thresholds (`±0.5σ` for anchor / swing) to RUPM thresholds (`≥1.0 move ahead` for anchor, `within 2.0 moves below` for swing).

**Inputs added:** FA pool fetched via `getAvailableBatters` (already cached on the roster page) and projected through the same `projectBatterNeutral` primitive as rostered batters. Per-player projections are now surfaced from `projectBatterTeamNeutral` and from each FA so the league-wide RUPM calc has a real pool to sample.

**Ratio cats** (AVG, OBP) get a `RATIO_VOLUME_SHARE` (~0.1) scale on top of the rate-gap — adding one high-AVG bat only shifts team AVG by their volume share of team total ABs, not by the full FA-vs-replacement gap.

**Pitcher side still uses v1 z-score bands** (no pitcher RUPM yet). Pitching is dominated by streaming on the user's workflow, lower priority. Documented as v1 limitation in roster-strategy.md.

**zCompetitive still emitted** for display / debugging but no longer drives focus logic. Removing it would break consumers; left in place as informational.

**Don't reintroduce:**
- Std-dev-based closeability thresholds. They invert real upgrade difficulty for high- and low-spread cats. RUPM correctly captures what fantasy moves can actually buy.
- A noise-floor band-aid on std-dev. The cure is to drop std-dev as the unit, not to dampen it. (We tried this briefly and reverted same session — see git log.)
- Population-level stat-correlation analysis (the earlier "stat shape" framing). The right primitive for cross-cat side effects is multi-cat impact vectors from realistic FA swaps, not population correlation. Deferred to a future Phase 2 — out of scope here.

## 2026-05 — Roster page: rest-of-week → ROS / matchup-vacuum projection

The L6 forecast that drives `/roster`'s chase/hold/punt assignments used to project each league team's **rest-of-current-matchup-week** output: `getMatchupWeekDays().filter(isRemaining)`, fanned out across `projectBatterTeam` / `projectPitcherTeam` with schedule-aware inputs (per-day games, parks, opposing SPs, posted lineups). The docs framed the page as "long-horizon roster construction" but the math wasn't long-horizon at all — the projection window shrank daily (Saturday: 1 day; Sunday EOD: empty), opp SP and park leaked into supposedly-roster-shape comparisons, and any team's rest-of-week schedule luck could reshuffle the user's anchor/swing/concede plan.

**Why we stopped:** the page promised "a single hot week shouldn't move the needle" and delivered the opposite. See [docs/roster-strategy.md](./roster-strategy.md) for the user's framing — the right comparison is roster *talent* against the league in a **matchup vacuum** (neutral context, typical-week volume), not roster × this-week's-schedule.

**Replaced with:** [`projectBatterTeamNeutral`](../src/lib/projection/neutralWeek.ts) and [`projectPitcherTeamNeutral`](../src/lib/projection/neutralWeek.ts). Each team's per-cat projection comes from running the rating engines against a synthetic neutral matchup (`buildNeutralGame()` for both sides) and scaling per-PA / per-IP rates by **role-typical volume**:

- Batters: `weeklyPA = (stats.pa / stats.gp) × TYPICAL_GAMES_PER_WEEK` (6 games/week). Per-game PA rate carries the player's intrinsic lineup-spot signal; the games/week assumption is fixed.
- Pitchers: SP gets `TYPICAL_SP_STARTS_PER_WEEK (1.2) × talent.ipPerStart`; RP gets `TYPICAL_RP_IP_PER_WEEK (3.0)`. Role is observed inside `getPitcherTalentBatch`, but workload at that role is typical.

**First-cut implementation used observed YTD pace** (`pa / weeksElapsed`). That under-counted every player who missed time (IL, call-up, demotion) and produced wildly pessimistic team projections — a roster leading the league in YTD R/HR/BB/TB was projected mid-pack on those cats because their volume divisor included missed weeks. The fix above strips the YTD-volume distortion the page exists to strip; talent rates still regress observed outcomes Bayesian-style, but volume is "going forward, healthy" not "observed pace including injuries."

**Also added in this pass:** `seasonGS` / `seasonIP` on `PitcherTalentWithMetadata.metadata` (counts were already computed inside `getPitcherTalentBatch` for role detection; surfaced for downstream pace math).

**Also added in this pass:** **starting-lineup cap**. The first cut projected every active hitter at full-time volume, so a 14-hitter roster got credit for 14 hitters' worth of weekly PA — but both teams can only start 10-ish per day. Roster depth was over-rewarded. Fixed by running [`assignStarters`](../src/lib/roster/depth.ts) (the same position-aware optimizer that drives the depth-chart card) on each team's roster before projection; only the assigned starters feed into the per-cat sums. Focus-neutral scoring (empty `focusMap`, `ptf=1`) is used for starter selection so the optimizer picks the best players regardless of strategy.

**Don't reintroduce:**
- A schedule-aware projection for the L6 forecast. `/lineup` and `/streaming` own day/week schedule awareness; the roster page is intentionally schedule-free.
- A shrinking projection window (rest-of-week, rest-of-month). Comparison stability requires a fixed-horizon assumption — typical-week pace per-roster.
- Park / opponent-SP / weather inputs into the L6 path. Those belong on L4 schedule-aware projection (the `/lineup` + `/streaming` side).
- Projecting every active hitter at full-time volume. The starting-lineup cap is load-bearing — without it, deep rosters get a structural advantage they don't actually have.

## 2026-05 — Unified chase/hold/punt panel chrome; always-jump section rule

Three pages (Lineup, Streaming, Roster) all display the same idiom — three sections of category tiles (Chase / Hold / Punt) with a per-tile segmented control and a reset button in the header — but they shipped as two parallel implementations: `GamePlanPanel` for Lineup/Streaming, `RosterFocusPanel` for Roster. Each had its own `Section`, `SectionHeader`, `FocusSegmentedControl`, `SegmentButton`, and reset button (~150 lines duplicated). Placement rules diverged too: Game Plan grouped by engine `suggestedFocus`; Roster Focus also grouped by `suggestedFocus`; neither honored a manual override visually (the tile stayed put, only the pill changed).

**Replaced with:** a shared [`focusPanel`](../src/components/shared/focusPanel.tsx) module exporting `FocusSection`, `FocusSectionTrio`, `FocusSegmentedControl`, `FocusResetButton`, `deriveFocusSection`, and `isFocusOverride`. Both panel components consume these and keep only what's genuinely page-specific (the tile body — matchup margin vs league rank — plus the header chrome and helper-text builders).

**Section placement is now always-jump.** `deriveFocusSection(focusMap, statId)` returns `focusMap[statId] ?? 'neutral'`. Manual override moves the tile to the section the user selected, in any panel. The override dot still surfaces "you disagree with the engine," but layout reflects the user's call. `useSuggestedFocus` composes `focusMap` as `{...suggested, ...overrides}` so untouched cats default to the engine's suggested section — only deliberate clicks cause a jump.

**Also deleted in this pass:** `CategoryFocusBar.tsx` (vestigial — no rendering callers, only `nextFocus` was imported by `useSuggestedFocus`'s `toggle`; inlined). Unused `toggle: togglePitcherFocus` / `toggleBatterFocus` destructures in `StreamingManager` that left lint warnings.

**Don't reintroduce:**
- A parallel focus-panel component family for a new page. Extend `focusPanel` or layer a thin wrapper around `FocusSectionTrio`.
- A "hybrid" placement rule (signal-bearing stays put, no-signal jumps). The user-clicks-a-button-the-row-moves direct UX won out over the "stable engine reading" anchor. The override dot is enough engine-context signal.

## 2026-05 — Streaming page Sunday pivot (replaced apologetic banner)

On Sunday the streaming-page DateStrip and per-FA week scores already aimed at next Mon–Sun (via `getStreamingGridDays`), but the upper UI — Game Plan chase/hold/punt, Volume Gap, "vs Opponent" label, W/L projection — still described the current matchup, which had at most one day left to accrue. We papered over the mismatch with a banner in the Game Plan helper text: *"Current matchup is closing out. A pickup right now will land on next week's matchup, so treat the chase/hold split as a rough heading."*

**Why we stopped:** the banner explained the bug instead of fixing it. The user still saw stale chase/punt suggestions, a stale opponent, and a stale projected W/L badge — they just had a footnote.

**Replaced with:** an explicit `WeekTarget = 'current' | 'next'` vocabulary that flows through every consumer:

- `useCorrectedMatchupAnalysis` accepts `opts.targetWeek`. On `'next'` it fetches next-week scoreboard for opponent identity and runs `composeCorrectedRows` in a new **`mode: 'projection-only'`** code path — pure-projection values for every projectable cat, em-dash pass-through for un-projectable rows (K/9, BB/9, H/9). No MTD blending math is invoked. `withSwing` is skipped (no MTD baseline to swing from); rows render the projected value with no "before → after" arrow.
- Projection routes accept `?targetWeek=next` and call `getWeekDays(now, 'next')` to project next Mon–Sun.
- The Sunday rule itself moved to one home: `isSundayPivot(now)` in `weekRange.ts`. Both the streaming-grid helpers and `StreamingManager` consult it.
- Panels (`GamePlanPanel`, `VolumeGap`) accept `targetWeek` and own their own pivot-aware copy (chip, title, helper text) — no string literals threaded from the page.

The lineup/Today callsites (which never needed the banner — those pages don't take pickups) dropped the prop entirely.

**Also renamed in this pass:** `ytd` → `mtd` for everywhere we were reading Yahoo's per-matchup scoreboard totals. Those numbers reset every Monday; "YTD" was confusing them with season-level YTD (which still exists in `mlb/analysis.ts` for the batter-form analysis fallback window — those references stay).

**Don't reintroduce:** (1) a banner that says "the data below is wrong, sorry" — if a page's upper UI doesn't match the time horizon of its lower UI, parameterize the analysis engine to align them. (2) The "synthesize 0/0 MTD maps and let `blendAvg` reduce to pure projection" trick — an earlier iteration tried this and it worked by happy accident: the blender formulas happen to collapse cleanly when the MTD denominator is zero. That's an emergent property, not a contract, and any future tuning of `blendAvg` / `blendPitcherRatio` would have silently corrupted pivot output. The explicit `mode: 'projection-only'` path is the right shape; keep it.

## 2026-05 — Always-fetch-roster-by-date for forward projections

All four forward-projection paths used to call `getTeamRoster(userId, teamKey)` — the **today**-roster Yahoo call. When a user added a streamer (e.g., picked up an SP scheduled to start Wednesday), the new player wasn't on today's roster snapshot, so the projection iterated the remaining matchup days looking for probable starts from a roster that didn't include the streamer. Pickups silently failed to appear in the volume gap, the corrected matchup margin, the Game Plan, the dashboard remaining-starts count, and the league-wide forecast.

**Replaced with:** `getTeamRosterByDate(userId, teamKey, lastRemainingDate)` everywhere a forward projection consumes the roster. The "last remaining day of the matchup week" captures pickups effective for any upcoming day in the window. Fixed in four places:

- [`/api/projection/pitcher-team/route.ts`](../src/app/api/projection/pitcher-team/route.ts)
- [`/api/projection/batter-team/route.ts`](../src/app/api/projection/batter-team/route.ts)
- [`/api/league/[leagueKey]/forecast/route.ts`](../src/app/api/league/[leagueKey]/forecast/route.ts)
- [`useWeekProbables`](../src/lib/hooks/useWeekProbables.ts) (BossCard's remaining-starts runway and day strip)

**Rule:** any code path that iterates **future** matchup days and reads from the roster must pass a date to Yahoo. `getTeamRoster` (no date) is appropriate only for **today**-only surfaces — current lineup decisions, live scoreboard reads. If you find yourself fetching roster + iterating remaining days, you need the dated call.

**Tradeoff:** the last-day-of-week snapshot misses single-day adds dropped before week's end (rare). The alternative — fetch the roster per day — costs 7× the Yahoo calls for marginal coverage of an unusual pattern. If a future use case needs strict per-day fidelity, swap in per-day fetches at that surface only.

## 2026-05 — VolumeGap panel + shared CapPill

Streaming-page pitcher tab gained a "Stream this week?" panel above the Game Plan that answers the volume question (am I projected to fall behind on IP/K/W/QS?). Reads off the existing `useCorrectedMatchupAnalysis` projections + `useLeagueLimits` — no new engine, no new fetch path. See [`streaming-page.md`](./streaming-page.md).

The cap pressure pill (`CapPill`) was extracted from BossCard's `WeekProgress` into [`src/components/shared/CapPill.tsx`](../src/components/shared/CapPill.tsx) — same visual grammar in both places, one home.

## 2026-05 — Documentation restructure

Consolidated the documentation into a layered structure: top-level index ([engines.md](./engines.md)), strategy doc ([architecture.md](./architecture.md)), per-layer reference docs, cross-cutting concept docs, and this history file.

**What was deleted:**

- `pitcher-evaluation.md` — folded into [unified-rating-model.md](./unified-rating-model.md) (regime probe, BB compounding, debugging guide, four canonical shapes). The doc existed as a "companion" to unified-rating-model but redescribed the architecture, multipliers categorization, and confidence model that lived there too. Unifying killed the redundancy.
- `scoring-conventions.md` — split. Stat-level vocabulary moved to [stat-levels.md](./stat-levels.md); "one source of truth" rule moved to [architecture.md](./architecture.md); calibration-knob tables distributed to per-engine docs.

**Why we did it:** four docs (`scoring-conventions.md`, `data-architecture.md`, `unified-rating-model.md`, `pitcher-evaluation.md`) each maintained their own "canonical implementations" table with slight differences. Three docs each had their own calibration anchors. Five docs had architecture diagrams. The drift hazard was real — LLMs treating two slightly-different claims as both authoritative.

**Why we stopped the old shape:** every concept now has exactly one home. The doc tables also lost their "Value" column for calibration constants — values live only in source code now (the doc owns rationale, source owns the number, the inline code comment is a one-line pointer to the doc section). This eliminates the most common drift mode.

## 2026-05 — Velocity multiplier moved to talent-layer regime probe

The `Rating.velocity` composite multiplier (asymmetric ±6%: -4%/mph for declining velo, +3%/mph for rising) was retired from the score formula. The signal moved into `computeRegimeShift` in [pitching/talent.ts](../src/lib/pitching/talent.ts), where YoY fastball-velo delta is one of five leading indicators (K%, BB%, whiff%, barrel%, velo) that together drive prior-cap shrinkage.

**Why:** keeping velocity at both the talent layer (via regime probe) and the composite layer (via multiplier) double-counted the same signal. The regime probe handles velocity more correctly anyway — a -1 mph velo drop *plus* K% decline *plus* barrel% spike together collapse the prior cap, whereas the composite multiplier applied a flat ±6% regardless of whether other indicators corroborated.

**Aftermath:** `Rating.velocity` survives as a display-only field with `multiplier: 1.0` so the breakdown UI can still show the velo trend. Don't fold it back into the composite formula.

## 2026-05 — Unified rating model: per-PA before composite

Pre-2026-05 the pitcher rating multiplied the composite by `× park × weather × opp` AND the per-cat layer applied `parkSO` / `parkBB`. K and BB sub-scores took a park hit twice; ERA and WHIP only got the composite hit. Worse: `xwobaAllowed` did not carry HR explicitly (`= bb·0.69 + contact·contactXwoba`), so HR-park scaling in `expectedHR` never propagated to `expectedERA`. Coors flyball pitchers had inflated HR projections with talent-only ERA.

**Replaced with:** per-category adjustments live at the per-PA layer in [pitching/forecast.ts](../src/lib/pitching/forecast.ts); composite only multiplies matchup-wide signals (platoon, opportunity). `composeXwobaAllowed` carries HR explicitly via FanGraphs linear weights (`BB·0.69 + nonHrContact·nonHrXwoba + HR·1.97`), so HR-park / `gbRate` / weather all flow into ERA via the chain. See [unified-rating-model.md](./unified-rating-model.md).

**Why we stopped:** the old shape was the source of two bugs we kept hitting. (1) Composite double-counted park for K and BB while ERA got it only once, producing pitchers whose category sub-scores disagreed with their composite. (2) HR was implicit inside `contactXwoba`, so HR-park scaling was visible in the HR sub-score but invisible in ERA — Coors fly-ballers projected for a lot of homers but a normal ERA, which can't both be right.

## 2026-05 — Single `MatchupContext`, single `Rating`

Pre-2026-05 the batter and pitcher rating engines had disjoint context shapes (`MatchupContext` on batter side, `BuildForecastArgs` on pitcher side) and disjoint rating shapes (`BatterRating` vs `PitcherRating` with different field structures). The breakdown UI had two components, the compare tray had two components, and adding a new field required touching both sides.

**Partial replacement.** The `MatchupContext` half landed: both engines consume `MatchupContext` from [src/lib/mlb/matchupContext.ts](../src/lib/mlb/matchupContext.ts), re-exported by `analysis.ts` for back-compat. The `Rating` half did *not* land — a unified discriminated union was specified in `src/lib/rating/types.ts` but no engine ever adopted it; that file was later deleted as orphan code (see the entry at the top of this file). `BatterRating` and `PitcherRating` remain engine-specific shapes. The `CompareTray` component created in this pass was never wired into a live UI surface and the file was later deleted. The `ScoreBreakdownPanel` in `components/shared/` is pitcher-only despite the folder name; the batter breakdown lives in `PlayerSplitsPanel`. See [unified-rating-model.md](./unified-rating-model.md).

## 2026-05 — `xwobaToXera` consolidation

Three inlined copies of `xwobaToXera` existed in `forecast.ts`, `batterRating.ts`, and `display.tsx`, with two different slopes (5.0 vs canonical 25). The display.tsx copy used the wrong slope, producing the "Max Meyer Bad in his own card / ace in Painter's risk summary" inversion — the same pitcher rated as a tough start in one view and as a low-tier streamer in another.

**Replaced with:** one canonical `xwobaToXera` in [pitching/talent.ts](../src/lib/pitching/talent.ts). All consumers import and re-derive.

## 2026-05 — `isLikelySamePlayer` consolidation

Three name matchers (free-agent matcher, roster matcher, today-page matcher) used last-name-only comparison. Caused two same-surname players on the same team (Lopez × 2, Ureña × 2) to both attach to the probable starter, surfacing two streamers for one game.

**Replaced with:** one `isLikelySamePlayer(a, b)` in [pitching/display.tsx](../src/lib/pitching/display.tsx) requiring full normalized name match OR last-name + first-initial agreement.

## 2026-05 — Streaming page: MatchupPulse and CategoryFocusBar retired

The streaming page previously mounted three panels above the board: standalone `CategoryFocusBar`, `MatchupPulse` tile strip, and the pitcher pipeline. The Game Plan card subsumed both — chase/hold/punt grouping with inline focus pills per row, all in one panel.

**Replaced with:** `GamePlanPanel` (`side: 'batting' | 'pitching'`). At the time of this change, `MatchupPulse` survived on the dashboard alongside the leverage bar and `CategoryFocusBar` survived on Today/Roster/Lineup. Both were subsequently removed from every surface; neither component exists in `src/` anymore (`CategoryFocusBar` deletion noted in the unified-panel-chrome entry above; `MatchupPulse` was retired from the dashboard once the leverage bar and Boss Brief covered its question).

**Why we stopped:** three panels showed the same scoreboard state three different ways, and the focus pills on the bar didn't visually connect to the rows they affected. Putting the pill on the row is the more direct UI.

## Pre-2026-05 — Pitcher evaluation rebuild (Montero / Houser)

There used to be **three independent pitcher evaluators**:

1. A rule-based tier classifier (`classifyPitcherTier`) mapping ERA + WHIP + K/9 + xERA onto `ace | tough | average | weak | bad | unknown`.
2. A continuous talent score (`pitcherTalentScore`) that hierarchically resolved `RV/100 → component xwOBA-allowed → tier-fallback → 0.5`.
3. A raw-fields path inside `getBatterRating` that read `pp.era`, `pp.hr9`, `pp.battingAvgAgainst`, `pp.strikeoutsPer9` directly and synthesized K/PA from K/9 with a magic 4.2 PA/inning constant.

**The bug that motivated the rebuild — Keider Montero, early 2026:** 27 IP, ERA 4.00, 8% rostered. Path 1 saw his Savant xERA at 2.36 plus WHIP 1.00, classified him `ace`, and the row sprouted a green ACE badge. Path 2 ran his thin sample through component xwOBA, regressed hard against the prior, and landed on talent score 0.55 — score 62 "FAIR". Both badges shipped, side by side, on the same row.

**The inverse bug — Adrian Houser:** 7.12 ERA / 5.95 xERA collapse with corroborating barrel% spike, but the talent layer's `computeSosMultiplier` (which downweighted samples against weak lineups) pulled him *toward* his better prior, projecting him as a fair 4.20-ERA streamer. The SoS shrinkage had the right intent — discount Montero-style hot starts — but the wrong shape: it ran the wrong direction for declining pitchers.

**Replaced with (Phase 4d):** a single three-layer pipeline rooted in **per-PA outcomes**.

- Layer 1: `PitcherTalent` in [pitching/talent.ts](../src/lib/pitching/talent.ts) — Bayesian-blended per-PA outcome rates.
- Layer 2: `GameForecast` in [pitching/forecast.ts](../src/lib/pitching/forecast.ts) — talent × game context.
- Layer 3: `PitcherRating` in [pitching/rating.ts](../src/lib/pitching/rating.ts) — forecast → 0-100 score.

Tier derives from score via `tierFromScore` — no separate classifier. The "Montero is ACE by one rule, FAIR by another" inconsistency is structurally impossible now.

**Replaced `computeSosMultiplier` with `computeRegimeShift`** — a holistic prior-cap shrinkage that detects when current-season leading indicators (K%, BB%, whiff%, barrel%, velo) move *together* vs prior. The score is signed and symmetric: confirmed decline collapses the prior just as confirmed breakout does. Both Montero (skills flat → prior preserved → contact-quality outliers regressed) and Houser (K% + barrel% co-decline → prior collapses → estimate moves toward current) get the right answer.

**Deleted in this rebuild:**
- `src/lib/mlb/model/quality.ts` (`classifyPitcherTier`, `MIN_IP_*`)
- `src/lib/pitching/quality.ts` (`pitcherTalentScore`, `pitcherTalentFromBatterPerspective`, `tierToPitcherScore` fallback)
- `getPitcherQuality` orchestrator in `players.ts`
- `pp.quality.tier` field on ProbablePitcher and its enrichment
- `tierToEra` synthesis (forecast layer derives ERA from xwOBA directly)
- `MIN_SP_IP` gate in `getBatterRating` (talent's Bayesian regression handles thin samples)
- `dataCredibility` multiplier in scoring.ts (replaced by confidence annotation; no double-shrink)

**Don't reintroduce:** any function that maps `(era, whip, k9, ...)` to a categorical tier. Don't add a parallel "tier classifier" or "talent score" helper. Extend the canonical pipeline instead.

## Phase 4b — `blendSavant` → `blendRateOrNull`

`blendSavant` in `src/lib/mlb/savant.ts` duplicated the Bayesian rate blender (`blendRate` in `talentModel.ts`) with subtly different semantics — specifically, the "all empty → null" behavior that Savant secondaries (xERA, RV/100, wOBA-on-contact) needed.

**Replaced with:** `blendRateOrNull` in [talentModel.ts](../src/lib/mlb/talentModel.ts), a wrapper around `blendRate` that handles the null-out case. Pass `leagueMean: 0, leaguePriorN: 0` when no league anchor exists, or a real league mean + a positive `leaguePriorN` when the consumer wants regression toward the population.

## Phase 4 — `PlayerStatLine` page-facing shape

The data layer was migrated to `PlayerStatLine` (stratified `current` / `prior` / `talent` / `statcast` / `splits` blocks; see [stat-levels.md](./stat-levels.md)), but the internal scoring engines (`getBatterRating`, `roster/scoring.ts`'s blended scorers, `categoryBaselines.ts`) still operate on the legacy flat `BatterSeasonStats`.

**Compromise:** a polymorphic `asBatterStats` shim inside each scoring engine adapts either input via `toBatterSeasonStats(line)`. The shim is invisible at the call site. New consumer code passes `PlayerStatLine`; the engines see whichever shape they prefer internally.

**Why we kept the legacy shape internally:** rewriting the per-category baseline pipeline and the analysis-layer `getPlatoonAdjustedTalent` helper to read `PlayerStatLine` directly would have churned hundreds of lines without changing behavior. We treat "no consumer code references the legacy shape" as the practical exit criterion. `toBatterSeasonStats` is internal-only — don't call it from app code.

**Don't reintroduce:** a third shape. Extend `PlayerStatLine` or accept the shim.

## Pre-Phase 4 — Source / model separation

Earlier versions of `src/lib/mlb/` mixed fetching with modeling — `getRosterSeasonStats` did I/O AND parsed AND regressed all in one function. A rewrite shipped a partial cache that hid IL'd players for 10 minutes at a time.

**Replaced with:** the source / model / compose three-layer separation in [data-architecture.md](./data-architecture.md). `model/` files cannot import from `source/`; `source/` cannot import from `model/`; anything that needs both lives in a `compose/`-style orchestrator. Enforced by code review, not lint.

**Don't reintroduce:** model functions that fetch; source functions that regress; orchestrators that bypass the seam.
