# Roster value rebuild — proposal

**Status: proposal, not implemented.** Written 2026-07 after the Albies investigation (roster page scored Ozzie Albies 4.94 while ranking two FA bats above 9). On acceptance this folds into [roster-strategy.md](./roster-strategy.md) + [history.md](./history.md) entries and this file is deleted; if rejected, move the "Why" section to history.md so the reasoning isn't lost.

**One sentence:** replace `blendedCategoryScore` (the roster page's parallel batter-value engine) with a value derived from the canonical neutral-week projection, weighted by category leverage from the league forecast — completing the L6 half of [pivotality-migration.md](./pivotality-migration.md) at the same time.

---

## Why (the problem, in three parts)

### 1. Two parallel answers to "how good is this batter" on one page

The roster page's focus panel and team rankings run on the canonical path: L1 talent (`talentModel.ts`) → L3 rating (`getBatterRating`) → L4' neutral-week projection (`projectBatterNeutral`) → L6 forecast. But the player tables, depth chart, and swap optimizer run on `blendedCategoryScore` (`roster/scoring.ts`) — a second, older implementation with its own per-cat blending (`categoryBaselines.ts` two-path), its own bonuses, and a bare-number output that [history.md](./history.md) already flags as L3 Rating-shape drift. The two paths can and do disagree about the same player.

### 2. The score triple-counts contact quality and ignores team context

`blendedCategoryScore` = Σ per-cat normalized rates (AVG/H already priced from xBA via the talent path) **+ quality bonus** (xwOBA again, up to ~25% of a score) **+ rising bonus** (xwOBA delta, again), × playing time. One signal, up to three entries. History.md's talent-baselines entry already calls the bonuses "partially redundant" and rules "don't reintroduce Statcast bonuses at the consumer layer" — this proposal finishes that thought by deleting them.

Meanwhile the score is team-blind: a player's SB production scores the same whether you're locked into 1st in SB or hopelessly 9th. The focus map (chase ×2 / punt ×0) was the only team-context channel, and it's a step function driven by a 3-state label the matchup pages already retired (see [pivotality-migration.md](./pivotality-migration.md), history.md "2026-05 — Chase/hold/punt retired").

### 3. What the research says about expected stats (July 2026 review)

- xwOBA predicts next-season wOBA better than wOBA — but modestly: r ≈ .57 vs .54 ([Paraball Notes](https://www.paraballnotes.com/blog/how-can-we-make-predictive-woba-even-more-predictive); [FanGraphs community](https://community.fangraphs.com/properly-diving-into-expected-stats/) r² .218 vs .191). A tilt, not a replacement.
- Blends beat both inputs: Tango's Predictive wOBA (expected on contact, actual K/BB, mean-regression under 500 PA) reaches r ≈ .59–.61.
- The actual-minus-expected residual is mostly noise year-to-year (r² ≈ .17) — the "unlucky, due for a breakout" narrative is largely false ([RotoGraphs in-season study](https://fantasy.fangraphs.com/the-in-season-predictiveness-of-xwoba/)) — **but** identifiable archetypes beat expected stats persistently through skill: fast/contact profiles by ~15–22 points of wOBA ([FanGraphs](https://blogs.fangraphs.com/how-to-beat-statcasts-hitting-metric/); [sprint-speed correlation r = .61 on grounders](https://fantasy.fangraphs.com/how-sprint-speed-relates-to-woba-xwoba/)). Statcast added speed to xBA on some batted-ball classes in 2019; spray angle and bat-control profiles remain outside the model.

Implication: pricing AVG/H from **pure** xBA systematically shortchanges the fast/bat-control archetype (the Albies case: 2026 wOBA .331 vs xwOBA .302), and stacking xwOBA bonuses on top compounds it.

---

## The model

Per-player ROS value to **this** team, in units a manager already thinks in (roster moves):

```
value(player) = Σ over scored cats:  weight(cat) × (playerWeeklyCat − replacementWeeklyCat) / RUPM(cat)

weight(cat)   = conceded(cat) ? 0 : pivotality(distance(cat))
distance(cat) = signed moves-from-winning-rank in RUPM units, clamped to [−1, +1]
                (rank ≤ 2: +cushion over the rank-3 line; rank > 2: −gap to the
                 reachable target rank; scale = REACHABLE_GAP_MOVES)
conceded(cat) = auto when no target rank is reachable (existing `targetRank === undefined`
                logic — deliberately a higher bar than the weekly page), or by user override.
```

Reading it back in plain terms: *a player is worth what he moves your standings needle, category by category, counted only in categories that are still up for grabs.* One unit = one typical roster move's worth of production.

**Move-units are internal only.** They exist so a HR surplus and an SB surplus can be compared honestly (each cat normalized by what one realistic move buys in that cat), but they are never shown raw. The display layer translates: tables show a 0–100 index (below), and Suggested Moves cards explain net value in standings language ("pushes K from 4th toward 3rd").

### What each piece reuses

| Piece | Source | Status |
|---|---|---|
| Per-player weekly cat line | `projectBatterNeutral` (`projection/neutralWeek.ts`) | exists — already used for RUPM |
| Per-cat rates inside it | `getBatterRating` at neutral context (canonical L3) | exists |
| RUPM per cat | `league/rupm.ts` | exists |
| Distance inputs (rank, target, gaps) | `computeLeagueForecast` (`league/forecast.ts`) | exists |
| `pivotality()` | `rating/pivotality.ts` | exists — shared primitive, L6 produces its own distance per the migration doc |
| Concede-only override + persistence | mirror of `useCategoryWeights` (L5) | pattern exists |
| Replacement level, position eligibility, depth, swap enumeration | `roster/depth.ts` | exists — consumes the new value instead of `blendedCategoryScore` |
| Role-share playing time | `playingTimeFactor` (`roster/scoring.ts`) | exists — moves into the volume term (below) |

### Rate-substrate changes (research-informed, inside the talent layer)

1. **xBA blends with actual, doesn't replace it.** `computeBatterTalentXwoba`'s surfaced `xba` becomes ~60% regressed xBA + 40% regressed actual BA (exact weight anchored to the r ≈ .54/.57/.59 ladder above; document in [unified-rating-model.md](./unified-rating-model.md#calibration-anchors)). This lives in the talent layer so every consumer (lineup, streaming, roster) benefits in one place — per the standing rule.
2. **HR/TB join the talent path via xSLG** — closing the documented open follow-up in history.md (plumbing already done; needs the `talentRateForCategory` branches + xSLG→TB/PA conversion).
3. **Quality and rising bonuses are deleted**, not re-tuned. Their legitimate job ("current contact beats regressed talent") is the batter regime probe's job (documented open follow-up, out of scope here); their illegitimate job (triple-counting) shouldn't exist.

### Playing time

`projectBatterNeutral` assumes 6 games/week for everyone — right for team aggregates (the starting-lineup cap bounds them), wrong for ranking individual adds (a 4th outfielder is not an everyday bat). The per-player value multiplies the neutral-week volume by the existing `playingTimeFactor` role share (which already handles IL returns and demotions). Applied consistently to the FA pool and to RUPM's top-K/bottom-K inputs so the "one move" unit stays honest. Team-level forecast volume is unchanged.

### UI consequences

- `RosterFocusPanel` converts from Chase/Hold/Punt trio to **In play** (ranked by leverage) + **Conceded** shelf with a 2-state concede/contest toggle — the same collapse `GamePlanPanel` already went through. This deletes the failure mode found during the Albies investigation, where two stale 3-state overrides (SB→chase, K→punt) silently steered the entire scoring for weeks while the panel subtitle described the opposite plan.
- Player tables sort by the new value, displayed as a **0–100 index** scaled within the combined rostered + FA pool (replacement level ≈ 0), matching the app's existing 0–100 rating language. The column's meaning changes from "abstract goodness" to "value to *your* team." Raw move-units are never rendered; the "should I pull the trigger" question is answered by presence in Suggested Moves (a swap that clears the net-value bar appears, ranked; nothing shown = nothing worth doing), with per-card standings language for the why.
- `assignFocusForBattingSide` / `forwardFocusV1` retire as *weight* producers; the anchors/swings/concedes language survives as presentation derived from leverage state (cushion / battleground / conceded). `useSuggestedFocus` and the `focusPanel.tsx` chrome die with the conversion — which is pivotality-migration **Phase 6**, so that migration closes out inside this branch.

### Worked example (why Albies lands right, for the right reason)

Under the new model Albies' HR/RBI/R production is priced fine — but lands in categories where this team is ranked 1st–2nd with cushion, so it buys little (small pivotality weight, honestly earned). His elite K-avoidance now counts — K is 4th and chaseable (high leverage), and the old overrides that excluded K can't exist. His AVG/H stop being priced at pure xBA, so the fast/contact archetype penalty shrinks. Nimmo's case stops being "quality + rising bonuses" (deleted) and becomes only what his projected line contributes to chaseable cats. Benge keeps ranking high on genuine category fit (SB where it matters, H/AVG). The ordering compresses from "drop your 50th-ranked player, he's half a Nimmo" to a defensible gap with a one-sentence explanation per player.

---

## What dies / what survives

**Dies:** `blendedCategoryScore`, quality + rising bonuses (`statcastQualityScore` / `risingBonus` as score components), chase ×2 / punt ×0 weighting on the roster page, `useSuggestedFocus` + `focusPanel.tsx` + `Focus` union (Phase 6), fixed `normRange` windows as the value scale (RUPM units replace them; `normRange` may survive for display tinting only).

**Survives:** all of L1–L4 canonical math, `roster/depth.ts` machinery (starter assignment, replacement, swap enumeration, position gaps), `playingTimeFactor`, league forecast + RUPM + engagement, the matchup-vacuum principle, `analyzeSwapStrategy` (adapts to leverage-state roles), pitcher-side status quo (below).

## Scope decisions (proposed)

1. **Batter side first, pitcher side follows** — same sequencing as forward-focus v2. The pitcher tab keeps `getPitcherSeasonRating` until then.
2. **Aging adjustment deferred.** Two-season Bayesian regression stays; a Marcel-style age term is a cheap follow-up but mid-season marginal. Recorded so it isn't forgotten.
3. **Resource-reallocation punting (punt-SV-frees-slots) stays out of scope** — this design keeps the door open exactly as the migration doc requires (concede is per-cat state; the optimizer just sees weight 0).
4. **Stat-shape correlation across the FA pool** remains the documented future-work item in roster-strategy.md; leverage weighting does not model it.

## Implementation phases (one branch, per project convention)

- **A — substrate:** xBA blend + xSLG→HR/TB in the talent layer; delete bonus functions. Run `/api/admin/test-batter-rating` + `/api/admin/test-pitcher-eval` (the talent-path change is wide-blast: it moves lineup/streaming ratings too — capture before/after diffs and re-anchor the expected ranges).
- **B — value engine:** `league/rosterValue.ts` (L6): distance + weights (pivotality, concede state), per-player value from `projectBatterNeutral` × role share, replacement-relative in RUPM units.
- **C — wire the page:** tables, depth chart, swap optimizer, panel conversion to In-play/Conceded; delete Phase-6 legacy (Focus union, `useSuggestedFocus`, `focusPanel.tsx`).
- **D — docs:** rewrite affected sections of roster-strategy.md + unified-rating-model.md, update engines.md registry, history.md entries (this file's Why section becomes the record), close out pivotality-migration.md.

## Resolved product decisions (owner, 2026-07)

1. **Score display: 0–100 index, not move-units.** "0.34 moves" invites a threshold reading ("is 1.0 the trigger?") that doesn't exist for players — trigger semantics belong to swaps only, and the Suggested Moves list is the trigger surface. Move-units stay internal; suggestion cards speak standings ("pushes K 4th → 3rd").
2. **All-flat fallback: go unweighted, never blank.** If every cat's weight is ~0 — computed (everything cushioned or conceded) or user-forced (concede-everything overrides) — the page falls back to unweighted talent value above replacement, with a visible note. **Deferred follow-up** (owner: "it should always give the user something to chase"): for buried teams where auto-concede would clear the whole board, adaptively relax `REACHABLE_GAP_MOVES` (2 → 3 → 4 moves) until at least one cat is chaseable, instead of conceding everything.
3. **Auto-concede reachability bar stays** as specced (no rank-1/2 within `REACHABLE_GAP_MOVES`). Owner regards computed reachability as the page's core value; tune the bar later if needed, never remove it.
