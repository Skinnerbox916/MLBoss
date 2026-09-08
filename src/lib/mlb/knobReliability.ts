/**
 * How much of a modifier's raw swing actually survives to the matchup the
 * engine applies it to.
 *
 * THE PROBLEM THIS EXISTS FOR. Every L2 modifier takes an effect size from
 * somewhere — a published platoon split, a three-year park factor, a
 * pitcher's rate line — and applies it at full strength. Those are estimates
 * with error bars, and they are measured on a different population from the
 * one they get used on: league-wide totals over full seasons, versus one
 * batter in a posted lineup facing tonight's starter. Anything estimated and
 * then used as a multiplier has to be shrunk toward 1.0 in proportion to how
 * much of it transfers, exactly the way a thin-sample batting average is
 * shrunk toward the league mean before anyone trusts it.
 *
 * The engine regressed player talent rigorously (`leaguePriorN`, fitted per
 * category) and regressed its own modifiers not at all. Over 37,167 graded
 * retro batter-days the bill came to 25 of 28 knob coefficients below 1.00,
 * with the opposing-pitcher and park knobs 7-for-7 — a systematic
 * over-confidence, not a handful of unrelated bugs. See
 * docs/forecast-verification.md#per-knob-calibration-fit-2026-09-full-season-retro-cohort.
 *
 * WHY IT IS SHARED. Left to itself each knob grows its own bespoke scaling
 * table inside its own file, and the same idea ends up implemented three
 * times in three places, drifting apart. One home, one shape, one place to
 * look — and `scripts/retro-knob-fit.ts` reports coefficients in exactly this
 * shape, so a fitted number can be pasted in without translation.
 *
 * THE FORM IS `m ** r`, NOT `1 + r·(m − 1)`. The fit regresses on
 * `log(knob)`, so its coefficient IS the exponent. Using the same form means
 * setting a reliability to the fitted coefficient and re-running the fit
 * reads back 1.00. That closes the loop: the diagnostic's output is the
 * engine's input.
 */

/** Every knob the batter forecast can apply. Mirrors `BatterModifierKnobs`. */
export type KnobName =
  | 'pitcher' | 'park' | 'weather' | 'order' | 'platoon' | 'hand' | 'teamSb';

/**
 * Reliability per knob, optionally per stat_id. `'*'` is the knob's default.
 * 1.0 = apply the raw multiplier as computed.
 *
 * The mechanism landed with everything at 1.0 (behaviour-neutral by design);
 * the fitted values below arrived 2026-09-08 as their own MODEL_VERSION bump,
 * once the cohort had been regenerated on the park-neutralised baseline so the
 * fit was reading the engine as shipped rather than the pre-fix build. Re-fit
 * with `npx tsx scripts/retro-knob-fit.ts retro-batter-day` after any change
 * to a knob's own model; a correctly-set table reads back ~1.00.
 *
 * `platoon` is 1.0 and is expected to stay there. Its calibration lives one
 * level down, inside `platoon.ts`, because its multiplier is a blend of two
 * sources with genuinely different reliabilities — a population table the
 * cohort delivers at 0.6–1.25 depending on the stat, and the batter's own
 * observed split, which fits at ~0.1–0.3 and would be wrongly rescued by a
 * knob-level factor applied to the blended result. A knob whose inputs differ
 * in reliability has to be calibrated per input; one that resolves to a
 * single computed multiplier belongs here.
 */
const KNOB_RELIABILITY: Partial<Record<KnobName, Partial<Record<number | '*', number>>>> = {
  // Fitted 2026-09-08 on the regenerated full-season cohort (37,386 graded
  // batter-days, rate basis, park-neutralised baseline, fitted priors) —
  // docs/forecast-verification.md#per-knob-calibration-fit. Each value is
  // the Poisson coefficient on log(knob), so `m ** r` makes the next fit
  // read 1.00. AVG (3) has no graded count; it rides the H log5 and takes
  // H's value. Knobs the fit could not identify (weather, hand; SE > 0.8)
  // and knobs that read ~1.00 (order 0.90 / 0.96) stay at 1.0.
  pitcher: {
    3: 0.36, 8: 0.36,   // AVG, H   (±0.11)
    23: 0.51,           // TB       (±0.10)
    12: 0.76,           // HR       (±0.15)
    7: 0.41, 13: 0.42,  // R, RBI   (±0.08)
    21: 0.77,           // K        (±0.04)
    18: 0.64,           // BB       (±0.06)
  },
  // Park, post-neutralisation: the home/away split that flagged the
  // double-count has closed (R 1.10/0.62 → pooled 0.71, RBI 0.96/0.61 →
  // 0.66, HR 0.38/0.48, K 0.46/0.51); what is left is uniform
  // over-application, which is what this table is for.
  park: {
    3: 0.36, 8: 0.36,   // AVG, H   (±0.13)
    23: 0.60,           // TB       (±0.11)
    12: 0.48,           // HR       (±0.11)
    7: 0.71, 13: 0.66,  // R, RBI   (±0.19)
    21: 0.52,           // K        (±0.09)
    18: 0.39,           // BB       (±0.15)
  },
  // Team SB-allowed: about half the applied swing is delivered (±0.11). The
  // flat RHP hand bump is not identified by the fit (SE 0.87) and stays raw.
  teamSb: { 16: 0.53 },
};

/**
 * The multiplier to actually apply. `raw` is what the knob's own model
 * computed; the return value is what multiplies the baseline AND what gets
 * recorded in the ledger, so a correctly-set reliability makes the per-knob
 * fit read 1.00 rather than leaving the recorded value a fiction.
 */
export function reliableKnob(knob: KnobName, statId: number, raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return raw;
  const perKnob = KNOB_RELIABILITY[knob];
  const r = perKnob?.[statId] ?? perKnob?.['*'] ?? 1;
  return r === 1 ? raw : raw ** r;
}

/**
 * Apply reliability across a whole knob set and fold it into one multiplier.
 * `expected = baseline × applyKnobs(...)` is the ONLY way the batter forecast
 * builds a matchup-adjusted rate, which is what keeps the recorded knobs and
 * the applied value from ever disagreeing.
 */
export function applyKnobs<K extends Partial<Record<KnobName, number>>>(
  statId: number,
  raw: K,
): { knobs: K; product: number } {
  const knobs = {} as K;
  let product = 1;
  for (const [name, value] of Object.entries(raw) as [KnobName, number | undefined][]) {
    if (value == null || !Number.isFinite(value)) continue;
    const applied = reliableKnob(name, statId, value);
    (knobs as Record<string, number>)[name] = applied;
    product *= applied;
  }
  return { knobs, product };
}
