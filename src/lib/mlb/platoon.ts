/**
 * Per-category batter platoon model — Bayesian per-cat regression.
 *
 * For each scored category we regress the batter's OWN observed vs-hand
 * split (`his vs-hand rate / his overall rate`) toward a POPULATION
 * component target, weighted by his PA on that side. The result is a
 * multiplier on his hand-neutral (overall) per-cat rate. 1.0 = no tilt.
 *
 *   regressed = (paVsHand·observedRatio + prior·populationRatio)
 *             / (paVsHand + prior)
 *
 * WHY REGRESS (not raw splits): a hitter's raw vs-hand line is a tiny,
 * noisy sample — .190 in 58 PA is mostly luck. True individual platoon-
 * skill spread is small (~0.015 wOBA SD; FanGraphs/The Book), so a thin
 * sample should sit ~entirely on the population split, while a full career
 * of a persistent split earns its own number. The PA weighting does both.
 *
 * WHY PER-CATEGORY (not one OPS multiplier): the platoon split does NOT
 * distribute uniformly across stats. It is concentrated in K (and BB) —
 * large, year-to-year sticky splits — while BABIP/AVG carry a small
 * population effect and HR/FB is ~flat (the HR-rate gap is contact-shape:
 * more grounders same-handed, not a HR-skill split). Per-cat `PRIOR`
 * reflects this: K/BB regress faster (trust the player sooner), AVG/power
 * lean population longer.
 *
 * SWITCH HITTERS are not a special case. Their population target is ~1.0
 * (they always turn to the platoon-advantage side, so no same-hand
 * penalty), and their observed vs-hand split — which IS their separate
 * left-/right-stance talent and is fully predictable from the SP's hand —
 * regresses against that 1.0. A switch hitter with a real, persistent weak
 * side shows it through his own data, exactly as expected.
 *
 * Population-target sourcing per category:
 *   - K (21):  HARD. League K% by matchup (RotoGrinders / FanGraphs split
 *              tables): LHB 26.9% vs LHP / 22.4% vs RHP; RHB 21.8% / 23.1%.
 *              Converted to ratio-vs-overall with a standard PA mix.
 *   - AVG (3), H (8): HARD. League AVG by matchup (FanGraphs 2014): LHB
 *              .240/.254 (L/R), RHB .260/.247. H/PA tracks AVG.
 *   - HR (12): DAMPED. Raw single-season HR-rate gap implies ~0.78 same-
 *              hand for LHB, but HR/FB platoon is ~flat in aggregate (the
 *              gap is contact-shape/GB%); damped to ~0.87 (LHB) / ~0.98.
 *   - BB (18): ESTIMATED. Real & sticky like K (walk less same-handed),
 *              magnitude set below K, larger for LHB.
 *   - TB (23): ESTIMATED. AVG effect plus a power component.
 *   - R (7), RBI (13): ESTIMATED. wOBA-level tilt, damped.
 *   - SB (16): none. Steal rate isn't platoon-driven; the SB cat's own RHP
 *              "easier to run" bump lives in batterForecast.ts.
 *
 * Estimated rows are deliberately conservative. The per-cat PRIOR values
 * are anchored to The Book's ~1000-PA OPS-split baseline, shaded by the
 * K/BB-sticky vs power-noisy finding — refine when clean per-cat split
 * stabilization numbers are sourced. See docs/history.md "2026-05 —
 * Per-category platoon (Bayesian)".
 */

import type { BatterSeasonStats } from './types';

type Hand = 'L' | 'R';

/** Population vs-hand/overall ratio target, indexed [bats][facingHand].
 *  Switch hitters use 1.0 (no same-hand penalty); the lookup is bypassed
 *  for them in `platoonFactor`. */
interface ComponentRow {
  L: { L: number; R: number }; // LHB facing LHP / RHP
  R: { L: number; R: number }; // RHB facing LHP / RHP
}

const PLATOON_COMPONENT: Record<number, ComponentRow> = {
  // statId: { L: {L,R}, R: {L,R} }      same-hand is L→L and R→R
  21: { L: { L: 1.143, R: 0.952 }, R: { L: 0.958, R: 1.015 } }, // K  (better=lower; same-hand → more K)
  3:  { L: { L: 0.958, R: 1.014 }, R: { L: 1.038, R: 0.986 } }, // AVG
  8:  { L: { L: 0.958, R: 1.014 }, R: { L: 1.038, R: 0.986 } }, // H (tracks AVG)
  23: { L: { L: 0.930, R: 1.020 }, R: { L: 1.045, R: 0.978 } }, // TB (AVG + power)
  12: { L: { L: 0.870, R: 1.050 }, R: { L: 1.050, R: 0.980 } }, // HR (damped contact-shape)
  18: { L: { L: 0.900, R: 1.040 }, R: { L: 1.030, R: 0.950 } }, // BB (estimated)
  7:  { L: { L: 0.960, R: 1.015 }, R: { L: 1.030, R: 0.980 } }, // R (estimated, wOBA-level)
  13: { L: { L: 0.960, R: 1.015 }, R: { L: 1.030, R: 0.980 } }, // RBI (estimated, wOBA-level)
};

/** Per-cat regression prior (PA of population weight). K/BB sticky →
 *  smaller prior (trust the player's own split sooner); AVG slow; power
 *  slowest. Anchored to The Book's ~1000-PA OPS-split baseline. */
const PLATOON_PRIOR: Record<number, number> = {
  21: 450, 18: 450,            // K, BB — sticky/fast
  3: 1000, 8: 1000,            // AVG, H
  7: 1000, 13: 1000,           // R, RBI
  23: 1300, 12: 1500,          // TB, HR — power, noisy/slow
};
const DEFAULT_PRIOR = 1000;

/** Observed per-cat split for the hand being faced. */
export interface ObservedSplit {
  /** Batter's own vs-hand rate / overall rate for this category. */
  ratio: number | null;
  /** Batter's PA on this side (the regression weight). */
  pa: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Per-category platoon multiplier on the batter's overall rate. Regresses
 * the observed split toward the population target by sample. Returns 1.0
 * for unknown hands, switch-PITCHERS (facingHand null), unknown batter
 * hand, and categories with no platoon profile (e.g. SB). With no observed
 * data it falls back to the pure population target.
 */
export function platoonFactor(
  statId: number,
  bats: 'L' | 'R' | 'S' | null | undefined,
  facingHand: Hand | null,
  observed: ObservedSplit | null,
): number {
  if (!facingHand || bats == null) return 1.0;
  const row = PLATOON_COMPONENT[statId];
  // Switch hitters have no population same-hand penalty → target 1.0, and
  // their observed split (their off-/main-stance talent) regresses to it.
  const popRatio = bats === 'S' ? 1.0 : row ? row[bats][facingHand] : 1.0;
  if (!row && bats !== 'S') return 1.0; // cat has no platoon profile (e.g. SB)

  let regressed = popRatio;
  if (observed && observed.ratio != null && observed.pa > 0) {
    // Clamp the observed ratio so a freak small-sample split can't produce
    // an absurd pre-regression value.
    const obsRatio = clamp(observed.ratio, 0.55, 1.6);
    const prior = PLATOON_PRIOR[statId] ?? DEFAULT_PRIOR;
    regressed = (observed.pa * obsRatio + prior * popRatio) / (observed.pa + prior);
  }
  // Final safety band — no single matchup adjustment exceeds ±20%.
  return clamp(regressed, 0.8, 1.2);
}

/**
 * Representative overall-offense platoon tilt for display only (the
 * "Platoon" summary row). wOBA-level magnitude — between the small AVG
 * effect and the large K effect — so the headline number matches a user's
 * "is this a good/bad platoon spot" intuition while the per-category rows
 * carry the real, stat-specific detail. Returns null when no tilt applies
 * (switch / unknown hand / unknown SP).
 */
export function platoonSummaryFactor(
  bats: 'L' | 'R' | 'S' | null | undefined,
  facingHand: Hand | null,
): number | null {
  if (!facingHand || (bats !== 'L' && bats !== 'R')) return null;
  // wOBA-level same/opposite tilt; LHB carry the wider spread.
  const TABLE: ComponentRow = {
    L: { L: 0.955, R: 1.020 },
    R: { L: 1.030, R: 0.975 },
  };
  return TABLE[bats][facingHand];
}

/** Resolve the hand the batter is facing from the SP's throwing hand.
 *  Null for switch-pitchers / unknown. Small shared helper so the forecast
 *  and rating layers resolve it identically. */
export function facingHandFrom(throws: 'L' | 'R' | 'S' | null | undefined): Hand | null {
  return throws === 'L' || throws === 'R' ? throws : null;
}

/** Convenience for callers holding a `BatterSeasonStats`. */
export function batsOf(stats: BatterSeasonStats | null): 'L' | 'R' | 'S' | null {
  return stats?.bats ?? null;
}
