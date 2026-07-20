## Roster Strategy (L6)

**ROS (rest-of-season) roster construction.** Answers "how should I shape my roster for the rest of the season — which cats to dominate, which to concede, where to direct add/drop moves — based on the overall talent of my roster relative to the other teams in the league, in a matchup vacuum."

> See [recommendation-system.md](./recommendation-system.md) for `/lineup` (today) and `/streaming` (this week). The three pages cover three time horizons: **day / week / rest-of-season.** See [architecture.md](./architecture.md#1-two-layers-one-bridge) for why they're deliberately separate.

> **Verified (facts, not strategy).** The value substrate behind "Your Batters" / "Upgrade Targets" — talent × playing time — is graded by the `batter-week` engine, including an ownership slice that checks rostered-vs-FA symmetry (an asymmetry there mis-prices every suggested swap). The *strategy* layer on top (leverage, RUPM, concede coalition) is a weighting choice, not a forecast, so it's graded only by proxy through the facts beneath it. See [forecast-verification.md](./forecast-verification.md).

## Why this page exists

The natural reflex is to look at YTD stat ranks (on `/league`). Those get distorted by:

- **Roster moves** — a category producer's output may have been on someone else's roster for half the season.
- **IL stints** — a player's absence depresses your YTD count even though he's back and healthy now.
- **Trades, drops, picks** — cumulative stats reflect history, not your current roster.

The roster page strips that out: take the **current** roster, project its talent forward at neutral context, compare to every other team's current roster doing the same, identify where you're a real category winner and where you're not. Then use that to direct add/drop attention.

## Matchup vacuum

"Matchup vacuum" means each team's projection is computed against league-average opposition at neutral park, with each player getting their typical full-week PA / IP volume. **No this-week's schedule. No this-week's opponent SP. No this-week's lineup spot.**

The output is a single per-cat scalar per team representing "in a typical neutral week, this roster produces X." Stable until the roster changes — rankings don't drift just because Wednesday becomes Thursday.

This is the right input for a question about **roster shape**. Schedule-aware projection is `/lineup` and `/streaming`'s job.

## The engines

| Engine | File | What it produces |
|---|---|---|
| `computeLeagueForecast` | [league/forecast.ts](../src/lib/league/forecast.ts) | Per-cat per-team neutral-week projected output across the league, outlier detection, RUPM-based moves-to-target, reachable-target rank |
| `computeCategoryLeverage` | [league/rosterValue.ts](../src/lib/league/rosterValue.ts) | Per-cat leverage weight: `conceded ? 0 : pivotality(distance)`, distance side-aware (RUPM moves where priced / z otherwise); auto-concede via the chase coalition (winning number + one shared move budget) |
| `playerContributions` / `playerRosterValue` | [league/rosterValue.ts](../src/lib/league/rosterValue.ts) | Per-player per-cat contributions in RUPM move units → leverage-weighted value to this team |
| `useRosterCategoryWeights` | [hooks/useRosterCategoryWeights.ts](../src/lib/hooks/useRosterCategoryWeights.ts) | Client hook: leverage + concede/contest override store (localStorage), the L6 mirror of `useCategoryWeights` |
| `playingTimeFactor` | [roster/playingTime.ts](../src/lib/roster/playingTime.ts) | Role share (0–1) scaling per-player weekly volume; applied server-side to value lines and RUPM inputs |
| `analyzeSwapStrategy` | [league/swapStrategy.ts](../src/lib/league/swapStrategy.ts) | Decorates a `RankedSwap` with per-cat move-unit deltas + leverage role + headline (pushes contested / erodes cushion / reinforces) |

The underlying swap optimizer (`generateSwapSuggestions` returning `RankedSwap[]`) lives in [roster/depth.ts](../src/lib/roster/depth.ts). It is roster-construction infrastructure (multi-position eligibility, replacement value, gap weighting) and isn't covered here; `analyzeSwapStrategy` is the layer that puts a strategic interpretation on top.

## Starting-lineup cap

A 14-hitter roster doesn't produce 14 hitters' worth of stats per week — only the 10-ish that fit the league's daily starting lineup do. Bench players give optionality (matchup gains, off-day coverage), not extra volume.

Each team's projection is therefore capped by **optimal starting-lineup selection**: before aggregating, run [`assignStarters`](../src/lib/roster/depth.ts) (the same position-aware optimizer that powers the depth chart) on the team's full active roster. The optimizer values players by the neutral-context rating score their own projection already computed (`PlayerProjection.weeklyScore` from [`projectBatterNeutral`](../src/lib/projection/neutralWeek.ts) — focus-neutral, canonical L3 math, no separate scoring engine), then fills C / 1B / 2B / 3B / SS / OF×N / UTIL×M slots with the best position-eligible players via backtracking + alpha-beta pruning. Only the assigned starters feed into the projection.

This means:
- A deep roster with 14 hitters projects 10 — its 4 bench players don't accumulate stats.
- A thin roster with 11 hitters projects all 11 (or fewer, if some don't fit any open slot) — depth doesn't matter once you're under the cap.
- Player quality matters more than quantity: 14 average hitters get the same volume credit as 14 great hitters, but the great ones produce more at that volume.

This corrects the obvious counterexample raised against the first cut of the engine: "we both can only start 10, why does the model think your 14-hitter roster outproduces my 11?"

**Pitcher side does not yet apply this constraint.** Most leagues stream pitchers heavily enough that the active-roster ≈ starting-lineup distinction is less acute. Documented as v1 limitation; revisit if pitcher rankings look off.

## Engagement multiplier

Talent-only projections miss a real source of variance: **manager engagement**. A "set and forget" manager leaves starting slots empty when a player is sitting, when their MLB team has an off-day, or when a roster move was available. Those missed PAs are real lost counting-cat output that no talent model can recover.

**Signal:** each team's YTD plate appearances accrued through their starting slots, normalized against the league-top engagement team. Top team = 1.0; others proportionally less. Computed in [engagement.ts](../src/lib/league/engagement.ts).

**PA back-calc:** Yahoo's standard team-stats endpoint surfaces H and AVG but not PA. Back into PA via `AB = H / AVG`, then `PA ≈ AB / 0.91` (walks + HBP + SF are ~9% of PA league-wide).

**Applied to:** counting cats only (HR, R, RBI, SB, BB, K, TB, H). Rate cats (AVG, OBP, ERA, WHIP) are volume-invariant — a low-engagement team accrues fewer ABs but the AVG on those ABs is unchanged.

**Empirical spread:** typical 10-team leagues show 10-15% spread between the most and least engaged manager. Meaningful enough that ignoring it materially mis-ranks teams whose manager habits differ.

**Why we don't apply this to RUPM:** RUPM uses per-player projections (top-K FA, bottom-K rostered). Those are talent-only — engagement is a team-level signal, not a player-level one. Engagement scales the team aggregate; RUPM-based closeability uses the un-engagement-scaled player distribution. Clean separation.

## Inputs: talent only

Each team's neutral-week projection is built from:

- **Batter talent rates** — per-PA rates from [`talentModel.ts`](../src/lib/mlb/talentModel.ts) (Bayesian-shrunk K%, BB%, xwOBACON-based estimators). Stabilizes faster than raw outcome xwOBA; appropriate for season decisions.
- **Pitcher talent rates** — per-IP rates from [`pitching/talent.ts`](../src/lib/pitching/talent.ts) for K9, BB9, WHIP, ERA components.
- **Typical-week volume** — a stable per-player assumption, **not** observed YTD pace:
  - Batter: `paPerGame × TYPICAL_GAMES_PER_WEEK` (6 games/week). `paPerGame` is the player's intrinsic per-game PA rate (`stats.pa / stats.gp`); games/week is a role-typical constant. This is deliberate — using observed YTD pace would punish IL-returned hitters and call-ups for missed time, which is precisely the YTD distortion the page exists to strip.
  - Pitcher: role-typical workload. SP: `TYPICAL_SP_STARTS_PER_WEEK (1.2) × talent.ipPerStart`. RP: blended per-player `ipPerAppearance × appearancesPerWeek` from the talent vector (a closer's usage differs from a mop-up arm's — that's role signal, not schedule noise), falling back to `TYPICAL_RP_IP_PER_WEEK (3.0)`. Role itself is observed (set inside `getPitcherTalentBatch` from the current/prior-season OVERALL line — starts + relief), so we condition the volume assumption on "is this pitcher actually being used as an SP / RP" — but a healthy SP and an IL-returned SP get the same starts/week projection.

### Saves

SV has no rating-engine window (save chances are role-driven, not per-PA skill), so the neutral-week projection models it directly: `observedSavesPerAppearance(seasonSaves, seasonGames) × appearancesPerWeek`, relievers only. The save-conversion helper lives in [`pitching/talent.ts`](../src/lib/pitching/talent.ts) beside the other observed role signals and is shared with the points rate vector, so both engines agree on who's a closer. Non-closers (below `SAVE_CLOSER_THRESHOLD` season saves) project 0 — an honest under-count for just-anointed closers until saves accrue; refine with save-opportunity data (`statSplits` carries it team-level) if that bites. Starters contribute no SV entry at all, so an SP-only roster aggregates to 0 projected saves and the SV tile lands where it should for a saves-punting team: bottom rank, auto-concede candidate. HLD is still unmodeled.
- **Neutral context** — league-average opposition, neutral park. No park factor, no opp SP adjustment, no weather. Those belong on the day/week pages.
- **IL players are included.** The premise: an IL player will be back to weekly production (or the team would've dropped them). Excluding them asymmetrically distorts the league forecast — a Full count without Acuña doesn't represent Full count's real SB strength. IL players are projected at full-time volume same as healthy hitters; the starting-lineup optimizer still caps each team at the league's daily capacity, so low-talent stash candidates don't displace healthy starters.

What the projection deliberately does *not* consume:

- Today's, this week's, or any specific schedule
- Park, weather, opponent SP
- `analyzeMatchup` (that's L5)
- YTD cumulative stats as a primary input (they feed the talent model as Bayesian evidence, but it's the talent estimate that gets used downstream — not the raw counts)

The result is a per-team per-cat vector that depends **only on the rosters and the scored-cat set**. Add/drop activity is the only thing that moves it. Caching reflects that.

### Volume calibration constants

| Constant | File | Value | Anchor |
|---|---|---|---|
| `TYPICAL_GAMES_PER_WEEK` | [projection/neutralWeek.ts](../src/lib/projection/neutralWeek.ts) | 6 | Empirical MLB pace (~6.2 games/calendar week, slightly discounted for scheduled days off). |
| `TYPICAL_SP_STARTS_PER_WEEK` | [projection/neutralWeek.ts](../src/lib/projection/neutralWeek.ts) | 1.2 | Every-5-day rotation = 1.4/week, discounted for skipped starts and 6-man cycles. |
| `TYPICAL_RP_IP_PER_WEEK` | [projection/neutralWeek.ts](../src/lib/projection/neutralWeek.ts) | 3.0 | Fallback only (live RPs use blended per-player workload). Median across rostered RPs; high-leverage arms can be 5+, mop-up ~2. |
| `TYPICAL_RP_APPEARANCES_PER_WEEK` | [projection/neutralWeek.ts](../src/lib/projection/neutralWeek.ts) | 3.0 | Fallback companion for the SV volume when the talent vector lacks `appearancesPerWeek`. |
| `MIN_GP_FOR_PA_RATE` | [projection/neutralWeek.ts](../src/lib/projection/neutralWeek.ts) | 5 | Below this we use the league default per-game PA rate (4.1) instead of the player's noisy small-sample rate. |

## League forecast

Once every team has a neutral-week projection, `computeLeagueForecast` runs the cross-team comparison:

- **Direction-aware ranking** (best first; higher-is-better for HR, lower-is-better for ERA).
- **Outlier detection** via 1.5×IQR fences on the value distribution. A single dominator in SB is excluded from the comparison set so chasing 2nd place is scored realistically when 1st is unreachable.
- **Z-score vs the competitive (non-outlier) field**, sign-flipped for lower-is-better stats. Positive z always means "my roster's talent outproduces the league field."
- **Reachable target rank**: walks up from the user's rank to find the highest non-outlier rank whose gap is within ~1σ — the rank a single roster move could plausibly attain.

`RATIO_STATS` (AVG, OBP, SLG, OPS, ERA, WHIP, K9, BB9, H9) collapse to `expectedCount / expectedDenom`; everything else is the raw `expectedCount`.

Tunables:

| Constant | File | Anchor |
|---|---|---|
| `OUTLIER_IQR_K` | [league/forecast.ts](../src/lib/league/forecast.ts) | Standard 1.5×IQR outlier fence. |
| `REACHABLE_GAP_SIGMAS` | [league/forecast.ts](../src/lib/league/forecast.ts) | Gap (in competitive sigma) considered closeable with a single roster move. |

## Closeability: Replacement Upgrade Per Move (RUPM)

Z-score normalizes to *distribution spread*, which over-punishes tight distributions (H, AVG) where small absolute deficits read as huge sigma gaps. The unit fantasy managers actually trade in is **moves** — how many roster swaps it would take to close a gap. That's what RUPM measures.

**RUPM (per cat) = `avg(top-K FA per-week output) − avg(bottom-K rostered per-week output)`**

- Top-K FAs: the realistic upgrade pool — the best available pickups at that cat.
- Bottom-K rostered: the realistic drop pool — the marginal players who'd actually be dropped to make room.
- K = 10. League-wide constant per cat (same RUPM for every team in the league).
- Both pools use per-player lines **scaled by role share** (`playingTimeFactor`) — a bench bat projected at everyday volume would inflate the upgrade pool and undersize the "one move" unit.

For ratio cats (AVG, OBP), the per-swap team-level change is scaled by `RATIO_VOLUME_SHARE` (~1 / lineup-size) — adding a high-AVG bat only shifts team AVG by their volume share, not the full FA-vs-replacement rate gap.

See [src/lib/league/rupm.ts](../src/lib/league/rupm.ts). Tunable: `RUPM_K = 10` in the API route.

Then every cat gets two derived metrics:

- **`movesFromMedian = (my_value − competitive_median) / RUPM`.** Positive = ahead of typical opponent by N moves. Negative = behind by N moves.
- **`movesToTarget = gap_to_target_rank / RUPM`.** How many moves to reach the highest realistically reachable rank above me. Undefined when nothing above is reachable in `REACHABLE_GAP_MOVES` or fewer moves.

`zCompetitive` is still emitted for display/debugging but is **not used** for focus assignment.

## Leverage: pivotality on the roster's own distance

Chase/hold/punt is retired here the same way it was retired on the matchup pages (see [pivotality-migration.md](pivotality-migration.md) and history.md "2026-07 — Roster value rebuilt"). Every category is in play by default, weighted by how contested it still is; **concede vs contest is the only user lever.**

```
weight(cat)   = conceded(cat) ? 0 : pivotality(distance)
distance(cat) = signed moves-from-a-winning-rank, scaled so the
                reachability bar lands on the decided-boundary (0.7)
```

- **Distance is side-aware per entry**: RUPM-based where a price exists (`rupm > 0`; batters today): rank ≤ 2 → +cushion over the best competitive team below the rank-2/3 boundary, in move units; rank > 2 → −`movesToTarget`. The scale maps `REACHABLE_GAP_MOVES` (2.0) onto pivotality distance 0.7 — the exact geometry the L5 matchup pages use for margin, so "decided" means the same thing on both horizons. Unpriced cats (pitchers, pending pitcher RUPM) use z-based distance (`zCompetitive / 1.5`, a continuous port of the old v1 bands).
- **Auto-concede** comes from the chase coalition (below), tagged with a reason: `'unreachable'` (no winning rank buyable from here) or `'budget'` (a target exists but the shared budget went to cheaper cats). Deliberately a higher bar than the weekly page — conceding a cat in roster construction forfeits its output all season. A cushioned lead is never auto-conceded; it stays in play at its naturally small weight.
- **Contest** un-concedes: the cat gets its honest (usually small) pivotality weight — and if it has a price, the coalition pre-funds it (see below). The math stays truthful that a 2-move gap buys little; the user stays in charge.
- **Flat fallback** (owner decision): if every cat's weight lands ≈ 0 — everything cushioned/conceded, or the user conceded the board — weights all snap to 1 (unweighted talent value) with a visible note, so the page always ranks something. Deferred follow-up: adaptively relax `REACHABLE_GAP_MOVES` for buried teams so at least one cat stays chaseable instead of conceding the whole board.

Why rank-1/2 as the winning boundary, why RUPM not z — unchanged from the forecast design: rank 1 wins ~90% of weekly H2H cat matchups, rank 2 ~80%, rank 3 ~67%; z over-punishes tight distributions (H, AVG) while RUPM prices gaps in the unit managers actually trade in (moves). See "Closeability" above.

### The chase coalition

Per-cat reachability alone produces "chase everything": each cat is checked against the 2-move bar *as if it were the only chase*, so a team that's 3rd everywhere sees nine rank-1 targets whose combined price (~8 moves) no manager can pay. The mechanism that was missing is the one a smart manager applies without thinking: **you need a winning number of categories, not all of them, and every chase draws on the same move budget.**

`computeCategoryLeverage` therefore takes BOTH sides' cats in one call and builds a coalition:

1. **Banked** — cats already at a winning rank (≤ 2) count for free.
2. **Ride-alongs** — unpriced (z-side) cats above the competitive middle count as winnable without spend.
3. **Chases** — priced cats behind a reachable target, funded cheapest-first (`movesToTarget` ascending) from the single `CHASE_BUDGET_MOVES` pool. The fill extends past the budget only while the coalition is still short of the winning number (majority of all scored cats: `⌊N/2⌋+1`).
4. Everything else **auto-concedes** — the tile caption distinguishes "out of reach" from "moves better spent," and one click contests either.

User overrides participate in the arithmetic: a manual concede frees its budget for the next-cheapest cat; a manual contest on a priced cat pre-funds that chase before the engine picks, so the manager's commitments are paid for honestly. The "→ Nth" chip renders only on funded chases (`targeted`) — an in-play cat without the chip is riding its natural weight, no spend planned.

Known approximation (documented, accepted for v1): chase costs are summed as if independent, but one good add often closes several correlated cats at once (R/RBI/TB travel together), so the budget slightly *understates* what's affordable. The winning-number floor absorbs most of this; the full answer is the concede-set optimizer sketched under "Concession as resource reallocation" below.

Resolution + overrides live in [`useRosterCategoryWeights`](../src/lib/hooks/useRosterCategoryWeights.ts) (localStorage `mlboss-roster-concede:v2:{league}`; one store spanning both sides — the coalition is whole-matchup, so per-side independence is gone by design).

Tunables:

| Constant | File | Anchor |
|---|---|---|
| `DECIDED_DISTANCE` (0.7) | [league/rosterValue.ts](../src/lib/league/rosterValue.ts) | Distance the reachability bar maps to — mirrors the L5 decided-loss threshold so both layers share pivotality geometry |
| `PITCHER_Z_AT_EDGE` (1.5) | [league/rosterValue.ts](../src/lib/league/rosterValue.ts) | z that lands at distance ±1 on the pitcher side — the old v1 LOCKED/HARD_PUNT bands, made continuous |
| `FLAT_FALLBACK_EPS` (0.05) | [league/rosterValue.ts](../src/lib/league/rosterValue.ts) | Weight floor below which the whole board counts as out-of-play and the unweighted fallback engages |
| `REACHABLE_GAP_MOVES` (2.0) | [league/forecast.ts](../src/lib/league/forecast.ts) | Max gap (in RUPM units) for a target rank to count as reachable — the per-cat bar |
| `CHASE_BUDGET_MOVES` (3.0) | [league/rosterValue.ts](../src/lib/league/rosterValue.ts) | Total move budget across ALL funded chases. Estimated: ~1.5× the per-cat bar ("a couple of good swaps plus one more"); the structure (one budget) matters more than the value |

## Player value: leverage-weighted move units

Every batter on the page — rostered and FA — gets one number:

```
value(player) = Σ over scored cats:
    weight(cat) × signed contribution(cat) / RUPM(cat)
```

- **Contributions** come from the same canonical neutral-week projection the league forecast runs on (`projectBatterNeutral` per player, computed in the forecast route and returned as `playerValues`), scaled by the player's role share (`playingTimeFactor` — a 4th outfielder doesn't get everyday-volume credit; RUPM's top-K/bottom-K inputs use the same scaled lines so the "one move" unit prices realistic pickups). Counting cats: weekly count / RUPM. Ratio cats: (player rate − competitive median) × volume share / RUPM. Sign flips for lower-is-better cats — a batter's strikeouts are negative value when K is scored.
- **Weights** are the leverage above. A player's surplus in a cushioned cat buys little *for this team*; the same surplus on a battleground cat is the whole point. This is what makes the score "value to your team" instead of abstract goodness.
- **Display**: raw move-units never render (owner decision — "does 0.34 moves mean pull the trigger?" has no answer). Tables show a **0-100 index** scaled within the combined rostered + FA pool (p10 ≈ 0 ≈ replacement, p99 ≈ 100). Trigger semantics live exclusively on the Suggested Moves list: a swap that clears the net-value bar appears, ranked, with standings language for why; nothing shown = nothing worth doing.

Server/client split: the forecast route computes projection **facts** (per-player lines, RUPM, rankings — cached per league); the client computes **strategy** (leverage from concede state → weights → values) so a concede toggle re-ranks every table instantly without a refetch.

## Move suggestions

The roster page renders **Suggested Moves** (the "Suggested Swaps" of older docs). A move is either:

- A **swap** — drop a rostered player, add a free agent.
- A **pure add** — add a free agent to an open roster slot (no drop required). Generated only when `max_team_size − current_roster_size > 0`.

`generateSwapSuggestions` in [roster/depth.ts](../src/lib/roster/depth.ts) handles both. For a swap, `netValue = computeRosterValue(roster − drop + add) − computeRosterValue(roster)`. For a pure add, `netValue = computeRosterValue(roster + add) − computeRosterValue(roster)` — same machinery without the drop. Pure adds naturally win the ranking when slots are open because they don't pay a drop cost.

The move optimizer scores candidates with the leverage-weighted value above, so the ranking already encodes the strategy. What it doesn't surface: **why** a given move helps — which category it pushes, and whether it quietly drains a cushioned lead.

`analyzeSwapStrategy` decorates each `RankedSwap` with:

- **`categoryImpact[]`** — per-cat delta in **move units** (add contribution minus drop contribution — the actual components of the swap's `netValue`, not an approximation), annotated with the cat's leverage role (`contested` / `cushioned` / `conceded`).
- **`pushesContested`** — swap meaningfully improves a battleground category.
- **`erodesCushion`** — swap meaningfully drains a cushioned lead.
- **`headline`** — dominant strategic effect: `Erodes <cat>` > `Pushes <cat>` > `Reinforces <cat>` > null. Cushion erosion dominates because the warning matters more than gains.
- **`primaryTarget`** — the single category this swap most affects, used by the UI to show strategic context alongside the position-aware reason.

Tunable:

| Constant | File | Anchor |
|---|---|---|
| `NOTABLE_DELTA` (0.25) | [league/swapStrategy.ts](../src/lib/league/swapStrategy.ts) | Threshold above which a swap "meaningfully" pushes/erodes a cat, in move units — a quarter of a typical move's worth of weekly production in that cat. |

## Active vs stash: the FA pool split

Every surface that shops the free-agent pool answers the same policy question first: **is this player a startable add, or an injured-list stash?** The rubric has exactly one home: [roster/playerPool.ts](../src/lib/roster/playerPool.ts) (`isStashableIL` / `splitFAPool`).

The rubric: a real IL stint (IL10/IL15/IL60, legacy DL, or Yahoo's `on_disabled_list` flag) → stash. NA, SUSP, and DTD are **not** stash statuses — those players stay in the active pool and earn their slot through score/ownership. Rationale: an IL player is coming back after a defined recovery window and is exactly the "dropped stud" a stash panel exists to surface, but he can't be started, streamed, suggested as a swap add, or counted as replacement level *now*.

The module exports a second, related predicate: `hasUnavailableStatus` = stashable-IL **or NA** — the lineup-side question ("can he be written into an active lineup at all?"). NA players are unavailable but not stash-worthy; DTD/SUSP players remain startable in Yahoo and are excluded from both predicates. `getRowStatus` ([lineup/types.ts](../src/components/lineup/types.ts)) and the lineup optimizer's `isInjured` ([lineup/optimize.ts](../src/lib/lineup/optimize.ts)) build on it.

Consumers (all must import from the canonical home, never re-derive — a 2026-07 audit found five hand-rolled copies, two of which silently omitted IL15):

- **Categories roster** ([RosterManager.tsx](../src/components/roster/RosterManager.tsx)) — both tabs split Upgrade/Active panels from Stash Targets panels; the swap-optimizer FA pool and the Streaming Advisor's replacement level exclude stashes.
- **Categories streaming** ([StreamingManager.tsx](../src/components/streaming/StreamingManager.tsx), [BatterStreamingBoard.tsx](../src/components/streaming/BatterStreamingBoard.tsx)) — ownership-floor bypass and stash badging.
- **L6 forecast route** ([api/league/[leagueKey]/forecast/route.ts](../src/app/api/league/%5BleagueKey%5D/forecast/route.ts)) — `isOnIL` inputs to `playingTimeFactor` for FA and roster batter lines.
- **Points roster** — the server ([points/analyzeTeam.ts](../src/lib/points/analyzeTeam.ts)) stamps FA rows' `injured` with the rubric; the view ([PointsRosterView.tsx](../src/components/roster/PointsRosterView.tsx)) splits its boards on that flag, and pitcher move candidates + `replacementByPosition` exclude stashes. Client batter strategy ([points/rosterStrategy.ts](../src/lib/points/rosterStrategy.ts)) filters on the same server flag.
- **Points week-moves** ([points/streaming.ts](../src/lib/points/streaming.ts)) — batter plugs exclude stashes; pitcher streams are start-gated so IL arms drop out naturally.

Status-badge coloring in row components (StatusBadge, PlayerRow, LineupGrid) is display-only and may use broader sets; decision logic must not copy those.

Rostered players are a different concept — the L6 forecast deliberately **includes** IL players at role-typical volume (see history.md 2026-05); don't apply this split to roster projections.

## Why this layer doesn't read `analyzeMatchup`

The roster page intentionally diverges from `/lineup` and `/streaming` on focus source:

- **`/lineup` (today)** answers **"what should I do today?"** — `analyzeMatchup` is the right input.
- **`/streaming` (this week)** answers **"who should I pick up for this week?"** — `analyzeMatchup` with the rest-of-week window.
- **`/roster` (rest of season)** answers **"how should I shape my roster for the rest of the year?"** — `computeLeagueForecast` on talent-only neutral-week aggregates.

Same grammar (in-play weighted by pivotality; concede/contest as the only lever). Same shared `pivotality()` primitive. **Different time horizon, different distance, different question** — L5's distance is the corrected matchup margin, L6's is moves-from-a-winning-rank. Never feed one layer's distance into the other.

If you find yourself wanting to merge them, push back. They're decisions on different time horizons and conflating them weakens both. See [recommendation-system.md](./recommendation-system.md#intentional-divergence-roster-page-focus) for the L5-side note.

## What this layer does not (yet) model

**Stat-shape correlation across the free-agent pool.** Categories don't move independently when you add or drop a player: high-HR bats tend to be high-K, contact bats tend to be low-HR, K-heavy pitchers tend to be high-BB. Leverage weighting softens this compared to the old hard swing-set (a player is valued across every in-play cat simultaneously, so an anti-correlated profile pays its own costs in the sum), but the *leverage side* still treats cats independently — it can rate two anti-correlated cats as simultaneously high-leverage even if no available player improves both.

A future iteration could surface infeasibility by inspecting the FA pool's conditional distributions (top-K producers of cat X, median contribution on a conflicting cat). If battleground combinations look unrealistic in practice, that's the lever to add.

**Concession as resource reallocation (punt strategy).** The chase coalition (above) now delivers the v1 of this: it concedes winnable-in-isolation categories when the shared budget is better spent elsewhere — a real punt recommendation, not just an unreachability flag. What it still can't do is model the *roster-slot* side of the trade: conceding a *winnable* category on purpose because doing so frees roster resources that lift the categories you're contesting. The canonical case is punting saves — you may well be able to compete in SV, but rostering closers costs slots and add/drop budget that buy little outside a narrow archetype (SV + some ERA/WHIP/K). Conceding SV unlocks those slots for bats/SPs that help everywhere else. The payoff is the freed resource, not the SV margin. This is the sharpest instance of the stat-shape-correlation gap above.

A tractable future approach reuses existing infra: enumerate a small set of realistic concede-sets (SV, SB, a ratio), re-run [`assignStarters`](../src/lib/roster/depth.ts) + the neutral-week projection under the constraint "don't spend slots/archetype budget on the conceded cats," score the resulting roster on the *kept* set ("dominate a winning number + a real shot at a couple more"), and recommend the concede-set that maximizes that profile. Bounded search, no new engine. Out of scope until the talent-vacuum foundation is trusted; recorded here so the pivotality work doesn't foreclose it.

**Weekly punts stay independent of roster-construction punts.** A roster-level concession (e.g. "built without speed, punting SB for the season") must *not* auto-propagate into the weekly lineup/streaming pages. If a given week happens to have a couple of SB sources in play, that week treats SB as in-play and fights for it — the L5 concede set is computed from *this week's* actual situation, not inherited from L6 roster strategy. The shared pivotality primitive must stay pure (`pivotality(distance)`); `distance` and the concede decision are produced per-layer so the two horizons never get cross-wired.

## Where this fits in the stack

```
L1–L3 rating engines (talent → forecast → rating)
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
L4 schedule-aware    L4' neutral-week
   projection           projection
   (this week)          (typical week, vacuum)
        │                   │
        ▼                   ▼
L5 weekly matchup    L6 roster strategy
   analyzeMatchup       computeLeagueForecast
   useCategoryWeights   rosterValue / useRosterCategoryWeights
                        analyzeSwapStrategy
                  │
                  ▼
       categoryWeights consumed by L3 ratings
       on the appropriate page
```

The L6 forecast is the cross-team aggregation of L4' neutral-week projections — every team in the league gets a per-cat talent projection, then comparative statistics (outliers, z, reachable target) run on top. So L6 depends on the talent layer working correctly for **every** roster in the league, not just the user's.
