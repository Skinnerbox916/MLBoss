# Points roster page — rebuild proposal

**Status: proposal, build-ready (owner questions resolved 2026-07).** On acceptance this folds into a points detail doc + history.md; if rejected, move the findings to history.md.

## The page's job (owner, verbatim intent)

> "The user comes to this page to see who out there could provide more points than who they have, but can fit within the roster position slot picture that they have."

That is **positionally-honest upgrade shopping over a ROS horizon** — a comparison between the FA pool and the current roster, constrained by slot fit. Not league standing (that's `/league`), not weekly streaming volume (that's `/streaming`, due for its own overhaul — the "projected weekly points vs the field" concept is redirected there, where streaming-heavy usage makes it meaningful). The page needs no strategy header at all: unlike categories there is no per-cat weighting decision to make, so nothing earns the Focus panel's slot.

## Findings (unchanged from the assessment)

Points already has its engine — `rateVector` → `pointsValue` → replacement/VOR → `analyzePointsTeam` — registered in [engines.md](./engines.md#points-league-engines); all 17 stats the live league scores are covered (`unknown_stat_ids: []`), with 2B/3B decomposed from regressed H/TB/HR and full pitching event rates + W/SV models. No new engine warranted. The gaps are: (1) the **moves engine is position-naive** (`recommendSwaps` matches batter-vs-batter by value only — it cannot answer the "fits the slot picture" half of the page's job), (2) **volume ignores role share** (everyday-PA assumption, the flaw the categories side fixed), (3) two documented rate approximations (league-anchored 3B and HBP), and (4) the page renders a fraction of what the API already returns (FA rows, replacement levels, the lineup solve).

## The design

Three sections, in the grammar the categories page established (reused UX where the decision is the same; nothing bolted on):

1. **Positional Depth** — the "slot picture" the owner's job statement constrains on. The categories `DepthChart` presentation (Pos / Slots / Eligible / Target steppers / Status / Starters / Best backup), fed by `computeRosterValue` over points-scored players. This panel is *why* the moves below say "fills gap."
2. **Suggested Moves — the hero.** Batter moves route through the categories position-aware engine (`generateSwapSuggestions` in [roster/depth.ts](../src/lib/roster/depth.ts)): it is score-agnostic (takes `ScoredPlayer.score`), so feeding it role-share-adjusted weekly points gives multi-position shuffle awareness, gap weighting, drop resistance, and **pure adds** against open slots (shared `openSlotCount`) for free — no second implementation. Net value renders in **pts/wk** (native, meaningful units — no 0-100 index needed here), with the categories card grammar: reason badge (fills gap / upgrade), plus a per-event delta strip in pts/wk (`HR +2.1 · SB +0.8`) decomposed from the rate vectors × league weights. Pitcher moves stay on `recommendSwaps` (see scope).
3. **Your Batters ↔ Upgrade Targets** — the comparison tables, side by side like categories. Roster table: pts/G, pts/wk, this-wk, VOR + PA/GP context. FA board: top-30 by VOR with the categories ownership floor + IL-stash bypass; the rows already ride in `analyzePointsTeam` (`owned: false`) — this is UI plus passing `player_key`/eligible positions through `PointsPlayerRow`.

**Shared extractions (the anti-bolt-on list):** `openSlotCount` moves from `RosterManager` to `src/lib/roster/openSlots.ts`; the moves-card chrome and the depth-table presentation extract into shared components consumed by both pages. Everything else is existing `components/ui/` primitives the points view already uses.

## Engine carry-overs

- **Role share on volume** — `playingTimeFactor` applied to weekly PA in the points analysis (roster + FA pool feeding replacement/VOR), mirroring the forecast route. Fixes part-timer inflation in every number on the page.
- **Per-player 2B/3B rates** — plumb doubles/triples from the MLB season stats onto `BatterSeasonStats`, add stat_ids 10/11 to `CATEGORY_BASELINE_CONFIG` (raw Bayesian path), and have `decomposeHits` prefer real regressed rates (league-anchor solve stays as thin-data fallback). At 5.2/7.8 pts in the live league, speed archetypes are currently mispriced by up to a few pts/wk.
- **Per-player HBP — include, as a rider.** Standalone it would be noise-adjacent; the reason to include it is that the pipeline is already open. Juice: HBP rate is one of the most *persistent* batter traits (plate-crowding is stable year to year), and the archetype spread is real — league mean ≈ 0.009/PA vs plunk-magnet ≈ 0.03/PA, worth ~1.3 pts/wk at 2.6 pts/HBP, ~15 pts over a ROS horizon — right at the moves engine's meaningful-gain threshold for exactly the OBP-grinder archetype points leagues reward. Squeeze: one more field through the same stats plumbing and one more baselines entry in the same diff. Same fallback discipline (league anchor when thin).
- **Substrate already landed** — the xBA/xSLG blend flows into points rates via `blendedBaselineForCategory`; nothing to do.
- **Explicitly NOT carried:** leverage/pivotality/concede (single objective, nothing to weight) and the league points forecast (owner: standing belongs on `/league`; weekly-points-vs-field belongs in the streaming overhaul).

## Scope

**Batters only**, matching the categories page's current state. Pitcher tables keep today's presentation and `recommendSwaps`; pitcher depth/moves for BOTH scoring modes are deliberately deferred to one joint effort (owner decision — avoid the two pages diverging on pitchers).

## Phases (one branch)

- **A — engine:** role share on points volume; 2B/3B/HBP fields → `BatterSeasonStats` → baselines entries → decomposition upgrade. Smoke: `/api/admin/test-points-rating` before/after diff (rates shift is the point; document magnitudes).
- **B — page:** three-section rebuild; `player_key`/positions through `PointsPlayerRow`; the three shared extractions; wire batter moves through `generateSwapSuggestions`.
- **C — docs:** create the points detail doc (engines.md notes one doesn't exist), registry + history entries, fold this proposal.

## Resolved owner decisions (2026-07)

1. **No League Standing / strategy card on this page** — streaming volume dominates weekly points for good teams, so the number belongs on the streaming page (its overhaul) and standing on `/league`.
2. **HBP: in, as a rider on the 2B/3B plumbing** (persistence + ROS horizon analysis above).
3. **Pitchers: hold** — joint categories+points pitcher effort later to prevent divergence.
