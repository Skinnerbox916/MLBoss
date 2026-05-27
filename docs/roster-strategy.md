## Roster Strategy (L6)

**ROS (rest-of-season) roster construction.** Answers "how should I shape my roster for the rest of the season — which cats to dominate, which to concede, where to direct add/drop moves — based on the overall talent of my roster relative to the other teams in the league, in a matchup vacuum."

> See [recommendation-system.md](./recommendation-system.md) for `/lineup` (today) and `/streaming` (this week). The three pages cover three time horizons: **day / week / rest-of-season.** See [architecture.md](./architecture.md#1-two-layers-one-bridge) for why they're deliberately separate.

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
| `computeLeagueForecast` | [league/forecast.ts](../src/lib/league/forecast.ts) | Per-cat per-team neutral-week projected output across the league, outlier detection, z-score vs competitive field, reachable-target rank |
| `assignFocusForBattingSide` (v2, goal-driven) | [league/forwardFocus.ts](../src/lib/league/forwardFocus.ts) | Batter-side anchor / swing / concede partition that fills a winning-majority target |
| `forwardFocusV1` (per-cat z-bands) | [league/forwardFocus.ts](../src/lib/league/forwardFocus.ts) | Pitcher-side per-cat chase/hold/punt assignment (while v2 batter model validates) |
| `forecastToAnalysis` | [league/forwardFocus.ts](../src/lib/league/forwardFocus.ts) | Adapter that wraps a `LeagueForecast` as a `MatchupAnalysis` so `useSuggestedFocus` consumes it the same way it consumes weekly matchup output |
| `analyzeSwapStrategy` | [league/swapStrategy.ts](../src/lib/league/swapStrategy.ts) | Decorates a `RankedSwap` with per-cat impact + plan role + headline (pushes swing / erodes anchor / reinforces anchor) |

The underlying swap optimizer (`generateSwapSuggestions` returning `RankedSwap[]`) lives in [roster/depth.ts](../src/lib/roster/depth.ts). It is roster-construction infrastructure (multi-position eligibility, replacement value, gap weighting) and isn't covered here; `analyzeSwapStrategy` is the layer that puts a strategic interpretation on top.

## Starting-lineup cap

A 14-hitter roster doesn't produce 14 hitters' worth of stats per week — only the 10-ish that fit the league's daily starting lineup do. Bench players give optionality (matchup gains, off-day coverage), not extra volume.

Each team's projection is therefore capped by **optimal starting-lineup selection**: before projecting, run [`assignStarters`](../src/lib/roster/depth.ts) (the same position-aware optimizer that powers the depth chart) on the team's full active roster. The optimizer uses focus-neutral [`blendedCategoryScore`](../src/lib/roster/scoring.ts) to value players, then fills C / 1B / 2B / 3B / SS / OF×N / UTIL×M slots with the best position-eligible players via backtracking + alpha-beta pruning. Only the assigned starters feed into the projection.

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
  - Pitcher: role-typical workload. SP: `TYPICAL_SP_STARTS_PER_WEEK (1.2) × talent.ipPerStart`. RP: `TYPICAL_RP_IP_PER_WEEK (3.0)`. Role itself is observed (set inside `getPitcherTalentBatch` from current/prior-season GS and IP), so we condition the volume assumption on "is this pitcher actually being used as an SP / RP" — but a healthy SP and an IL-returned SP get the same starts/week projection.
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
| `TYPICAL_RP_IP_PER_WEEK` | [projection/neutralWeek.ts](../src/lib/projection/neutralWeek.ts) | 3.0 | Median across rostered RPs; high-leverage arms can be 5+, mop-up ~2. |
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

For ratio cats (AVG, OBP), the per-swap team-level change is scaled by `RATIO_VOLUME_SHARE` (~1 / lineup-size) — adding a high-AVG bat only shifts team AVG by their volume share, not the full FA-vs-replacement rate gap.

See [src/lib/league/rupm.ts](../src/lib/league/rupm.ts). Tunable: `RUPM_K = 10` in the API route.

Then every cat gets two derived metrics:

- **`movesFromMedian = (my_value − competitive_median) / RUPM`.** Positive = ahead of typical opponent by N moves. Negative = behind by N moves.
- **`movesToTarget = gap_to_target_rank / RUPM`.** How many moves to reach the highest realistically reachable rank above me. Undefined when nothing above is reachable in `REACHABLE_GAP_MOVES` or fewer moves.

`zCompetitive` is still emitted for display/debugging but is **not used** for focus assignment.

## Forward focus: v2 (batter side)

H2H category leagues are won by accumulating category points across the season. **Anchor in everything you can; chase everything reachable; concede only what's genuinely out of reach.** There's no quota — if your roster could realistically win every cat, the plan chases every cat.

`assignFocusForBattingSide` classifies each cat:

- **Anchor**: `me.rank ≤ 2`. You're already winning the cat in expectation (rank 1 ≈ 90% of weekly H2H matchups; rank 2 ≈ 80%). Hold position, don't dilute.
- **Swing**: `me.rank > 2` AND `targetRank` is defined (rank 1 or 2 reachable in ≤ `REACHABLE_GAP_MOVES`). Chase — the cat is closeable into a winning position.
- **Concede**: rank > 2 AND neither rank 1 nor 2 is reachable. Roster shape doesn't support winning.

**No forced punts.** The first cut of this engine forced every cat outside the top-N swings to PUNT to "make room" for a `⌈cats × 0.7⌉` winning-majority target. That was wrong — it artificially demoted cats that were clearly chaseable just to keep the count down. The right model: punt only what's actually unreachable.

**No median benchmark.** "Above median" is rank 5 in a 10-team league, which is barely above coin-flip in H2H weekly play. The benchmark is rank 1-2, the ranks that reliably win the cat.

**No rank-3 targets.** Rank 3 only wins ~67% of weekly H2H cat matchups — not reliable enough to spend roster moves on. The walk-up logic in [forecast.ts](../src/lib/league/forecast.ts) tries rank 1 first, falls back to rank 2 if rank 1 isn't reachable, then gives up.

**Majority floor.** Anchors + swings should clear strict majority (`⌊cats / 2⌋ + 1` — 5 for 9 cats). Below that, `belowMajority = true` flags a roster shape problem: even pursuing every reachable cat can't get you to "winning more cats than not." The floor is informational — the algorithm never demotes a swing to punt to satisfy a target.

Output: a `BattingFocusPlan` with `anchors`, `swings`, `concedes`, `majority` (the floor), `committed` (anchors+swings count), and `belowMajority` flag.

**Why RUPM-based reachability.** Z-score normalizes to distribution spread, which over-punishes tight distributions (H, AVG) where small absolute deficits look like 1.5σ chasms. RUPM normalizes to what one move actually buys you — the unit fantasy decisions are actually made in. SB has wide spread but small RUPM (specialists are scarce) → "1 SB deficit = 2 moves." H has tight spread but large RUPM (contact bats are abundant) → "2 H deficit = 0.5 moves." RUPM correctly inverts the intuition that std-dev gets wrong.

Tunables:

| Constant | File | Anchor |
|---|---|---|
| `ANCHOR_RANK_THRESHOLD` (2) | [league/forwardFocus.ts](../src/lib/league/forwardFocus.ts) | Highest rank that still counts as anchor. Rank ≤ 2 reliably wins H2H weekly cat matchups; rank 3 doesn't. |
| `TARGET_RANKS` ([1, 2]) | [league/forecast.ts](../src/lib/league/forecast.ts) | Ranks worth chasing. Rank 1 tried first, rank 2 as fallback. Rank 3+ never a target. |
| `REACHABLE_GAP_MOVES` (2.0) | [league/forecast.ts](../src/lib/league/forecast.ts) | Max gap to a target rank (in RUPM units) for it to count as reachable. |
| `RUPM_K` (10) | [api/league/[leagueKey]/forecast/route.ts](../src/app/api/league/%5BleagueKey%5D/forecast/route.ts) | Top-K FA / bottom-K rostered sample size for RUPM. Smooths single-player noise without diluting the realistic-upgrade signal. |
| `RATIO_VOLUME_SHARE` (0.1) | [league/rupm.ts](../src/lib/league/rupm.ts) | For ratio cats, scales the FA-vs-replacement rate gap to a team-level rate change (one swapped player ≈ 1/10 of team volume). |
| `majorityFloor(cats)` (`⌊cats/2⌋+1`) | [league/forwardFocus.ts](../src/lib/league/forwardFocus.ts) | Below-floor threshold for `belowMajority`. Strict majority for the cat count. |

## Forward focus: v1 (pitcher side, per-cat bands)

`forwardFocusV1` maps a single forecast entry to chase / hold / punt without considering the rest of the portfolio. Used for pitching while v2 is being validated on batting — pitcher rosters typically run "ace anchors + streamers" so the per-cat bands are a reasonable first cut.

Bands:

| z-score range | Suggestion | Rationale |
|---|---|---|
| z ≥ +1.5σ | punt | Locked-good — redirect investment |
| +0.5σ ≤ z < +1.5σ | neutral (hold) | Comfortably above the field, defend against erosion |
| −0.5σ ≤ z < +0.5σ AND reachable target | chase | Contested with a closeable gap |
| −0.5σ ≤ z < +0.5σ AND no reachable target | neutral (hold) | Mid-pack stable, no obvious target above |
| −1.5σ < z < −0.5σ AND reachable target | chase | Closeable deficit |
| z ≤ −1.5σ OR (z < −0.5σ AND no target) | punt | Catastrophic deficit, no recovery |

The asymmetry vs v2 batter: v1 doesn't enforce a winning-majority target. If five pitcher cats are mid-pack-stable, all five land as `neutral` — no forced punts. The pitcher-side rebuild to v2 is on the roadmap.

Tunables:

| Constant | File | Anchor |
|---|---|---|
| `LOCKED_Z` (+1.5σ) | [league/forwardFocus.ts](../src/lib/league/forwardFocus.ts) | Beyond this, redirect investment elsewhere. |
| `HARD_PUNT_Z` (−1.5σ) | [league/forwardFocus.ts](../src/lib/league/forwardFocus.ts) | Catastrophic deficit, no recovery this season. |

## Adapter: `forecastToAnalysis`

The roster page uses [`useSuggestedFocus`](../src/lib/hooks/useSuggestedFocus.ts) the same way the today/streaming pages do — it reads `rows[].statId` and `rows[].suggestedFocus` from a `MatchupAnalysis`. To keep the consumer code identical, `forecastToAnalysis` wraps a `LeagueForecast` in a `MatchupAnalysis` shape: batter cats get the v2 assignment, pitcher cats get v1, the other matchup-analysis fields (margin, priority, leverage) are placeholder zeros — forecast math doesn't map onto the matchup analyzer's `[−1, +1]` margin scale.

This is the deliberate single connection between the L5 weekly recommendation surface and the L6 roster recommendation surface: same `focusMap` consumer, different source. See [architecture.md](./architecture.md#1-two-layers-one-bridge).

## Move suggestions

The roster page renders **Suggested Moves** (the "Suggested Swaps" of older docs). A move is either:

- A **swap** — drop a rostered player, add a free agent.
- A **pure add** — add a free agent to an open roster slot (no drop required). Generated only when `max_team_size − current_roster_size > 0`.

`generateSwapSuggestions` in [roster/depth.ts](../src/lib/roster/depth.ts) handles both. For a swap, `netValue = computeRosterValue(roster − drop + add) − computeRosterValue(roster)`. For a pure add, `netValue = computeRosterValue(roster + add) − computeRosterValue(roster)` — same machinery without the drop. Pure adds naturally win the ranking when slots are open because they don't pay a drop cost.

The move optimizer already scores candidates with focus-aware weighting (chase cats double, punt cats excluded), so the chase/punt baseline shapes the ranking. What it doesn't surface: **why** a given move helps in plan terms — does it push a swing target, reinforce an anchor, or erode one?

`analyzeSwapStrategy` decorates each `RankedSwap` with:

- **`categoryImpact[]`** — per-cat raw normalized-rate delta (add minus drop), annotated with role from the v2 plan (`anchor` / `swing` / `concede`). ~0.10 is meaningful; ~0.20+ is big. Magnitude is approximate (not playing-time-weighted); sign and ranking are reliable.
- **`pushesSwing`** — swap meaningfully improves a swing-target category.
- **`erodesAnchor`** — swap meaningfully erodes an anchor category.
- **`headline`** — dominant strategic effect: `Erodes <cat>` > `Pushes <cat>` > `Reinforces <cat>` > null. Anchor erosion dominates because the warning matters more than gains.
- **`primaryTarget`** — the single category this swap most affects, used by the UI to show strategic context alongside the position-aware reason.

Tunable:

| Constant | File | Anchor |
|---|---|---|
| `NOTABLE_DELTA` (0.05) | [league/swapStrategy.ts](../src/lib/league/swapStrategy.ts) | Threshold above which we say a swap "meaningfully" pushes/erodes a cat. Calibrated for normalized-rate units (each cat normalizes to ~[0, 1]). |

## Why this layer doesn't read `analyzeMatchup`

The roster page intentionally diverges from `/lineup` and `/streaming` on focus source:

- **`/lineup` (today)** answers **"what should I do today?"** — `analyzeMatchup` is the right input.
- **`/streaming` (this week)** answers **"who should I pick up for this week?"** — `analyzeMatchup` with the rest-of-week window.
- **`/roster` (rest of season)** answers **"how should I shape my roster for the rest of the year?"** — `computeLeagueForecast` on talent-only neutral-week aggregates.

Same vocabulary (chase / neutral / punt). Same `focusMap` shape. Same rating engines downstream. **Different time horizon, different input, different question.**

If you find yourself wanting to merge them, push back. They're decisions on different time horizons and conflating them weakens both. See [recommendation-system.md](./recommendation-system.md#intentional-divergence-roster-page-focus) for the L5-side note.

## What this layer does not (yet) model

**Stat-shape correlation across the free-agent pool.** Categories don't move independently when you add or drop a player: high-HR bats tend to be high-K, contact bats tend to be low-HR, K-heavy pitchers tend to be high-BB. So committing to swing on two strongly anti-correlated cats simultaneously (e.g. HR and K-avoidance) can be infeasible — no available player improves both.

The current v2 plan does not see this. It picks swings purely by closeness to flip. If the plan recommends a swing combination that the FA pool can't realistically support, the user has to spot it themselves.

A future iteration could prune infeasible swings by inspecting the FA pool's conditional distributions (top-K producers of cat X, median z on a conflicting cat). Out of scope for v1 — the talent-vacuum foundation has to be solid and trusted before layering this on. If swing recommendations look unrealistic in practice, that's the lever to add.

**Concession as resource reallocation (punt strategy).** The engine today concedes a category only when it's *unreachable* (`targetRank` undefined) and scores every cat independently. It therefore can't model the strongest lever in category-league roster construction: conceding a *winnable* category on purpose because doing so frees roster resources that lift the categories you're contesting. The canonical case is punting saves — you may well be able to compete in SV, but rostering closers costs slots and add/drop budget that buy little outside a narrow archetype (SV + some ERA/WHIP/K). Conceding SV unlocks those slots for bats/SPs that help everywhere else. The payoff is the freed resource, not the SV margin. This is the sharpest instance of the stat-shape-correlation gap above.

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
   useSuggestedFocus    forwardFocus / forecastToAnalysis
                        analyzeSwapStrategy
                  │
                  ▼
       focusMap consumed by L3 ratings
       on the appropriate page
```

The L6 forecast is the cross-team aggregation of L4' neutral-week projections — every team in the league gets a per-cat talent projection, then comparative statistics (outliers, z, reachable target) run on top. So L6 depends on the talent layer working correctly for **every** roster in the league, not just the user's.
