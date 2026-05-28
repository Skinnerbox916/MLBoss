# PRD: Sit-to-flip — opponent-total sit engine

Status: **proposed, not built.** Source-of-truth for the intended successor
to today's `computeBatterSitValue` + `isGamePlanSitWorthy` in
[src/lib/lineup/sitValue.ts](../src/lib/lineup/sitValue.ts). Implement against
this doc; update it if the design changes.

## Problem

The current sit engine has two failure modes:

1. **No stopping condition.** It scores each bat's net contribution
   independently and benches anyone whose net dips below zero. So when AVG
   and batter-K are both contested, it can flag the *entire lineup* (every
   bat that adds any K or hits below opp AVG counts as "harm"). It keeps
   benching past the point where you'd already be projected to win the
   ratio cat — pure loss of counting production for zero gain.
2. **No opponent-total bar for K.** AVG anchors to the opponent's projected
   team AVG (the bar to beat); K has no equivalent — it just penalises raw
   strikeouts. So the engine can't tell the difference between "down a few
   Ks, sit one bat to flip" and "down 50 Ks, hopeless."

Both stem from the same root: the per-player scoring lacks a
**team-level, opponent-anchored stopping condition.**

## Goal

Sit **just enough** bats to flip the contested manageable cats (AVG, batter
K) relative to the opponent's projected weekly totals — then **stop.**

This naturally produces three behaviours we want for free:
- **No over-sitting** when the projection already wins the cat (zero gap
  → zero sits).
- **Feasibility check.** If even maximum sitting can't close the gap, the
  cat is genuinely unreachable → signal to concede (cleaner than today's
  fixed `-DECIDED` margin threshold, which doesn't know whether sitting
  could flip it).
- **"Give me a chance" works** without overshooting: contesting K
  triggers exactly the sits needed to clear the bar, not a blanket lineup
  bench.

## Scope (anti-goals)

Per the user's "don't overengineer" steer:

- **Manageable cats are AVG and batter-K only.** Pitcher ratios
  (ERA/WHIP/K-9/etc.) are out of scope — they're a different page
  (streaming) with different levers (probable-start selection, not
  sitting).
- **Per-day greedy heuristic, not integer programming.** Sort bats by
  per-day harm in the contested cat, tentatively sit one at a time,
  recheck the weekly projection, stop when it flips. No combinatorial
  search.
- **No multi-day cross-optimisation.** Each day decides on its own using
  the latest projected totals. Days re-converge naturally — Monday's
  sits reduce the projected total Tuesday sees.
- **Don't model second-order effects on counting cats.** Sitting some
  bats erodes locked counting leads in principle; assume locked counting
  is safe (matches the rest of the system).

## Inputs

All already exist:

| Input | Where it lives | Use |
|---|---|---|
| Opponent's projected weekly total per cat | `useCorrectedMatchupAnalysis` → `oppProjection.byCategory` | The **bar** for each contested cat |
| Your projected weekly total per cat | same → `myProjection.byCategory` | Current standing vs the bar |
| Per-player per-day projected K + AB / AVG | `projectBatterPlayer` (existing) → `PerDayProjection` and `byCategory` | Per-player harm contribution; who to sit |
| Conceded set | `useCategoryWeights` → `isConceded` | A cat the user explicitly conceded is **not** a target, regardless of the gap |
| Position eligibility + slot template | `useRosterPositions` + roster | Don't sit so many you can't field a legal lineup |

## Algorithm (per-day)

For the day being optimised:

1. **Identify targets.** Manageable cats (AVG, batter-K) that are *not
   conceded* and where you're projected to lose end-of-week (gap < 0).
   No targets → exit; optimiser proceeds with normal composite scoring.
2. **For each target, compute the gap.** `gap = oppProjectedTotal −
   yourProjectedTotal` (with sign convention: positive means you'd lose).
3. **Build the candidate list.** Today's starters with a game, ordered
   by per-day harm in the target cat: highest projected day-K (for K),
   lowest projected day-AVG below opp AVG (for AVG).
4. **Greedy: tentatively sit candidates one at a time.** After each
   tentative sit, recompute your projected weekly total for the target
   cat (subtract sat bat's expected day contribution). Stop sitting for
   *this cat* when the gap closes (with a small `BUFFER` cushion) OR
   the candidate list is exhausted.
5. **Union sit sets across targets.** A bat sat for K is also sat for
   AVG (and vice versa) — the union is the day's sit list. A bat sat
   for one target counts toward closing the other's gap too.
6. **Bound the sit count.** If the algorithm would sit so many bats
   that the day's lineup falls below `MIN_PLAYABLE_STARTERS`, stop
   adding sits — better to field a real lineup and leave the cat
   unflipped than to play with three bats. The unflipped cat should be
   surfaced as "unreachable today" rather than auto-conceded.
7. **Feed the union sit set into the existing optimiser.** The Hungarian
   pass with `allowEmpty` (already implemented) handles the rest.

## Outputs

Same shape as today (so the optimiser, advisory, and UI keep working):
- A per-bat decision: starts or sits.
- A short reason string for the "Sit to protect ratios" advisory,
  derived from which target(s) drove the sit (e.g. "+1.2 K toward closing
  −14 gap").
- A new optional signal per target: `flipReachable: boolean` —
  whether the greedy pass actually closed the gap. Drives:
  - the advisory copy ("on pace to flip K" vs "can't reach K — concede?"),
  - the auto-concede successor (a cat we can't reach via max sitting
    is what "out of reach" should mean — replacing the naive
    `−DECIDED` margin rule for manageable cats).

## Stopping condition (the load-bearing piece)

A target's sits **stop the moment its projected weekly total clears the
opponent's by `BUFFER`.** No further bats are sat *for that target.* If a
later target's loop also wants to sit the same bat, fine — but we never
add to the sit set "just to push the lead further." That's the whole
fix vs. today's behaviour.

## Calibration knobs

Default values are starting points; tune by watching real weeks. See
[docs/architecture.md](architecture.md) calibration-discipline rules.

| Knob | Default | What it controls |
|---|---|---|
| `BUFFER` (per cat) | ~5% of cat scale | Safety cushion past the projected bar so the projection variance doesn't put you back under it. Per cat because K and AVG have different scales. |
| `MIN_PLAYABLE_STARTERS` | ~6 (of typical ~10 hitter slots) | Floor on how many starters the day must field. Prevents degenerate "sit everyone" when the gap is hopeless. |
| `MAX_SITS_PER_TARGET` | (optional, e.g. 3) | Belt-and-braces cap. The `MIN_PLAYABLE_STARTERS` floor probably subsumes this, but worth considering. |

## Implementation targets

| File | Change |
|---|---|
| [src/lib/lineup/sitValue.ts](../src/lib/lineup/sitValue.ts) | Refactor / replace `computeBatterSitValue` + `isGamePlanSitWorthy`. Add `flipReachable` to the output. |
| [src/components/lineup/LineupManager.tsx](../src/components/lineup/LineupManager.tsx) | Pass `myProjection.byCategory` and `oppProjection.byCategory` into the new sit engine; surface `flipReachable` in the advisory copy. |
| [src/lib/lineup/optimizeWeek.ts](../src/lib/lineup/optimizeWeek.ts) | Same input thread-through for the week optimiser. |
| [docs/recommendation-system.md](recommendation-system.md) | Update the sit-engine section to describe the new model; link to this PRD until the build lands, then fold into it. |

## Validation

Browser-validate on three contrasting weeks:

1. **Comfortable lock** (the user's 7-W-2L example): K projected −14
   genuinely out of reach. Expected: `flipReachable = false`; advisory
   suggests conceding K; sits **zero** or one or two bats — not nine.
2. **Flippable K** (e.g. you're projected −3 K behind): sits a small
   set (1–3 bats) to close the gap, then stops. Advisory says "on pace
   to flip K."
3. **AVG-only** (K conceded, AVG narrowly losing): sits the worst
   AVG-vs-opp bat or two, stops when projected ahead.

In all three, locked counting cats stay locked (no avalanche).

## Open questions for the build pass

- **Per-day K projection per bat** — does `projectBatterPlayer`'s
  per-day output already include expected K (not just AVG)? If not, plumb
  per-cat per-day expected counts through the existing projection.
- **Interaction with `flipReachable` and the existing concede UI** —
  should the panel proactively suggest conceding when
  `flipReachable=false`, or just stop sitting and let the user notice?
  Probably the former (one-click "concede K — out of reach" action).
- **Pitcher streaming analog.** Out of scope here, but the same
  opponent-total framing might apply to ERA/WHIP/K via probable-start
  selection. Capture as a future PRD if it surfaces.
