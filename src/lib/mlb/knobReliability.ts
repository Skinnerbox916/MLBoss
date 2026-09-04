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
 * Everything sits at 1.0 today because introducing the mechanism must not
 * move a single forecast — the values that belong here are fitted, and each
 * one lands as its own reviewable change with its own MODEL_VERSION bump.
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
  // pitcher: fitted 0.36–0.77 across the seven stats — the worst-scaled knob
  //          on the board and the one that applies to every batter every day.
  // park:    fitted 0.34–0.77, but the home/away split (0.17–0.57 home vs
  //          0.40–1.00 away) says part of that is the talent baseline already
  //          containing the player's home park. A reliability here would be
  //          papering over a double-count; neutralise the baseline instead.
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
