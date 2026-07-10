# Points leagues

The points-league engine layer (`src/lib/points/`) and its surfaces. Points leagues swap the category machinery (L3 ratings, L5 matchup state, leverage) for one currency — expected fantasy points — while reusing the L1 talent substrate and the shared position/volume primitives. Engine registry: [engines.md](./engines.md#points-league-engines).

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
        ├── depth/swaps      shared position-aware machinery (roster/depth.ts)
        └── analyzeTeam.ts   /api/points/team — the single orchestrator
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

1. **Positional Depth** — shared [`PositionalDepthTable`](../src/components/shared/PositionalDepthTable.tsx) over the shared depth solver, points-valued. Default depth config (no preferred-depth steppers in v1).
2. **Suggested Moves** — batter moves from the shared **position-aware swap engine** (`generateSwapSuggestions` fed role-share-adjusted pts/wk): multi-position shuffles, gap weighting, drop resistance, pure adds against open slots (shared `computeOpenSlotCount`). Rendered with the shared [`RosterMoveCard`](../src/components/shared/RosterMoveCard.tsx); the per-stat delta strip shows the pts/wk components of each move's net value. The greedy `recommendSwaps` is **pitchers-only** (position-naive; fine until the joint pitcher effort).
3. **Your Batters ↔ Upgrade Targets** — VOR-ranked boards; every row (rostered and FA) carries `vor`; the FA board shows ownership and applies no extra floor (the pool is already the extended fetch's most-owned 60).

**No strategy header by design.** Points has a single objective — nothing to weight or concede, so nothing earns the categories page's Focus-panel slot. Weekly-points-vs-the-field belongs to the streaming page (its overhaul); league standing belongs to `/league`. See history.md "2026-07 — Points roster page rebuilt".

**Pitchers are deliberately table-only** (no depth chart, greedy moves): pitcher depth/moves for BOTH scoring modes are one future joint effort so the two pages can't diverge (owner decision).

## What this layer does not (yet) model

- **Pitcher position-aware moves/depth** — see above.
- **Team run support in W**, **save opportunities in SV** — both need team-context data the app doesn't fetch yet.
- **Streaming-volume strategy** (how many extra starts a heavy streamer squeezes from open slots) — that's the `/streaming` page's concern and its planned overhaul, not roster construction.
