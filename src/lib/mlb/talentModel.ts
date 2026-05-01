/**
 * Component-based talent model for batters and pitchers.
 *
 * xwOBA is an outcome metric: it tells us what happened on every PA
 * after the fact. Most of xwOBA's variance comes from contact-quality
 * outcomes which take ~150 BIP (roughly half a season) to stabilise.
 * That's way too slow for season-long fantasy decisions in April —
 * we're making Week-2 calls on hitters whose xwOBA is still dominated
 * by one hot or cold week.
 *
 * This module decomposes xwOBA into three components that each have
 * their own stabilisation profile, regresses each one independently
 * toward league mean, and recomposes them into a single "talent"
 * xwOBA number. The big win: strikeout rate stabilises at ~60 PA and
 * walk rate at ~120 PA (much faster than xwOBA's ~150 BIP), so a
 * veteran whose plate discipline has cratered this April — legitimate
 * injury or aging signal — gets penalised even while his contact
 * quality still has prior-year weight. Conversely, a hot-start
 * surprise whose contact looks better but whose K% is unchanged
 * doesn't get crowned as "elite" on the strength of three weeks.
 *
 * The composite:
 *
 *   talent_xwoba = BB_rate × 0.69 + (1 − K_rate − BB_rate) × xwOBACON
 *
 * where each rate (K, BB, xwOBACON) is a Bayesian blend of
 * current-season + prior-season + league mean. Weights are standard
 * stabilisation points from Carleton / FanGraphs research.
 *
 * (HBP is ignored — under 1% of PA for a typical hitter, adding noise
 * without meaningful signal at the fantasy-decision grain.)
 */

import type { StatcastBatter, StatcastPitcher } from './types';

// ---------------------------------------------------------------------------
// Stabilisation priors and league means
//
// Priors: half-stabilisation points from sabermetric literature. Each is
// the sample size at which 50% of the weight lands on the player and
// 50% on the population mean — the classic Bayesian regression setup.
// ---------------------------------------------------------------------------

const LEAGUE_K_RATE = 0.223;          // 2024 MLB average
const LEAGUE_BB_RATE = 0.084;
const LEAGUE_XWOBACON = 0.368;        // batter xwOBA on contact
const LEAGUE_XWOBACON_PITCHER = 0.368; // pitcher-allowed xwOBA on contact
const LEAGUE_HARD_HIT = 0.40;         // MLB average Hard-Hit % (EV ≥ 95 mph)

const LEAGUE_XWOBA = 0.320;           // for the end-result composite clamp

const PRIOR_K_PA = 60;
const PRIOR_BB_PA = 120;
const PRIOR_XWOBACON_BIP = 50;
const PRIOR_HARD_HIT_BIP = 50;        // HH% stabilises ~50 BBE (Carleton)

// Empirical slope: moving from 30% → 50% HH% corresponds to roughly
// .320 → .416 xwOBACON across the MLB hitter distribution. We use this
// linear mapping to derive a *player-specific* regression target for
// xwOBACON instead of anchoring everyone to the league mean .368.
// The practical effect: hard-hit data pulls xwOBACON up for elite EV
// guys and down for degraded bat speed — both faster than waiting for
// outcome data (~150 BIP) to stabilise on its own.
const HARD_HIT_TO_XWOBACON_SLOPE = 0.48;

// Prior-season caps: how much a pitcher/batter's previous season is
// allowed to count toward the current talent estimate. Set around the
// stabilisation points so a full prior season counts roughly "once",
// not twice.
//
// The cap decays as the current-season sample grows: at 0 PA the prior
// is weighted fully (400 PA), by ~200 PA of current-season data the
// prior is capped at 250 PA so the current sample takes over. This
// prevents stale prior data from dominating in May/June while still
// anchoring April decisions. Same shape for BIP-based caps.
function priorSeasonPaCap(currentPa: number): number {
  return Math.max(250, 400 - 0.75 * currentPa);
}
function priorSeasonBipCap(currentBip: number): number {
  return Math.max(180, 300 - 0.75 * currentBip);
}

// ---------------------------------------------------------------------------
// Core Bayesian blend
//
// Three-way weighted average of (current, prior, league-mean) for a
// single rate stat. All three terms behave like a single Bayesian prior
// with population mean at `leagueMean` and `leaguePriorN` effective
// sample size — current and prior seasons get their actual sample size
// (with prior capped so a distant stale season doesn't dominate).
// ---------------------------------------------------------------------------

export interface BlendInput {
  current: number | null;
  currentN: number;
  prior: number | null;
  priorN: number;
  leagueMean: number;
  leaguePriorN: number;
  priorCap: number;
}

export interface BlendOutput {
  value: number;
  effectiveN: number; // total weight behind the estimate (current + capped prior)
}

/**
 * Three-way weighted average of (current, prior, league-mean) for a single
 * rate stat. Exported so category-pill code can reuse the same Bayesian
 * shape (HR/PA, SB/PA, etc.) the talent model uses for K%, BB%, xwOBACON.
 */
export function blendRate(input: BlendInput): BlendOutput {
  const curN = input.current !== null ? input.currentN : 0;
  const priN = input.prior !== null ? Math.min(input.priorN, input.priorCap) : 0;
  const lgN = input.leaguePriorN;

  let num = 0;
  let den = 0;
  if (curN > 0) { num += input.current! * curN; den += curN; }
  if (priN > 0) { num += input.prior! * priN;   den += priN; }
  if (lgN > 0)  { num += input.leagueMean * lgN; den += lgN; }

  return {
    value: den > 0 ? num / den : input.leagueMean,
    effectiveN: curN + priN,
  };
}

/**
 * Bayesian blend that returns `null` when there is literally no input —
 * no current, no prior, and no league anchor (`leaguePriorN === 0`).
 *
 * Used for Savant-derived secondaries (xERA, run-value-per-100, wOBA-on-
 * contact) where the consumer treats "no data at all" as a UI-suppressing
 * null rather than falling back to a synthetic league mean. When a league
 * anchor IS supplied (e.g. `runValuePer100` uses `leagueMean=0,
 * leaguePriorN=150`) the function behaves like `blendRate` and returns
 * the regressed value.
 *
 * This is the canonical successor to the legacy `blendSavant` helper —
 * see `docs/scoring-conventions.md` for the one-source-of-truth rule.
 */
export function blendRateOrNull(input: BlendInput): number | null {
  const hasCurrent = input.current !== null && input.currentN > 0;
  const hasPrior = input.prior !== null && input.priorN > 0;
  const hasLeague = input.leaguePriorN > 0;
  if (!hasCurrent && !hasPrior && !hasLeague) return null;
  return blendRate(input).value;
}

// ---------------------------------------------------------------------------
// Public API — single-shot talent computers
// ---------------------------------------------------------------------------

export interface TalentResult {
  /** Regressed "true talent" xwOBA. Null if we have literally no data
   *  for this player — callers should fall back to whatever prior they
   *  have (population mean, tier classifier, etc.). */
  xwoba: number | null;
  /** Component breakdown. Useful for debugging and for the future
   *  expandable-card UI the user mentioned but isn't shown right now. */
  components: {
    kRate: number;      // regressed
    bbRate: number;     // regressed
    xwobacon: number;   // regressed (against HH-anchored prior)
    hardHitRate: number; // regressed
    kN: number;         // current + capped-prior PA backing K estimate
    bbN: number;
    xwobaconN: number;  // current + capped-prior BIP backing xwOBACON
    hardHitN: number;   // current + capped-prior BIP backing HH%
  };
  /** Total effective PA across components — useful for confidence
   *  cues ("heavy regression" suffix, small-sample warnings). */
  effectivePA: number;
}

/**
 * Compute component-based talent xwOBA for a batter, combining current
 * and (optional) prior-year Statcast data with league means.
 */
export function computeBatterTalentXwoba(
  current: StatcastBatter | null | undefined,
  prior: StatcastBatter | null | undefined,
): TalentResult | null {
  return computeTalent({
    current: current ?? null,
    prior: prior ?? null,
    leagueXwobacon: LEAGUE_XWOBACON,
  });
}

/**
 * Compute component-based talent xwOBA-allowed for a pitcher. Symmetric
 * to the batter calc — same league K/BB priors, same composition
 * formula — but with pitcher-allowed xwOBACON as the contact-quality
 * anchor. A lower output means a better pitcher.
 */
export function computePitcherTalentXwobaAllowed(
  current: StatcastPitcher | null | undefined,
  prior: StatcastPitcher | null | undefined,
): TalentResult | null {
  return computeTalent({
    current: current ?? null,
    prior: prior ?? null,
    leagueXwobacon: LEAGUE_XWOBACON_PITCHER,
  });
}

// ---------------------------------------------------------------------------
// Internal — shared batter/pitcher path
// ---------------------------------------------------------------------------

interface TalentSource {
  pa: number;
  bip: number;
  kRate: number | null;
  bbRate: number | null;
  xwobacon: number | null;
  hardHitRate: number | null;
  /** Fallback if components aren't populated by the skills merge. */
  xwoba: number | null;
}

function computeTalent(args: {
  current: TalentSource | null;
  prior: TalentSource | null;
  leagueXwobacon: number;
}): TalentResult | null {
  const { current, prior, leagueXwobacon } = args;

  // If both sources are null, we have literally nothing — let caller
  // fall back to league mean or a tier-based estimate.
  if (!current && !prior) return null;

  // If the skills leaderboard didn't merge (Savant custom endpoint
  // blipped, for instance) and we only have top-level xwOBA numbers,
  // degrade gracefully by returning a sample-weighted blend of those.
  const curHasSkills = hasSkills(current);
  const priorHasSkills = hasSkills(prior);
  if (!curHasSkills && !priorHasSkills) {
    return degradeToXwobaOnly(current, prior);
  }

  const curPa = current?.pa ?? 0;
  const curBip = current?.bip ?? 0;
  const paCap = priorSeasonPaCap(curPa);
  const bipCap = priorSeasonBipCap(curBip);

  const k = blendRate({
    current: current?.kRate ?? null,
    currentN: curPa,
    prior: prior?.kRate ?? null,
    priorN: prior?.pa ?? 0,
    leagueMean: LEAGUE_K_RATE,
    leaguePriorN: PRIOR_K_PA,
    priorCap: paCap,
  });

  const bb = blendRate({
    current: current?.bbRate ?? null,
    currentN: curPa,
    prior: prior?.bbRate ?? null,
    priorN: prior?.pa ?? 0,
    leagueMean: LEAGUE_BB_RATE,
    leaguePriorN: PRIOR_BB_PA,
    priorCap: paCap,
  });

  // Hard-Hit % regressed on its own (fast-stabilising, ~50 BBE). This
  // becomes the *player-specific* regression anchor for xwOBACON below
  // instead of the flat league mean. Missing HH% data falls back to
  // league HH (.40), which produces the league-mean anchor — so the
  // behaviour degrades cleanly to the pre-HH model.
  const hh = blendRate({
    current: current?.hardHitRate ?? null,
    currentN: curBip,
    prior: prior?.hardHitRate ?? null,
    priorN: prior?.bip ?? 0,
    leagueMean: LEAGUE_HARD_HIT,
    leaguePriorN: PRIOR_HARD_HIT_BIP,
    priorCap: bipCap,
  });

  // Map blended HH% → expected xwOBACON for this player. Linear; see
  // HARD_HIT_TO_XWOBACON_SLOPE comment for calibration rationale.
  const hhAnchoredXwobacon = leagueXwobacon
    + HARD_HIT_TO_XWOBACON_SLOPE * (hh.value - LEAGUE_HARD_HIT);

  const con = blendRate({
    current: current?.xwobacon ?? null,
    currentN: curBip,
    prior: prior?.xwobacon ?? null,
    priorN: prior?.bip ?? 0,
    leagueMean: hhAnchoredXwobacon,
    leaguePriorN: PRIOR_XWOBACON_BIP,
    priorCap: bipCap,
  });

  // Composition. BB weight = 0.69 (standard FanGraphs linear-weights
  // run value). Everything that's not a K or BB is in play.
  const bipRate = Math.max(0, 1 - k.value - bb.value);
  const talentXwoba = bb.value * 0.69 + bipRate * con.value;

  return {
    xwoba: talentXwoba,
    components: {
      kRate: k.value,
      bbRate: bb.value,
      xwobacon: con.value,
      hardHitRate: hh.value,
      kN: k.effectiveN,
      bbN: bb.effectiveN,
      xwobaconN: con.effectiveN,
      hardHitN: hh.effectiveN,
    },
    effectivePA: Math.min(k.effectiveN, bb.effectiveN),
  };
}

function hasSkills(s: TalentSource | null): boolean {
  return !!s && (
    s.kRate !== null || s.bbRate !== null
    || s.xwobacon !== null || s.hardHitRate !== null
  );
}

/**
 * Last-resort path when the custom-skills leaderboard didn't populate
 * any components. Just blend whatever xwOBA numbers we have on top-
 * level, regressed to league mean with a 50-BIP floor.
 */
function degradeToXwobaOnly(
  current: TalentSource | null,
  prior: TalentSource | null,
): TalentResult | null {
  const curV = current?.xwoba ?? null;
  const curN = curV !== null ? (current?.bip ?? 0) : 0;
  const priV = prior?.xwoba ?? null;
  const priN = priV !== null ? Math.min(prior?.bip ?? 0, priorSeasonBipCap(curN)) : 0;
  const lgN = PRIOR_XWOBACON_BIP;

  let num = 0;
  let den = 0;
  if (curN > 0) { num += curV! * curN; den += curN; }
  if (priN > 0) { num += priV! * priN; den += priN; }
  num += LEAGUE_XWOBA * lgN;
  den += lgN;

  if (den === 0) return null;

  return {
    xwoba: num / den,
    components: {
      kRate: LEAGUE_K_RATE,
      bbRate: LEAGUE_BB_RATE,
      xwobacon: current?.xwobacon ?? prior?.xwobacon ?? LEAGUE_XWOBACON,
      hardHitRate: current?.hardHitRate ?? prior?.hardHitRate ?? LEAGUE_HARD_HIT,
      kN: 0,
      bbN: 0,
      xwobaconN: curN + priN,
      hardHitN: 0,
    },
    effectivePA: curN + priN,
  };
}
