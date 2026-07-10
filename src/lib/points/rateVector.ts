/**
 * Per-event rate vectors for points-league scoring.
 *
 * A points league scores each stat independently (HR = 10.4 pts, K = 3 pts,
 * etc.), so the unit of value is a player's *expected count of each event*,
 * not a category win/loss. This module produces the per-PA (batter) and
 * per-IP (pitcher) rate of every scorable event, which `pointsValue.ts`
 * dot-products against the league's `ScoringProfile.weights`.
 *
 * It is the points-mode analog of `src/lib/mlb/categoryBaselines.ts` +
 * `src/lib/roster/scoring.ts` (categories). Like those, it is talent-neutral
 * (no this-game park / opp SP) — matchup-adjusted points come later via the
 * forecast layer. The shared talent substrate is reused unchanged:
 *   - Batters: `blendedBaselineForCategory` (Bayesian-regressed per-PA rates).
 *   - Pitchers: `PitcherTalent` + its helpers (`talentHitsPerPA`, etc.).
 *
 * The one genuinely new piece is **hit-type decomposition**: the categories
 * engine never needed singles / doubles / triples separately (it scores AVG /
 * H / TB), but points weights each differently. We solve 1B/2B/3B from the
 * already-regressed H/PA and TB/PA rates plus a league-anchored triples rate —
 * reproducing H, TB, and HR exactly without a new regression (rebuilding the
 * regression is explicitly out of scope; see docs/unified-rating-model.md).
 */

import type { BatterSeasonStats } from '@/lib/mlb/types';
import type { PitcherTalent } from '@/lib/pitching/talent';
import { blendedBaselineForCategory } from '@/lib/mlb/categoryBaselines';
import { talentHitsPerPA, talentExpectedEra, LEAGUE_IP_PER_START } from '@/lib/pitching/talent';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------------------
// League constants for events the talent substrate doesn't expose directly
// ---------------------------------------------------------------------------

/** League-average triples per PA (~0.4% of PA). Triples are rare and mostly
 *  park/speed driven; pinning them to league average shifts only a sliver
 *  between 1B and 2B in the decomposition (doubles are determined by TB−H,
 *  which come from real regressed data). 2024-26 MLB ≈ 0.0045. */
const LEAGUE_3B_PER_PA = 0.0045;

/** League-average HBP per PA. BatterSeasonStats doesn't carry HBP and the
 *  talent model intentionally ignores it (<1% of PA). Default to league mean;
 *  at 2.6 pts it's a ~0.023 pts/PA constant across players. 2024-26 ≈ 0.009. */
const LEAGUE_HBP_PER_PA = 0.009;

/** League-average pitcher HBP per PA (hit batters). ~0.009. */
const LEAGUE_PITCHER_HBP_PER_PA = 0.009;

// Batter stat_ids we can produce a per-PA rate for.
const STAT_R = 7, STAT_H = 8, STAT_1B = 9, STAT_2B = 10, STAT_3B = 11;
const STAT_HR = 12, STAT_RBI = 13, STAT_SB = 16, STAT_BB = 18, STAT_HBP = 20;
const STAT_BK = 21, STAT_TB = 23;

// Pitcher stat_ids. (W and SV are contextual outcomes scored in the forecast
// layer, not per-IP rates, so they don't appear in this vector.)
const STAT_OUT = 33, STAT_HA = 34, STAT_ER = 37;
const STAT_PBB = 39, STAT_PHBP = 41, STAT_PK = 42;

// ---------------------------------------------------------------------------
// Batter rate vector
// ---------------------------------------------------------------------------

export interface BatterRateVector {
  /** stat_id → expected per-PA rate. Covers every batter event a points
   *  league might weight (1B/2B/3B/HR/R/RBI/SB/BB/HBP) plus H/TB/K for
   *  custom leagues that score those directly. */
  perPA: Record<number, number>;
}

function rate(stats: BatterSeasonStats, statId: number): number {
  const b = blendedBaselineForCategory(stats, statId);
  return b ? Math.max(0, b.rate) : 0;
}

/**
 * Decompose regressed H/PA, TB/PA, HR/PA into 1B/2B/3B/HR per-PA rates.
 *
 * Two equations (per PA), pinning triples to league average:
 *   nonHR_H  = 1B + 2B + 3B
 *   nonHR_TB = 1B + 2·2B + 3·3B
 * ⇒ 2B = nonHR_TB − nonHR_H − 2·3B ;  1B = nonHR_H − 2B − 3B
 * Clamps keep noisy inputs from producing negative rates.
 * Exported for `matchupAdjust.ts`, which re-decomposes from matchup-adjusted
 * H/TB/HR so hit types inherit park/SP/platoon through the aggregates.
 */
export function decomposeHits(hPerPA: number, tbPerPA: number, hrPerPA: number) {
  const nonHrH = Math.max(0, hPerPA - hrPerPA);
  const nonHrTb = Math.max(0, tbPerPA - 4 * hrPerPA);
  const triples = Math.min(LEAGUE_3B_PER_PA, nonHrH);
  let doubles = nonHrTb - nonHrH - 2 * triples;
  doubles = Math.max(0, Math.min(doubles, nonHrH - triples));
  const singles = Math.max(0, nonHrH - doubles - triples);
  return { singles, doubles, triples };
}

/**
 * Talent-neutral per-PA rate vector for a batter. Reuses the same
 * Bayesian-regressed per-PA baselines as the categories engine.
 *
 * Hit types: when the player's line carries real doubles/triples counts
 * (plumbed 2026-07), 2B and 3B come from their own Bayesian-regressed
 * per-PA baselines (stat_ids 10/11 in `categoryBaselines`) and singles
 * are what's left of the regressed H rate. The TB-based `decomposeHits`
 * solve remains the fallback for stale cached lines / synthetic inputs
 * where the counts are absent (baseline getters return null → the blend
 * would be pure league prior, which is *worse* than the TB solve that
 * uses the player's real regressed TB).
 *
 * HBP: player-specific regressed rate when counts exist (persistent
 * plate-crowding trait, 2.6 pts each in Yahoo default); league-mean
 * fallback otherwise.
 */
export function batterPointsRateVector(stats: BatterSeasonStats): BatterRateVector {
  const hPerPA = rate(stats, STAT_H);
  const tbPerPA = rate(stats, STAT_TB);
  const hrPerPA = rate(stats, STAT_HR);

  const hasHitTypes =
    typeof stats.doubles === 'number' || typeof stats.priorSeason?.doubles === 'number';
  let singles: number, doubles: number, triples: number;
  if (hasHitTypes) {
    doubles = rate(stats, STAT_2B);
    triples = rate(stats, STAT_3B);
    // Keep the split consistent with the regressed H/HR aggregates: XBH
    // can't exceed non-HR hits; singles absorb the remainder.
    const nonHrH = Math.max(0, hPerPA - hrPerPA);
    triples = Math.min(triples, nonHrH);
    doubles = Math.min(doubles, Math.max(0, nonHrH - triples));
    singles = Math.max(0, nonHrH - doubles - triples);
  } else {
    ({ singles, doubles, triples } = decomposeHits(hPerPA, tbPerPA, hrPerPA));
  }

  const hasHbp =
    typeof stats.hbp === 'number' || typeof stats.priorSeason?.hbp === 'number';
  const hbpPerPA = hasHbp ? rate(stats, STAT_HBP) : LEAGUE_HBP_PER_PA;

  return {
    perPA: {
      [STAT_1B]: singles,
      [STAT_2B]: doubles,
      [STAT_3B]: triples,
      [STAT_HR]: hrPerPA,
      [STAT_R]: rate(stats, STAT_R),
      [STAT_RBI]: rate(stats, STAT_RBI),
      [STAT_SB]: rate(stats, STAT_SB),
      [STAT_BB]: rate(stats, STAT_BB),
      [STAT_HBP]: hbpPerPA,
      // Aggregates — only consumed if a custom league weights them directly.
      [STAT_H]: hPerPA,
      [STAT_TB]: tbPerPA,
      [STAT_BK]: rate(stats, STAT_BK),
    },
  };
}

// ---------------------------------------------------------------------------
// Pitcher rate vector
// ---------------------------------------------------------------------------

export interface PitcherRateVector {
  /** stat_id → expected per-IP rate (Outs, K, ER, H-allowed, BB, HBP). */
  perIP: Record<number, number>;
  /** Expected wins per start (starters only; 0 for relievers). Crude v1
   *  league-baseline P(W) — refine later. */
  wPerStart: number;
  /** Expected saves per appearance (closers only; 0 otherwise). v1 uses a
   *  season-saves closer signal — see `pitcherPointsRateVector`. */
  svPerAppearance: number;
}

/** League-baseline P(Win) for a league-average starter in a given start.
 *  ~0.36-0.40 across MLB (team wins ~50%, SP credited on ~75-80% when he goes
 *  5+). Quality (run prevention) and depth scale around this. */
const BASE_P_WIN_PER_START = 0.38;

/** League-average starter ERA anchor (matches the `xwobaToXera` anchor in
 *  pitching/talent.ts: league xwOBA-allowed → 4.20). Used to scale P(Win) by
 *  run prevention. */
const LEAGUE_ERA = 4.20;

/** P(Win) sensitivity to run prevention, per ERA run below league. A 2.8-ERA
 *  ace → +0.07; a 5.5-ERA arm → −0.065. Estimated (no team-context W model);
 *  the spread is intentionally modest — wins are noisy and team-dominated. */
const W_QUALITY_SLOPE = 0.05;
/** P(Win) sensitivity to depth, per IP/start above league (5.4). Going deeper
 *  → more likely to qualify for / hold a win. Estimated. */
const W_DEPTH_SLOPE = 0.035;
const W_QUALITY_CLAMP: [number, number] = [-0.10, 0.12];
const W_DEPTH_CLAMP: [number, number] = [-0.04, 0.05];
const W_FLOOR = 0.22;
const W_CEIL = 0.55;

/** Cap on observed saves-per-appearance. Elite closers convert ~0.45-0.55 of
 *  their outings into saves; the cap guards against small-sample spikes. */
const SV_PER_APPEARANCE_CAP = 0.6;

export interface PitcherRateOptions {
  /** Observed season saves — drives the closer signal + save pace.
   *  ≥ SAVE_CLOSER_THRESHOLD season saves ⇒ treat as a closer. */
  seasonSaves?: number;
  /** Observed season appearances (G) — denominator for save pace. */
  seasonGames?: number;
  /**
   * Authoritative role override. `PitcherTalent.role` is unreliable when the
   * talent vector was built without overall (SP+RP) season lines — e.g. via
   * `getPitcherTalentBatch`, which computes a correct `metadata.role`
   * separately and leaves `talent.role` defaulted to 'inactive'. Callers with
   * a better role signal pass it here (see `getPointsPitcherInputs`). Mirrors
   * how `neutralWeek.ts` keys off the batch's `metadata.role`, not
   * `talent.role`.
   */
  role?: 'starter' | 'reliever' | 'inactive';
}

/** Season saves at which we treat a reliever as holding a closer role.
 *  Low bar so committee/emerging closers aren't missed; non-closers sit at 0
 *  and contribute no save points (honest under-count, flagged in v1). */
const SAVE_CLOSER_THRESHOLD = 3;

/**
 * Convert a `PitcherTalent` vector into per-IP event rates plus per-start W
 * and per-appearance SV. Reuses the talent helpers (`talentHitsPerPA`,
 * `talentExpectedEra`) so the points engine and the categories engine agree
 * on the underlying pitcher skill.
 *
 * PA/IP is derived from the talent's own on-base profile: an inning is 3
 * outs, and outs/PA = 1 − (H + BB + HBP)/PA, so PA/IP = 3 / outsPerPA.
 */
export function pitcherPointsRateVector(
  talent: PitcherTalent,
  opts: PitcherRateOptions = {},
): PitcherRateVector {
  const hPerPA = talentHitsPerPA(talent);
  const bbPerPA = Math.max(0, talent.bbPerPA);
  const kPerPA = Math.max(0, talent.kPerPA);
  const hbpPerPA = LEAGUE_PITCHER_HBP_PER_PA;

  // Outs per PA = 1 − reach-base rate. Clamp away from 0 so PA/IP stays finite
  // for degenerate inputs.
  const outsPerPA = Math.max(0.45, 1 - hPerPA - bbPerPA - hbpPerPA);
  const paPerIP = 3 / outsPerPA;

  const eraPerIP = talentExpectedEra(talent) / 9; // ER per IP

  const perIP: Record<number, number> = {
    [STAT_OUT]: 3, // definitional
    [STAT_PK]: kPerPA * paPerIP,
    [STAT_HA]: hPerPA * paPerIP,
    [STAT_PBB]: bbPerPA * paPerIP,
    [STAT_PHBP]: hbpPerPA * paPerIP,
    [STAT_ER]: eraPerIP,
  };

  const role = opts.role ?? talent.role;
  const isStarter = role === 'starter';
  const isReliever = role === 'reliever';

  // W: quality- and depth-aware per-start win probability. Run prevention
  // (expectedERA vs league) and depth (ipPerStart) are the largest
  // pitcher-controllable drivers of wins. Team run support is NOT modeled
  // (no team W-L here) — an honest, documented limitation.
  let wPerStart = 0;
  if (isStarter) {
    const era = talentExpectedEra(talent);
    const qualityAdj = clamp((LEAGUE_ERA - era) * W_QUALITY_SLOPE, W_QUALITY_CLAMP[0], W_QUALITY_CLAMP[1]);
    const depthAdj = clamp((talent.ipPerStart - LEAGUE_IP_PER_START) * W_DEPTH_SLOPE, W_DEPTH_CLAMP[0], W_DEPTH_CLAMP[1]);
    wPerStart = clamp(BASE_P_WIN_PER_START + qualityAdj + depthAdj, W_FLOOR, W_CEIL);
  }

  // SV: observed conversion pace (saves / appearances), gated to relievers
  // with a real save sample. Differentiates a closer (≈0.4-0.5 sv/app) from a
  // setup man (≈0). Emerging closers with few season saves under-credit until
  // saves accrue — refine with save-opportunity data later.
  let svPerAppearance = 0;
  const seasonSaves = opts.seasonSaves ?? 0;
  if (isReliever && seasonSaves >= SAVE_CLOSER_THRESHOLD) {
    const games = Math.max(1, opts.seasonGames ?? 0);
    svPerAppearance = clamp(seasonSaves / games, 0, SV_PER_APPEARANCE_CAP);
  }

  return { perIP, wPerStart, svPerAppearance };
}

export const POINTS_RATE_CONSTANTS = {
  LEAGUE_3B_PER_PA,
  LEAGUE_HBP_PER_PA,
  LEAGUE_PITCHER_HBP_PER_PA,
  BASE_P_WIN_PER_START,
  W_QUALITY_SLOPE,
  W_DEPTH_SLOPE,
  SV_PER_APPEARANCE_CAP,
  SAVE_CLOSER_THRESHOLD,
} as const;
