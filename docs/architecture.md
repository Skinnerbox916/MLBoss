## Architecture

This doc is the constitution: principles, anti-patterns, and rules for adding new code. It does not describe specific engines — for that, see [engines.md](./engines.md) for the registry or the per-engine reference docs it points to. Read this once when you join the project; consult it when you're about to add a new engine, a new doc, or a new calibration constant.

## Principles

Six rules that the system is built around. Every engine in this codebase either embodies one or defends one.

### 1. Two layers, one bridge

"How good is this player in this matchup?" (rating) and "which categories should I fight for this week?" (recommendation) are different questions that need different math. They connect through exactly one channel: `focusMap`. Rating engines *read* `focusMap` and use it to weight their per-category sub-scores. Recommendation engines *write* `focusMap` and never re-implement rating math.

A "great" batter rating doesn't tell the user whether they need more runs. A "chase HR" recommendation doesn't tell them which outfielder to play. Mixing the layers — Boss Brief picking categories with its own rule when the focus bar above it disagreed — is the bug we keep finding and the bug we keep eliminating.

### 2. Single source of truth per concept

Each idea has exactly one canonical home. The same concept implemented in two places will drift; drift in this system is silent and produces the same player getting different verdicts on different pages.

What this looks like in practice:

- `analyzeMatchup` is the only category-picker.
- `getBatterRating` / `getPitcherRating` are the only per-game scorers.
- `xwobaToXera` lives in one file. Three inlined copies with different slopes caused [Max Meyer to be `ace` in one card and `bad` in another](./history.md).
- `isLikelySamePlayer` is the only FA→probable name matcher. Three name matchers with last-name-only logic [attached one probable to both Lopezes](./history.md).
- League-mean constants (`LEAGUE_K_RATE`, etc.) live in [league-baselines.md](./league-baselines.md).

Adding a parameter to a canonical function is fine. Adding a `_v2` "just for this page" is not. If you find yourself wanting to inline the math at a call site, push the customization into the canonical function instead.

### 3. One per-game primitive, summed over windows

Multi-day, multi-start, and end-of-week projections are *aggregations*, not new math. `projectBatterTeam` calls `getBatterRating` per player per day and sums; it does not introduce a different rating formula. `projectPitcherTeam` calls `getPitcherRating` per start and sums; same.

If the projection disagrees with the per-game score, the per-game score is what we trust. The right fix is to extend the per-game engine, not to patch the projection.

### 4. Per-category adjustments before composite

Park, weather, and opponent quality act on different categories differently. Coors suppresses K (parkSO 90) and inflates HR (parkHR 107). A composite-level park multiplier flattens those distinctions and double-counts: K and BB get a park hit at the per-PA layer AND at the composite layer, while ERA only gets the composite hit.

The rule: matchup-wide signals that scale every category proportionally (platoon, opportunity / PA count) multiply the composite. Everything else lives at the per-PA / per-cat layer where it can shape each stat independently. See [unified-rating-model.md](./unified-rating-model.md) for the full breakdown.

### 5. Bayesian talent with prior shrinkage

Player skill is a regression toward population norms with a prior-season cap. The cap is modulated by a regime-shift probe that detects when current-season leading indicators (K%, BB%, whiff%, barrel%, velo) move *together* away from prior — evidence of a real talent change rather than sample noise.

Short-term form is **not** a multiplier. `getFormTrend`'s "Raking" / "Producing" labels are display-only; folding them into the rating would re-introduce the noise we're regressing out. The same is true for any "last-5-games hot streak" signal — sustained shifts get absorbed by the regression at the talent layer.

### 6. Calibration is anchored, not vibes-tuned

Every constant in the math layer has a public-research anchor (Tango / FanGraphs / Statcast). Touching one means updating the citation, not just the number. The corollary: the value lives in source code; the rationale lives in the engine's doc. The doc never claims to know the current value — it only knows why the value is what it is.

Constants you may touch: see the engine doc for each layer. Wide-blast constants (league means, prior strengths) live in [league-baselines.md](./league-baselines.md).

## Anti-patterns

These keep coming back. If you see them in a PR, flag them.

### Parallel category pickers

A function that picks "which categories to chase" using anything other than `analyzeMatchup`. The classic version was Boss Brief's hardcoded "if winning ≥2 batter cats AND losing HR/SB/R/RBI then chase" rule, which produced "Chase SB" while the focus bar above showed SB as `neutral`. If `analyzeMatchup` doesn't expose what you need, extend it; don't fork it.

### Mixing stat levels

Comparing a level-1 raw HR count against a level-3 regressed HR rate produces nonsense. Reading `current.xwoba` when you mean talent xwOBA (which lives at `line.talent.xwoba`) confuses sample noise for talent. See [stat-levels.md](./stat-levels.md).

### Double counting at the composite layer

Multiplying the composite by park / weather / opp when those signals are already in the per-PA rates. Pre-2026-05 the pitcher side did this; K and BB took a park hit twice. See [unified-rating-model.md](./unified-rating-model.md).

### Display labels folded into the rating

`runValuePer100`, `getFormTrend`, `getOpposingStaffPill`, raw whiff%/chase%/barrel%/hard-hit% — these surface signals to the user. They do NOT feed the math layer because the predictive content is already in the talent vector. Folding them in adds noise; surfacing them in the breakdown UI lets the user reconcile a "raking" box score with a steady rating.

### "Just for this page" variants

A new function in a different file that does the same Bayesian blend with subtly different defaults. A `_v2` introduced because the existing one didn't quite fit one consumer. Inlined math at the call site. All of these are the same anti-pattern with different costumes.

## Rules for adding a new engine

1. **Place it in a layer first.** If you can't say which of L1–L7 it belongs to (see [engines.md](./engines.md)), the engine isn't well-scoped. Refine before writing code.
2. **Read from canonical functions.** Don't re-implement rating math, don't re-implement category picking, don't re-implement talent regression.
3. **No new math at L4 (Projection).** Projection aggregates L3 outputs over windows. If you need different math, extend L1–L3 so the per-game number changes too.
4. **Register in `engines.md` in the right layer.** Add the row before opening the PR.
5. **Anchor calibration to research.** Every new constant in the math layer needs a citation in the engine's doc.

## Rules for adding a new doc

1. **One concept, one home.** If the new doc would describe something already covered elsewhere, edit the existing doc instead.
2. **Index entries are one line.** If [engines.md](./engines.md) grows multi-paragraph entries, the registry is degenerating into a reference doc — split out a per-engine doc instead.
3. **History is separate from reference.** "We used to do X, we stopped because Y" goes in [history.md](./history.md), not inline in the reference doc.
4. **Register in [README.md](./README.md).** The table of contents is what an LLM loads first; an unregistered doc is invisible to that workflow.

## Rules for adding a new calibration constant

1. **Source is the value.** The constant lives in the `.ts` file. The doc never duplicates the value.
2. **One-line comment pointing to the doc.** Example: `// xwOBA → xERA slope; see docs/unified-rating-model.md#calibration-anchors`. The comment doesn't restate the rationale — that's the doc's job, and a comment that restates it will drift.
3. **Doc table lists file path + anchor, not value.** Format: `Constant | File | Anchor` (the research citation or empirical observation).
4. **Smoke test if it's wide-blast.** Constants that touch many engines (league means, prior strengths) need a smoke harness or test that asserts the resulting ratings stay within expected bands. Currently lives at `src/app/api/admin/test-pitcher-eval/route.ts` for pitcher constants.

## Rules for retiring a pattern

When you delete a canonical engine, deprecate a constant, or remove a documented pattern, **add an entry to [history.md](./history.md)**: date, what changed, why we stopped. The bar for an entry: an LLM later might propose to re-introduce this pattern, and without context for why we stopped, they'd be right to try.

Minor edits don't qualify. Renaming a variable doesn't qualify. Rebuilds, deletions of canonical functions, retired patterns, and architecture shifts qualify.

## Deliberately not engines

These surface signals to the user but do **not** feed the math layer. Recording them here so they don't get accidentally folded into rating math by a well-meaning future change.

| Helper | File | Why display-only |
|---|---|---|
| `getFormTrend` (Raking / Producing / Scuffling labels) | [src/lib/mlb/analysis.ts](../src/lib/mlb/analysis.ts) | Short-term OPS streaks (<50 PA) are statistically non-predictive. The Bayesian regression already absorbs sustained shifts. The label exists for user reconciliation — when the box score says "raking" but the rating is 38, the label tells the user *why*. |
| `getOpposingStaffPill` (Weak / Elite staff) | [src/lib/mlb/analysis.ts](../src/lib/mlb/analysis.ts) | Overall-staff verdict at-a-glance. The R/RBI signal that `staffEra` once supplied is now folded into the batter forecast via the SP/RP blend (see [unified-rating-model.md](./unified-rating-model.md#sprp-blend)); the pitcher P(W) bullpen multiplier reads real RP ERA from `staffSplits`. `staffEra` is still populated on the game object specifically so this pill keeps working — overall staff is the right signal for the at-a-glance read, not the SP-only or RP-only line. |
| `runValuePer100` on `ProbablePitcher` | [src/lib/mlb/types.ts](../src/lib/mlb/types.ts) | Leading indicator only; predictive content is already in `kPerPA` and `hrPerContact`. Read by the talent-layer confidence-agreement check, not folded into rating math. |
| Whiff / chase / barrel / hard-hit % on `PitcherTalent` | [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) | Leading indicators, plumbed through for breakdown-UI transparency. |
| Velocity multiplier (`Rating.velocity.multiplier`) | [src/lib/pitching/forecast.ts](../src/lib/pitching/forecast.ts) | Moved from composite to talent-layer regime probe (2026-05). The field is pinned at 1.0 and informational only — would double-count if multiplied again. |

If a future change wants to fold one of these into the rating, the burden of proof is on that change: show the calibration study, show the predictive lift over the existing talent vector, update [unified-rating-model.md](./unified-rating-model.md), and remove the entry from this table.
