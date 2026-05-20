## League Baselines

Cross-engine constants. League-mean rates and prior strengths that are used by multiple engines and whose values need to agree across the codebase. If you tune one of these, expect the ratings on every page to shift.

Constants here are *wide-blast*: changing them rebalances most ratings. See [architecture.md](./architecture.md#rules-for-adding-a-new-calibration-constant) for the calibration discipline.

> Values live in source code; this doc owns rationale only. To read the current value, open the file.

## League rate priors (batter talent)

Anchors the batter talent regression in [talentModel.ts](../src/lib/mlb/talentModel.ts). When a batter has thin sample, these are what the regression pulls toward.

| Constant | File | Anchor |
|---|---|---|
| `LEAGUE_K_RATE` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | 2024 MLB-wide K%. Updated each offseason from FanGraphs leaderboards. |
| `LEAGUE_BB_RATE` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | 2024 MLB-wide BB%. |
| `LEAGUE_XWOBACON` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | League-average xwOBA on contact (batter). The component blended toward population for thin BIP samples. |
| `LEAGUE_HARD_HIT` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | League-average Hard-Hit % (EV ≥ 95 mph). |
| `LEAGUE_XWOBA` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | End-result composite clamp. Anchors the assembled component-blended xwOBA back to a sane range. |
| `K_PRIOR_PA` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | Regression strength for K rate. Higher = pulls harder toward `LEAGUE_K_RATE` at low sample. K% stabilizes fastest (Carleton), so the prior is light. |
| `BB_PRIOR_PA` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | Regression strength for BB rate. Slower-stabilizing than K, so heavier prior. |
| `XWOBACON_PRIOR_BIP` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | Regression strength for xwOBA on contact. Stabilizes ~80 BIP. |
| `PRIOR_HARD_HIT_BIP` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | HH% stabilizes ~50 BBE (Carleton). |
| `FULL_SAMPLE_PA` | [categoryBaselines.ts](../src/lib/mlb/categoryBaselines.ts) | PA at which a prior season is treated as fully reliable. Below this, prior weight in `blendRate` is shrunk by `priorN / FULL_SAMPLE_PA` so a 234-PA partial year doesn't get equal authority to a 600-PA full year. |

## League rate priors (pitcher talent)

Anchors the pitcher talent regression in [pitching/talent.ts](../src/lib/pitching/talent.ts).

| Constant | File | Anchor |
|---|---|---|
| `LEAGUE_K_RATE` (pitcher) | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Pitcher-side K-per-PA league mean. Same value as the batter side by construction (matchups are zero-sum). |
| `LEAGUE_BB_RATE` (pitcher) | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Pitcher-side BB-per-PA league mean. |
| `LEAGUE_XWOBACON_PITCHER` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average xwOBA-allowed on contact. Same value as the batter side. |
| `LEAGUE_HR_PER_CONTACT` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average HR per ball in play. ~3.5% MLB-wide. |
| `LEAGUE_HR_PER_CONTACT_PRIOR_BIP` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Regression strength for HR/contact. HR per BIP is the most volatile component; heavy prior. |
| `LEAGUE_IP_PER_START` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average IP per starter game. Drives expected workload in the forecast layer. |
| `LEAGUE_IP_PER_START_PRIOR_GS` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Regression strength for IP/start. Stabilizes quickly (~6 starts). |
| `LEAGUE_GB_RATE` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average ground-ball rate. Drives `gbBoost` HR-park gating in forecast layer. |
| `LEAGUE_GB_PRIOR_PA` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Regression strength for GB%. Stabilizes ~150 PA. |
| `PA_FULL_TRUST` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Effective PA at which the talent regression places no weight on league prior. Drives the confidence band. |

## League rate priors (per-category)

Used by [batterRating.ts](../src/lib/mlb/batterRating.ts) for log5 calculations on batter stats that aren't in the talent vector directly.

| Constant | File | Anchor |
|---|---|---|
| `LEAGUE_AVG` | [batterRating.ts](../src/lib/mlb/batterRating.ts) | League-average batting average. Used for log5 of AVG against SP BAA. |
| `LEAGUE_K_PER_PA` | [batterRating.ts](../src/lib/mlb/batterRating.ts) | Same as the talent-side rate; used for log5 of batter K against SP K%. |
| `LEAGUE_BB_PER_PA` | [batterRating.ts](../src/lib/mlb/batterRating.ts) | Used for log5 of batter BB against SP BB%. |
| `LEAGUE_H_PER_PA` | [batterRating.ts](../src/lib/mlb/batterRating.ts) | Hits per PA. Used for log5 of H and TB against SP BAA-proxy via `talentHitsPerPA`. |
| `LEAGUE_HR_PER_PA` | [batterRating.ts](../src/lib/mlb/batterRating.ts) | HR per PA. Used for `PITCHER_SWING_HR`-bounded multiplicative ratio (HR is contact-quality, not a clean log5 stat). |

The pitcher-side and batter-side league means agree by construction. MLB is zero-sum: every PA is one batter outcome and one pitcher outcome. If a future change tunes one side, the other side must move in lockstep.

## League team-level anchors

Used by [pitching/talent.ts](../src/lib/pitching/talent.ts) and [pitching/forecast.ts](../src/lib/pitching/forecast.ts) for game-context multipliers (opposing offense quality, bullpen).

| Constant | File | Anchor |
|---|---|---|
| `LEAGUE_OPS` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average team OPS. Anchor for the opposing-offense factor in forecast layer (a team with .750 OPS vs .710 league mean inflates BB and contact-xwOBA). |

## Recommendation-layer thresholds

These aren't league baselines but they ARE cross-engine — every advice surface that picks chase / hold / punt uses them. Live in [matchup/analysis.ts](../src/lib/matchup/analysis.ts) as the single source. See [recommendation-system.md](./recommendation-system.md) for the full context.

| Constant | File | Anchor |
|---|---|---|
| `LOCKED_THRESHOLD` | [matchup/analysis.ts](../src/lib/matchup/analysis.ts) | `\|margin\|` ≥ this → `suggestedFocus = punt` (locked win OR out-of-reach loss). Direction-aware: both extremes deserve 0× weight. |
| `RATE_SCALE` | [matchup/analysis.ts](../src/lib/matchup/analysis.ts) | Per-stat typical-swing scale (AVG 0.040, ERA 0.50, etc.). Margin = `gap × dir / scale × confidence`. |
| `CORRECTED_COUNTING_SCALE` | [matchup/analysis.ts](../src/lib/matchup/analysis.ts) | Fixed residual-uncertainty scale for counting cats when `mode='corrected'`. Keyed by `stat_id` because batter K (21) and pitcher K (42) share a display label. |

## Updating these

Annual offseason refresh from FanGraphs / Statcast leaderboards. When you do an update:

1. Source the value from a public leaderboard (FanGraphs leaders → Standard or Advanced; Statcast Search). Note the season and URL in the commit message.
2. Run the pitcher smoke harness at `src/app/api/admin/test-pitcher-eval/route.ts` — it asserts that canonical archetypes (Skubal, Houser, Montero, Roupp) land in their expected score/tier bands.
3. Spot-check the batter side by opening a few rated players on the today page and confirming the rating moved the way you expected.
4. Add a [history.md](./history.md) entry for the update, since rebalancing every rating in the system is the kind of change a later LLM would want to know the reason for.

Touching one of these without the smoke check is the fastest way to ship a regression that takes weeks to notice.
