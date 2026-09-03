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
 * reflects how fast a category's own split earns trust; power is slowest.
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
 * are anchored to The Book's ~1000-PA OPS-split baseline. See
 * docs/history.md "2026-05 — Per-category platoon (Bayesian)".
 *
 * TWO STEPS SIT BETWEEN THE SOURCED TABLE AND THE APPLIED MULTIPLIER
 * (2026-09, from 37k graded retro batter-days — see
 * docs/forecast-verification.md#the-platoon-knob):
 *
 *   1. MIX NORMALISATION. Each row is a set of vs-hand ratios against the
 *      batter's OWN overall rate, so over a league-typical schedule it must
 *      average to 1.0 or the row smuggles in a level bias on every batter of
 *      that hand. Most sourced rows already do to within 0.7%; the RHB walk
 *      row was 2.7% low, which under-forecast walks for ~70% of the league.
 *      Normalising is not a tuning knob — it makes the row a pure tilt.
 *   2. TILT SCALE. The retro cohort delivers a measured fraction of each
 *      row's claimed tilt. See PLATOON_TILT_SCALE.
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

/**
 * Share of each row's sourced tilt that the retro cohort actually delivers,
 * measured on 37,167 graded batter-days over the 2026 season with plate
 * appearances controlled and identified off the batter-hand × pitcher-hand
 * interaction only. 1.0 = apply the sourced split as written.
 *
 * Values are deliberately shaded toward 1.0 from the point estimates, which
 * were K 0.42–0.55, BB 1.25–1.40, and 0.65–0.83 across TB/H/HR/R/RBI. Every
 * one of those is below (above, for BB) 1.0 in both halves of the season and
 * under two independent estimators, which is what earns the change; the
 * magnitudes are one season, which is why they are not taken at face value.
 * Rationale and the full evidence:
 * docs/forecast-verification.md#the-platoon-knob
 */
const PLATOON_TILT_SCALE: Record<number, number> = {
  21: 0.60,                    // K — the sourced LHB split is ~2x too wide at game level
  18: 1.25,                    // BB — the only row the cohort says is too timid
  3: 0.80, 8: 0.80,            // AVG, H
  7: 0.80, 13: 0.80,           // R, RBI
  23: 0.80, 12: 0.80,          // TB, HR
};

/** League share of plate appearances taken against LHP — the mix each row is
 *  normalised over. Measured on the 2026 Statcast corpus (29.5%). */
const LEAGUE_LHP_PA_SHARE = 0.295;

/** Per-cat regression prior (PA of population weight), anchored to The Book's
 *  ~1000-PA OPS-split baseline. K and BB used to sit at 450 on the grounds
 *  that their splits are stickier and so earn the player's own number sooner;
 *  the retro cohort put that deviation-from-population term at 0.31±0.21 (K)
 *  and 0.08±0.22 (BB) where 1.0 would mean fully justified, so the special
 *  case is gone and they regress at the default. Power is still slower. */
const PLATOON_PRIOR: Record<number, number> = {
  21: 1000, 18: 1000,          // K, BB
  3: 1000, 8: 1000,            // AVG, H
  7: 1000, 13: 1000,           // R, RBI
  23: 1300, 12: 1500,          // TB, HR — power, noisy/slow
};
const DEFAULT_PRIOR = 1000;

/**
 * Turn one sourced {vsL, vsR} pair into the multiplier actually applied:
 * re-centre it so a league-typical schedule averages to 1.0 (a pure tilt, no
 * level bias), then scale the remaining tilt by `scale`.
 */
function centredTilt(side: { L: number; R: number }, facingHand: Hand, scale: number): number {
  const centre =
    LEAGUE_LHP_PA_SHARE * Math.log(side.L) + (1 - LEAGUE_LHP_PA_SHARE) * Math.log(side.R);
  return Math.exp((Math.log(side[facingHand]) - centre) * scale);
}

/** The population vs-hand target for one category. Switch hitters never reach
 *  here (their target is 1.0); a category with no row returns neutral. */
function populationTarget(statId: number, bats: 'L' | 'R', facingHand: Hand): number {
  const row = PLATOON_COMPONENT[statId];
  return row ? centredTilt(row[bats], facingHand, PLATOON_TILT_SCALE[statId] ?? 1.0) : 1.0;
}

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
  const popRatio = bats === 'S' ? 1.0 : row ? populationTarget(statId, bats, facingHand) : 1.0;
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
  // wOBA-level same/opposite tilt; LHB carry the wider spread. Centred and
  // scaled the same way the per-cat rows are — it stands in for the
  // batted-ball/run family, so it takes that family's tilt scale and the
  // headline never claims more than the categories underneath it apply.
  const TABLE: ComponentRow = {
    L: { L: 0.955, R: 1.020 },
    R: { L: 1.030, R: 0.975 },
  };
  return centredTilt(TABLE[bats], facingHand, PLATOON_TILT_SCALE[23]);
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
