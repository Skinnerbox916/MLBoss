## League Baselines

Cross-engine constants. League-mean rates and prior strengths that are used by multiple engines and whose values need to agree across the codebase. If you tune one of these, expect the ratings on every page to shift.

Constants here are *wide-blast*: changing them rebalances most ratings. See [architecture.md](./architecture.md#rules-for-adding-a-new-calibration-constant) for the calibration discipline.

> Values live in source code; this doc owns rationale only. To read the current value, open the file.

## League rate priors (batter talent)

Anchors the batter talent regression in [talentModel.ts](../src/lib/mlb/talentModel.ts). When a batter has thin sample, these are what the regression pulls toward.

| Constant | File | Anchor |
|---|---|---|
| `LEAGUE_K_RATE` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | MLB-wide K-per-PA. Refresh from MLB Stats API (current season) or FanGraphs. Same value drives both batter and pitcher regressions (zero-sum). Last refreshed 2026 mid-season — see [history.md](./history.md#2026-05--league-rate-calibration-refresh). |
| `LEAGUE_BB_RATE` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | MLB-wide BB-per-PA. Last refreshed 2026-07 season-to-date; the earlier May value caught the annual early-season walk spike — source this one from a late-enough aggregate to wash April out (see [history.md](./history.md#2026-07--ledger-driven-calibration-fixes-k-denominator-pa-starter-share-bb-anchor)). |
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
| `LEAGUE_XWOBACON_PITCHER` | [talentModel.ts](../src/lib/mlb/talentModel.ts) | League-average xwOBA-allowed on contact. Same value as the batter side. (Note: pitcher-side K-per-PA and BB-per-PA share the single `LEAGUE_K_RATE` / `LEAGUE_BB_RATE` definition in `talentModel.ts` — there is no separate pitcher-side copy.) |
| `LEAGUE_HR_PER_CONTACT` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average HR per ball in play. ~3.5% MLB-wide. |
| `LEAGUE_HR_PER_CONTACT_PRIOR_BIP` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Regression strength for HR/contact. HR per BIP is the most volatile component; heavy prior. |
| `LEAGUE_IP_PER_START` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average IP per starter game. Drives expected workload in the forecast layer. |
| `LEAGUE_IP_PER_START_PRIOR_GS` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Regression strength for IP/start. Stabilizes quickly (~6 starts). |
| `LEAGUE_GB_RATE` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average ground-ball rate. Drives `gbBoost` HR-park gating in forecast layer. |
| `LEAGUE_GB_PRIOR_PA` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Regression strength for GB%. Stabilizes ~150 PA. |
| `PA_FULL_TRUST` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | Effective PA at which the talent regression places no weight on league prior. Drives the confidence band. |

## League rate priors (per-category)

Used by [batterForecast.ts](../src/lib/mlb/batterForecast.ts) for log5 calculations on batter stats that aren't in the talent vector directly. (Constants moved from `batterRating.ts` to `batterForecast.ts` in the 2026-05 L2/L3 split — see [history.md](./history.md#2026-05--batter-l2l3-split-buildbatterforecast-extracted).)

| Constant | File | Anchor |
|---|---|---|
| `LEAGUE_AVG` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | League-average batting average. Used for log5 of AVG against SP BAA AND the bullpen BAA blend. |
| `LEAGUE_K_PER_PA` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Same as the talent-side rate; used for log5 of batter K against the SP/RP-blended K%. |
| `LEAGUE_BB_PER_PA` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Used for log5 of batter BB against the SP/RP-blended BB%. |
| `LEAGUE_H_PER_PA` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Hits per PA. Used for log5 of H and TB against the SP/RP-blended hits/PA via `talentHitsPerPA`. |
| `LEAGUE_HR_PER_PA` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | HR per PA. Used for `PITCHER_SWING_HR`-bounded multiplicative ratio (HR is contact-quality, not a clean log5 stat). |

The pitcher-side and batter-side league means agree by construction. MLB is zero-sum: every PA is one batter outcome and one pitcher outcome. If a future change tunes one side, the other side must move in lockstep.

## League team-level anchors

Used by [pitching/talent.ts](../src/lib/pitching/talent.ts) and [pitching/forecast.ts](../src/lib/pitching/forecast.ts) for game-context multipliers (opposing offense quality, bullpen).

| Constant | File | Anchor |
|---|---|---|
| `LEAGUE_OPS` | [pitching/talent.ts](../src/lib/pitching/talent.ts) | League-average team OPS. Anchor for the opposing-offense factor in forecast layer (a team with .750 OPS vs .710 league mean inflates BB and contact-xwOBA). |
| `LEAGUE_SB_ALLOWED_PER_IP_FALLBACK` | [mlb/leagueRates.ts](../src/lib/mlb/leagueRates.ts) | Fallback league SB-allowed per team-IP rate used when the team staff-splits fetch fails or returns empty. The runtime value is **derived from the same call as the per-team data** (sum SBs / sum IPs across all returned splits) by `fetchTeamStaffSplits` in [schedule.ts](../src/lib/mlb/schedule.ts) and stored via `setLeagueSbAllowedPerIp`; `buildBatterForecast` reads via `getLeagueSbAllowedPerIp`. The constant only fires when there's no live data. Anchor: ~0.075 (2024-2025 MLB). |

## SP/RP blend (batter forecast)

Calibration for the SP/RP blend in [batterForecast.ts](../src/lib/mlb/batterForecast.ts). See [unified-rating-model.md](./unified-rating-model.md#sprp-blend) for the design rationale.

| Constant | File | Anchor |
|---|---|---|
| `SP_SHARE_CLAMP` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Floor / ceiling on the SP IP share of the batter's PAs. `[0.30, 0.85]` anchors to opener-style appearances (low) and rare complete-game starts (high). The midpoint matches league-average SP IP/start ≈ 5.4 → spShare ≈ 0.60. |
| `RP_FULL_TRUST_IP` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Team RP innings at which the bullpen aggregate is fully trusted. `100` ≈ ~1 month of team bullpen play; below this, `rpConfidence` shrinks linearly toward 0 and the blend pulls back to SP-only. K%/BB% are well-stabilized at the implied PA counts (~430 PAs at 100 IP). |
| `SB_SWING` | [batterForecast.ts](../src/lib/mlb/batterForecast.ts) | Clamp on the team-aggregate SB-allowed multiplier on the batter's SB rate. `[0.80, 1.25]` absorbs the team-level signal without overweighting it; runner skill and base-state dominate SB variance, so the team contribution is real but bounded. |

## Recommendation-layer thresholds

These aren't league baselines but they ARE cross-engine — every advice surface that picks chase / hold / punt uses them. Live in [matchup/analysis.ts](../src/lib/matchup/analysis.ts) as the single source. See [recommendation-system.md](./recommendation-system.md) for the full context.

| Constant | File | Anchor |
|---|---|---|
| `LOCKED_THRESHOLD` | [matchup/analysis.ts](../src/lib/matchup/analysis.ts) | `\|margin\|` ≥ this → `suggestedFocus = punt` (locked win OR out-of-reach loss). Direction-aware: both extremes deserve 0× weight. |
| `RATE_SCALE` | [matchup/analysis.ts](../src/lib/matchup/analysis.ts) | Per-stat typical-swing scale (AVG 0.040, ERA 0.50, etc.). Margin = `gap × dir / scale × confidence`. |
| `CORRECTED_COUNTING_SCALE` | [matchup/analysis.ts](../src/lib/matchup/analysis.ts) | Fixed residual-uncertainty scale for counting cats when `mode='corrected'`. Keyed by `stat_id` because batter K (21) and pitcher K (42) share a display label. |

## Updating these

Annual offseason refresh from FanGraphs / Statcast leaderboards, OR mid-season when an SP/RP-blend-style architecture change reveals that a stale anchor is no longer cancelling against the data path. When you do an update:

1. Source the value. The cleanest path is direct from MLB Stats API for the current season — `/api/v1/teams/stats?stats=season&group=pitching&sportId=1&season={year}` returns all 30 teams' aggregate lines; sum across them for the league mean. FanGraphs / Statcast work too. Note the source and date in the commit message.
2. Update **every location** the constant appears. The five log5 anchors in `batterForecast.ts`, the matching `leagueMean` values in `categoryBaselines.ts`, and the pitcher-side `LEAGUE_K_RATE` / `LEAGUE_BB_RATE` / `LEAGUE_XBA` in `talentModel.ts` MUST stay in sync — MLB is zero-sum.
3. Run the pitcher smoke harness at `src/app/api/admin/test-pitcher-eval/route.ts` — it asserts that canonical archetypes (Skubal, Houser, Montero, Roupp) land in their expected score/tier bands.
4. Run the batter smoke harness at `src/app/api/admin/test-batter-rating/route.ts` — same role; the expected score ranges there are calibration anchors.
5. Spot-check on the today page by opening a few rated players and confirming the rating moved the way you expected.
6. Add a [history.md](./history.md) entry — rebalancing every rating in the system is the kind of change a later LLM would want to know the reason for.

Touching one of these without the smoke check is the fastest way to ship a regression that takes weeks to notice.
