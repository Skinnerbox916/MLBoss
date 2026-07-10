# Points roster page — alignment + engine carry-over proposal

**Status: proposal, not implemented.** Written 2026-07 after the roster-value rebuild, answering two owner questions: (a) how to align the bare-bones points `/roster` view with the rebuilt categories page, (b) whether the rebuild improves the points offering and whether points needs its own engine. On acceptance this folds into a points detail doc + history.md; if rejected, move the findings to history.md.

---

## Findings first

**Points already has its engine, and it's in better shape than suspected.** The full pipeline exists and is registered in [engines.md](./engines.md#points-league-engines): `batterPointsRateVector` / `pitcherPointsRateVector` (per-event rates) → `pointsValue` (rate × weekly volume) → `replacementByPosition` + VOR → `recommendSwaps` → `analyzePointsTeam` behind `/api/points/team`. No new engine is warranted.

**No missing stats for the live league.** The points league weights 17 stats; every one is covered (`unknown_stat_ids: []` from `/api/admin/test-points-profile`). The worry about 2B/3B is already handled — the vector *decomposes* regressed H/TB/HR into 1B/2B/3B (league-anchored triples), and the pitching side covers Outs/K/H/BB/HBP/ER per IP plus a quality-and-depth-aware W model and an observed-pace SV model. The real gaps are **approximations**, not absences:

| Approximation | Cost in this league | Fix |
|---|---|---|
| Triples pinned to league avg (0.0045/PA) | 3B = 7.8 pts — speed archetypes mispriced by a few pts/wk | carry-over B3 below |
| Batter HBP pinned to league avg | 2.6 pts × small variance — plunk magnets under-credited slightly | optional, same pattern as B3 |
| W has no team run-support context | documented v1 caveat | out of scope (needs team W-L context) |
| SV = observed pace, gated ≥3 saves | emerging closers lag until saves accrue | out of scope (needs save-opportunity data) |

**The page, not the engine, is where the gap is.** `PointsRosterView` renders a moves panel and a rostered-only value table. The API response already carries FA rows (`owned: false`), replacement levels, and a lineup solve that the page never shows.

## (b) What the roster-value rebuild carries over

- **B1 — Role share on volume.** `batterPointsValue` assumes `paPerGame × 6` for everyone — the same everyday-volume assumption the categories side just corrected. Apply `playingTimeFactor` ([roster/playingTime.ts](../src/lib/roster/playingTime.ts)) to weekly volume in the points team analysis (players AND the FA pool feeding replacement/VOR), exactly as the forecast route does. Fixes part-timer inflation in VOR and suggested moves.
- **B2 — Already landed invisibly.** The Phase-A substrate change (xBA/xSLG 60/40 blend, TB on the talent path) flows into points automatically: the hit decomposition consumes `blendedBaselineForCategory` H/TB/HR. One home, every consumer — nothing to do.
- **B3 — Per-player 2B/3B rates.** MLB season stats already include doubles/triples; they're just not mapped onto `BatterSeasonStats`. Plumb the two fields through `getRosterSeasonStats`, add stat_ids 10/11 to `CATEGORY_BASELINE_CONFIG` (raw Bayesian path — same regression discipline as every other counting cat), and have `decomposeHits` prefer real regressed 2B/3B rates over the league-anchor solve (which stays as the fallback for thin data). Canonical home: `categoryBaselines`, so a hypothetical categories league scoring 2B/3B works too.
- **B4 — League points forecast (the L6 analog).** Points collapses the league forecast to one number per team: project every roster's **lineup-capped weekly points** (existing `optimizePointsLineup` + points values — the same starting-lineup-cap reasoning as the categories forecast) and rank. The RUPM analog is scalar: **points-per-move** = avg top-K FA VOR. Output: "your roster projects 4th of 10 at 612 pts/wk; 3rd is 9 pts/wk away ≈ 1 move." Computed in a route following the categories forecast's caching pattern (league-scoped bundle + viewer-roster fingerprint).
- **What does NOT carry over: leverage.** Pivotality/concede has no points meaning — one objective, no categories to weight or concede. The strategy question points can answer is "how far from the top, in moves" (B4), not "which cats to fight for." Display units stay **native points** (pts/wk, VOR) — unlike move-units, they're directly meaningful, so no 0-100 index is needed.

## (a) Page alignment

Mirror the categories page's structure, panel for panel, with the design-system components already in use (Panel/Tabs/Badge/Skeleton/typography, Data Tables pattern — see [ui-patterns.md](./ui-patterns.md)). No new bespoke chrome.

| Categories page | Points page (proposed) | Source |
|---|---|---|
| Roster Focus panel (leverage tiles) | **League Standing card** — projected pts/wk rank strip, gap-in-moves up/down, hold state when clear of the field | B4 |
| Positional Depth | Same table (Pos / Slots / Eligible / Status / Starters / Best backup), starters from `optimizePointsLineup`, values = weekly points | exists + B1 |
| Suggested Moves (cards: net value, fills-gap/upgrade badges, per-cat delta strip) | Same card grammar; net gain in pts/wk; delta strip = top scored-event deltas (e.g. `HR +2.1 · SB +0.8` pts/wk); **pure adds** when the roster has open slots | `recommendSwaps` + shared open-slot logic |
| Your Batters (stats columns + Score index) | Your Batters/Pitchers: PA/GP context + pts/PA, pts/wk, this-wk, VOR | exists |
| Upgrade Targets (top-30 FA board) | Same board ranked by VOR — the rows already ride in `analyzePointsTeam` (`owned: false`); ownership floor + IL-stash bypass copied from the categories rules | exists (UI only) |

**Shared-code extractions (the anti-bolt-on list).** Three pieces get extracted rather than duplicated:
1. `openSlotCount` (Yahoo cap check + placement gate) moves from `RosterManager` into `src/lib/roster/openSlots.ts`; both pages consume it.
2. The Suggested-Moves card chrome (reason badges + delta strip shell) extracts from `RosterManager` into a shared component; categories passes move-unit deltas, points passes pts/wk deltas.
3. The Positional-Depth table extracts as a presentational component fed by either page's position values.

Everything else reuses existing primitives; nothing new enters `components/ui/`.

## Phases (one branch)

- **A — engine carry-overs:** B1 role share (+ smoke via `/api/admin/test-points-rating` before/after), B3 doubles/triples plumbing + baselines entries, B4 league points forecast route.
- **B — page rebuild:** the five-panel structure above + the three shared extractions.
- **C — docs:** points detail doc (the engines.md points section notes "no separate detail doc yet" — this creates it), engines.md registry, history.md entry, fold this proposal.

## Open questions for the owner

1. **League Standing card cost:** B4 fans out over every roster in the league like the categories forecast (cached 1h, same pattern). Fine to add that load to the points page?
2. **Batter HBP per player** (B3-style, ~2.6 pts × rare event): include while the pipeline is open, or skip as noise?
3. **Pitcher positional depth:** the categories page's depth chart is batters-only (pitcher optimizer is documented follow-up work). Match that scope on points (batters-only depth, pitchers stay table-only), or is pitcher depth worth prioritizing here since points pitching is fully modeled?
