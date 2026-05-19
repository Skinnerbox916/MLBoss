## Stat Levels

A vocabulary doc. Every numeric field about a player in this codebase belongs to one of four levels. Mixing them is the most common source of subtly-wrong scoring code. Read this before adding a new stat field, before debugging a rating that "looks wrong" against the box score, or before deciding whether to read `current.x` vs `talent.x`.

## The four levels

| Level | What it is | Example fields | When to read it |
|---|---|---|---|
| **1. Raw counting** | What the player actually did this season | `current.hr`, `current.pa`, `current.avg` | Tables, season-to-date displays |
| **2. Raw rate** | A simple rate from raw counting | `current.hr / current.pa`, `current.runs / current.pa` | Per-PA comparisons that ignore sample size |
| **3. Regressed talent** | Rate Bayesian-blended toward league mean + prior season | `talent.xwoba`, `blendedRateForCategory` output | Roster decisions, multi-week projections |
| **4. Matchup-adjusted** | Talent rate after applying log5 + park + opponent quality + batting order + weather | `getBatterRating` output | Daily lineup decisions, single-game ratings |

Each level requires more inputs than the last. Each level smooths out more noise. Calibration knobs live at every level — see [league-baselines.md](./league-baselines.md) for the cross-engine ones, the per-engine doc for the local ones.

## The shape in code

The page-facing shape is `PlayerStatLine` in [src/lib/mlb/types.ts](../src/lib/mlb/types.ts). It groups levels 1 / 2 / 3 explicitly:

```typescript
interface PlayerStatLine {
  identity: { mlbId; bats };
  current:  PlayerSeasonCounting | null; // level 1+2: this season's counting + native rates
  prior:    PlayerSeasonCounting | null; // level 1+2: previous season
  talent:   PlayerTalent | null;         // level 3: regressed xwoba + components
  statcast: PlayerStatcastSnapshot | null; // level 1: raw current xwoba (for the Quality bonus only)
  splits:   PlayerPlatoonSplits | null;  // level 2/3: per-hand OPS (rescaled when thin)
}
```

Level 4 outputs are not a single field on `PlayerStatLine` — they are returned by per-call functions like `getBatterRating(stats, ctx)` that take the line plus a matchup context.

The talent block is computed in [src/lib/mlb/talentModel.ts](../src/lib/mlb/talentModel.ts) (batter) and [src/lib/pitching/talent.ts](../src/lib/pitching/talent.ts) (pitcher). The pitcher talent is its own vector type (`PitcherTalent`) for symmetry across the three-layer pitcher pipeline; see [unified-rating-model.md](./unified-rating-model.md).

## Where each level is the right read

- **L1 raw counting** — UI displays of "what happened." Example: the season-to-date stat row on the roster page. Never use L1 for cross-player comparison (sample sizes differ).
- **L2 raw rate** — quick fairness comparisons when you've already filtered to similar sample sizes. Example: the OPS column on the dashboard. Cross-player ranking from L2 over-rewards small samples.
- **L3 regressed talent** — roster decisions, multi-week projections, anything that asks "how good is this player going forward." Always use L3 (not L1 or L2) for cross-player comparability. This is the level the rating engines consume internally.
- **L4 matchup-adjusted** — daily start/sit, single-game pickup decisions. `getBatterRating` and `getPitcherRating` output L4. The score on the streaming board and the today page is L4.

## Common pitfalls

- **Reading `current.xwoba` to score talent.** `current.*` is raw counting — there is no `xwoba` on it. Talent xwOBA lives at `line.talent.xwoba` (level 3) and is the Bayesian-regressed value. The unregressed current-year Statcast snapshot (level 1) lives at `line.statcast.xwobaCurrent` and is for the Quality bonus only — never use it as a talent estimate.
- **Comparing across stat levels.** A level-1 raw HR count and a level-3 regressed HR rate are not comparable. Category-rank UIs always work at level 3 (regressed rates) for cross-player comparability.
- **Hardcoding stat IDs in display code.** Add the stat to `CATEGORY_BASELINE_CONFIG` in [categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts) so the regression pipeline picks it up automatically. UI maps that hardcode `statId -> field accessor` read from `PlayerStatLine.current` so they stay aligned with the data layer.
- **Independently nullable `current` and `prior`.** A freshly-called-up rookie has `current` only; an IL'd vet has `prior` only; a pre-debut promotion has neither. UI code that reads `line.current?.ops` should fall back to `line.prior?.ops` so IL'd players still render.
- **Tuning league means to fix one player.** League means (level 3 priors) are calibrated against a season's worth of data. If one player's rating looks wrong, the issue is almost always at the medium-blast level (sample-size gates, bonus weights), not the league mean. See [league-baselines.md](./league-baselines.md).
- **Treating the Quality bonus snapshot as talent.** `line.statcast.xwobaCurrent` is the unregressed current-year value, used only by the roster-page Quality bonus (see [unified-rating-model.md](./unified-rating-model.md)). It is not a talent estimate and must not be used for cross-player ranking.

## Internal-only adapter

The page-facing shape is `PlayerStatLine`, but the internal scoring engines still operate on the legacy flat `BatterSeasonStats`. A polymorphic `asBatterStats` shim inside `getBatterRating`, `roster/scoring.ts`'s blended scorers, and `categoryBaselines.ts` transparently adapts either input via `toBatterSeasonStats(line)`. The shim is invisible at the call site.

`toBatterSeasonStats` is internal-only — don't call it from app code. New code should always pass `PlayerStatLine`. See [history.md](./history.md#phase-4--playerstatline-page-facing-shape) for why the engines still consume the legacy shape internally.
