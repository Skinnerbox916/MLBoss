# Points leagues

The points-league engine layer (`src/lib/points/`) and its surfaces. Points leagues swap the category machinery (L3 ratings, L5 matchup state, leverage) for one currency — expected fantasy points — while reusing the L1 talent substrate and the shared position/volume primitives. Engine registry: [engines.md](./engines.md#points-league-engines).

> **Verified.** Priced starts and batter day-values are graded against realized fantasy points (computed from the league's own scoring weights) by the `points-pitcher-start` and `points-batter-day` engines; the pitcher board additionally grades *rank quality* — did the top-ranked FA picks actually out-produce the pool? These capture only when the points `/streaming` page is loaded, so their scorecards are as deep as your visits. See [forecast-verification.md](./forecast-verification.md).

## Pipeline

```
blendedBaselineForCategory (shared per-cat Bayesian rates, L1)
        │
        ▼
rateVector.ts     per-PA / per-IP rate of every scorable event
        │           batters: 1B/2B/3B/HR/R/RBI/SB/BB/HBP (+H/TB/K aggregates)
        │           pitchers: Outs/K/H/BB/HBP/ER per IP + W/start + SV/app
        ▼
pointsValue.ts    rates · ScoringProfile.weights × weekly volume × role share
        │
        ├── replacement.ts   3rd-best-FA floor per position → VOR
        ├── analyzeTeam.ts   /api/points/team — the FACTS orchestrator
        ├── rosterStrategy.ts  CLIENT-side strategy: shared position-aware
        │                    depth/swaps (roster/depth.ts) over the facts
        ├── streaming.ts     /api/points/streaming — coverage, streams,
        │                    plugs + per-player day-value FACTS
        └── weekMoves.ts     CLIENT-side unified moves board + session-plan
                             re-pricing over the streaming + team facts
```

## Rate modeling — what's real, what's approximated

- **Hit types (2B/3B)**: per-player Bayesian-regressed rates (stat_ids 10/11 in [categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts), raw path) since 2026-07 — the MLB stat lines carry doubles/triples; they're plumbed through `SplitLine` → `BatterSeasonStats` (current + prior season). The older TB-based decomposition (`decomposeHits`: solve 1B/2B/3B from regressed H/TB/HR with league-anchored triples) remains the **fallback** for stale cached lines and synthetic inputs — see `batterPointsRateVector`.
- **HBP**: per-player regressed rate (stat_id 20) since 2026-07 — plate-crowding is one of the most persistent batter traits, worth ~1.3 pts/wk at the archetype extreme (2.6 pts each, Yahoo default). League-mean fallback (~0.009/PA) when counts are absent.
- **W**: quality- and depth-aware per-start probability (ERA vs league + IP/start). **No team run-support context** — documented v1 limitation.
- **SV**: observed conversion pace (saves/appearances), gated to relievers with ≥3 season saves. Emerging closers under-credit until saves accrue.
- **Volume**: role-typical weekly assumptions (6 games/wk, 1.2 starts/wk, 3 RP IP/wk — mirrors `neutralWeek.ts`) **× role share** (`playingTimeFactor`, since 2026-07) so part-timers, demoted vets, and 4th outfielders don't get everyday-volume credit. Applied across roster AND FA pool so VOR and moves compare like for like.

Calibration constants live in `rateVector.ts` (`POINTS_RATE_CONSTANTS`); smoke harness: `/api/admin/test-points-rating` (also `/api/admin/test-points-profile` for scoring-profile coverage — `unknown_stat_ids` flags any league stat the vector can't produce).

## Matchup-adjustment boundary (deliberate)

Matchup context (park / platoon / opp staff / weather) applies ONLY to day/week lineup-decision scorers — the daily lineup optimizer's day scores and the streaming boards (`matchupAdjust.ts`). Roster-construction values (weekly points, VOR, suggested moves) stay **talent-neutral**, matching the roster page's matchup-vacuum philosophy: park context tells you who to START this week, not who to OWN.

## The `/roster` page (points mode)

`PointsRosterView` — positionally-honest upgrade shopping over a ROS horizon. The page's job (owner, verbatim): *"see who out there could provide more points than who they have, but can fit within the roster position slot picture that they have."* Three sections in the categories page's grammar, native points units throughout (pts/wk and VOR are directly meaningful — no display index needed):

**Facts/preferences boundary** (same rule as the categories page): the server computes cacheable projection **facts** — per-player weekly points, per-stat point contributions (`statPoints`), VOR — once per league+team. The user's **preferences** (target-depth steppers) apply client-side in [`rosterStrategy.ts`](../src/lib/points/rosterStrategy.ts) via `usePointsRosterStrategy`, so a stepper click re-solves instantly with no refetch and no per-preference cache variants. The dashboard consumes the same hook — one source of batter moves.

1. **Positional Depth** — shared [`PositionalDepthTable`](../src/components/shared/PositionalDepthTable.tsx) over the shared depth solver, points-valued, with Target steppers (shared `DepthStepper`); targets persist per league mode via `lib/roster/preferredDepth.ts`.
2. **Suggested Moves** — batter moves from the shared **position-aware swap engine** (`generateSwapSuggestions` fed role-share-adjusted pts/wk): multi-position shuffles, gap weighting, drop resistance, pure adds against open slots (shared `computeOpenSlotCount`). Rendered with the shared [`RosterMoveCard`](../src/components/shared/RosterMoveCard.tsx); the per-stat delta strip shows the pts/wk components of each move's net value (the diff of the rows' `statPoints`). The greedy `recommendSwaps` is **pitchers-only** (position-naive; fine until the joint pitcher effort).
3. **Your Batters ↔ Upgrade Targets** — VOR-ranked boards; every row (rostered and FA) carries `vor`; the FA board shows ownership and applies no extra floor (the pool is already the extended fetch's most-owned 60).

**No strategy header by design.** Points has a single objective — nothing to weight or concede, so nothing earns the categories page's Focus-panel slot. Weekly-points-vs-the-field belongs to the streaming page (its overhaul); league standing belongs to `/league`. See history.md "2026-07 — Points roster page rebuilt".

**Pitchers are deliberately table-only** (no depth chart, greedy moves): pitcher depth/moves for BOTH scoring modes are one future joint effort so the two pages can't diverge (owner decision).

## Week moves

The points `/streaming` page's engine (2026-07 rebuild — see history.md). The page's job (owner): *"I have N moves left this week — what's the best way to spend them?"* One board, one currency: batters and pitchers ranked together by **net expected points for the rest of the window**, each row an add + a suggested drop.

**Facts/preferences boundary, streaming edition.** `analyzePointsStreaming` ships per-player projection facts in its cached payload — `batterFacts` (matchup-adjusted expected points per window day, rostered bats + the FA eval pool) and `myPitcherFacts` (rostered arms' remaining probable starts, priced like FA streams). The board itself is built CLIENT-side by `buildPointsWeekMoves` ([weekMoves.ts](../src/lib/points/weekMoves.ts)) via `usePointsWeekMoves`, re-solving lineups over the facts — which is what makes the **session plan** free: staging a move re-prices every remaining candidate in a memo, no refetch, no new cache variants.

**Pricing.** Batter adds/drops are exact joint lineup re-solves (`optimizePointsLineup` with the add appended and the drop removed — displacement and eligibility handled by the optimizer); only the days either player actually plays are re-solved. Arm adds are additive (priced starts don't displace bats); arm drop cost is the arm's remaining priced starts, falling back to the points-team relief projection for RPs. Cross-side moves (drop a bat, add an arm) price naturally because everything is points. Pure adds appear when cap space exists — batters gate on `computeOpenSlotCount` (cap + placement), arms on `computeCapOpenCount` (cap only).

**Churn pool — the two-signal split.** Drops are suggested ONLY from rostered players whose talent-neutral VOR (points-team facts) sits near replacement; the week-window value then prices what dropping each churn player costs *this week*. This is the matchup-adjustment boundary applied to moves: VOR (who to OWN) decides who is droppable at all, week value (who to START) decides the cost. A streamer with starts left is churn by VOR but expensive by week value — so he correctly survives; a slumping star is never volunteered. Players missing a VOR or facts row (e.g. just-added, cache skew) are never drop candidates. The user can override the suggested drop per row from the priced alternatives. Thresholds (`CHURN_VOR_MAX`, candidate/board caps, `MIN_MOVE_NET`) live in `weekMoves.ts`.

**Session-only plan (deliberate).** The plan is React state in `PointsStreamingManager` — it dies on reload, nothing persists. Reality (the actual roster) is the durable state: execute a move in Yahoo and the next visit re-prices from the new roster, which also means staleness, sniped-player repair, and plan invalidation problems don't exist. Board rows are priced independently against the current roster ("if this were your next move"); the plan is how interactions between moves get priced.

**Surfaces.** `/streaming`: `PointsWeekPlan` (moves-budget pips, opportunity total, day strip with go-live markers) over `PointsMovesBoard` (staging + drop override in the expanded row), with the original stream/plug boards below as the browse pool. Dashboard: `TopWeekMoveTile` renders the top move from the same hook.

## What this layer does not (yet) model

- **Pitcher position-aware moves/depth** — see above.
- **Team run support in W**, **save opportunities in SV** — both need team-context data the app doesn't fetch yet.
- **P-slot capacity in week moves** — an arm add's value assumes a start slot is free that day; leagues with tight P slots or weekly GS caps get slightly over-credited arm adds (`useLeagueLimits` exists if this ever needs wiring).
