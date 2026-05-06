/**
 * Pitcher Talent — Layer 1.
 *
 * The single canonical answer to "how good is this pitcher in a vacuum?"
 * Returns a per-PA outcome vector (K rate, BB rate, contact quality, HR
 * rate on contact, GB%) plus health/decline signals (fastball velocity,
 * YoY velo trend) plus sample-trust metadata.
 *
 * Architecture notes (see docs/pitcher-evaluation.md):
 *
 * - This module replaces `classifyPitcherTier` (rule-based ace/tough/...)
 *   AND `pitcherTalentScore` (RV/100 → xwOBA → tier fallback). Both old
 *   functions are deleted in step 8 of the rebuild. There is now ONE
 *   talent representation and ONE resolver, used by both pitcher-rating
 *   (Layer 3) and batter-rating (via Layer 2 game forecast).
 *
 * - Strength-of-schedule adjustment: each appearance's PA is scaled by
 *   the opposing team's OPS-vs-hand divided by league-average OPS-vs-
 *   hand. A pitcher who has cruised through five weak lineups gets a
 *   shrunken effective sample, which lets the Bayesian regression pull
 *   them harder toward the prior. Solves the Montero-style "27 IP of
 *   xERA 2.36 vs four below-average lineups → ACE" false-positive.
 *
 * - Tier classification is NOT done here. Tier lives at the rating layer
 *   (Layer 3) where it is derived from the final score. Talent is just a
 *   vector — it does not classify itself.
 */

import { computePitcherTalentXwobaAllowed, blendRate } from '@/lib/mlb/talentModel';
import type { PitcherSeasonLine } from '@/lib/mlb/model';
import type { StatcastPitcher } from '@/lib/mlb/types';

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

/**
 * The canonical talent contract, consumed by `buildGameForecast` (Layer 2)
 * and `getPitcherRating` (Layer 3).
 *
 * Fields are grouped by their role:
 *
 *   - **Forecast contract** — values that `buildGameForecast` reads to
 *     produce per-PA / per-game projections. Changing the meaning of any
 *     of these is a behaviour change for both pitcher AND batter ratings.
 *   - **Sample / trust** — metadata for the confidence cue. Read by the
 *     UI; not consumed by the math.
 *   - **Leading indicators (display only)** — Savant signals plumbed
 *     through for breakdown-UI transparency. NOT regressed into the
 *     forecast (the predictive content of these is already captured in
 *     `kPerPA` and `hrPerContact`). Adding a new consumer that reads
 *     these as if they were the talent estimate is a bug.
 */
export interface PitcherTalent {
  mlbId: number;
  throws: 'L' | 'R' | 'S';

  // =========================================================================
  // Forecast contract (read by buildGameForecast / batterRating)
  // =========================================================================

  /** Strikeouts per plate appearance vs a league-average opponent. */
  kPerPA: number;
  /** Walks per plate appearance vs a league-average opponent. */
  bbPerPA: number;
  /** xwOBA on contact (xwOBACON-allowed) — quality of contact when the ball
   *  is put in play. League average ≈ .368 from the pitcher's perspective. */
  contactXwoba: number;
  /** Home runs per ball-in-play (HR / contact). Bayesian-blended against
   *  the league HR/contact rate (≈ .035) with a 200-BIP prior. */
  hrPerContact: number;
  /** Average innings per start. Drives QS odds and total PA per game. */
  ipPerStart: number;
  /** Ground-ball rate. Mediates HR-park vulnerability in `forecast.ts`:
   *  a 60%-GB arm gets half the HR-park bump; a 30%-GB arm gets the full
   *  bump. Maps gbRate ∈ [.30, .60] → gbBoost ∈ [0, 0.5], applied as
   *  `effectiveParkHrMult = 1 + (parkHrAdj − 1) × (1 − gbBoost)`. */
  gbRate: number;
  /** Current usage-weighted fastball velocity (mph). Null when the pitcher
   *  has no tracked fastball usage yet. */
  fastballVelo: number | null;
  /** Year-over-year fastball velocity delta (mph). Positive = up. Null
   *  when prior-year velocity is unavailable. */
  veloTrend: number | null;

  // =========================================================================
  // Sample / trust (read by UI; NOT consumed by the math)
  // =========================================================================

  /** Total plate appearances backing the talent estimate (current +
   *  capped prior). The cap shrinks when the regime probe detects a
   *  change vs prior, so this number is smaller for declining/breakout
   *  pitchers than for stable ones. */
  effectivePA: number;
  /** Three-state sample-quality cue. Surfaced as a badge in the UI; does
   *  NOT scale the score (sample-size handling is upstream in the
   *  Bayesian regression). */
  confidence: 'high' | 'medium' | 'low';
  /** Short human-readable reason — for the breakdown UI tooltip. */
  confidenceReason: string;
  /** Numeric ± uncertainty band (in 0-100 score points) the rating
   *  layer carries through to the UI. Bigger band = thinner sample
   *  / disagreeing signals. Capped at 15. */
  confidenceBand: number;
  /** Which inputs were available, for debugging. */
  source:
    | 'savant_full'      // current + prior Savant + Stats API
    | 'savant_partial'   // some Savant fields, no prior
    | 'stats_only'       // no Savant; using ERA/WHIP/K9 from Stats API
    | 'rookie_unknown';  // nothing usable

  // =========================================================================
  // Leading indicators (DISPLAY ONLY — not consumed by forecast/rating)
  //
  // These are Savant skill signals plumbed through for breakdown-UI
  // transparency. The predictive content is already captured in `kPerPA`
  // and `hrPerContact`; do NOT reference these in the regression or the
  // rating math, or you'll double-count.
  // =========================================================================

  whiffPct: number | null;
  chasePct: number | null;
  barrelPct: number | null;
  hardHitPct: number | null;

  // =========================================================================
  // Regime-shift summary (DISPLAY ONLY — already folded into the talent
  // estimate via the prior-cap shrink applied in computePitcherTalent).
  // Surfaced for breakdown-UI transparency: lets the user see "this rating
  // collapsed prior weight because K% + barrel% co-declined."
  // =========================================================================

  regime: {
    /** Signed score: + breakout, − decline. |score| > 1 = clear regime. */
    score: number;
    /** Count of leading indicators that significantly declined vs prior. */
    declines: number;
    /** Count that significantly improved vs prior. */
    breakouts: number;
    /** Total leading indicators with both current and prior data. */
    n: number;
  };
}

// ---------------------------------------------------------------------------
// Canonical talent-math primitives
//
// Pure functions on a `PitcherTalent` vector. Every consumer that needs
// to compose xwOBA-allowed, xERA, BAA, or HR/PA from talent MUST use
// these — never inline the formulas. Drift here = drift everywhere.
//
// Background: pre-2026-05 we had three inlined `xwobaToXera` copies (in
// forecast.ts, batterRating.ts, display.tsx) with two different slopes.
// When we recalibrated forecast.ts the other two went stale, producing
// the "Max Meyer Bad-in-his-own-card / ace-in-Painter's-card" inversion
// and miscalibrated batter ratings vs SP. Centralising the primitives
// here makes that class of bug structurally impossible.
//
// If you find yourself writing `bbPerPA * 0.69 + ...` or `5 * xwoba - x`
// in a feature module, STOP and call one of these instead. If a primitive
// is missing, add it here so the next consumer also benefits.
// ---------------------------------------------------------------------------

/** Talent shape sufficient for the per-PA composition primitives. Lets
 *  these helpers accept any object with the relevant talent fields,
 *  including the slim `Pick<PitcherTalent, ...>` shapes used by
 *  batter-side helpers. */
type TalentRates = Pick<PitcherTalent, 'kPerPA' | 'bbPerPA'>;
type TalentForXwoba = TalentRates & Pick<PitcherTalent, 'contactXwoba'>;
type TalentForHr = TalentRates & Pick<PitcherTalent, 'hrPerContact'>;

/** Per-PA contact rate, floored at 0 (a nonsensical talent vector with
 *  K + BB > 1 would otherwise yield negative contact). */
export function talentContactRate(t: TalentRates): number {
  return Math.max(0, 1 - t.kPerPA - t.bbPerPA);
}

// ---------------------------------------------------------------------------
// Linear-weights anchors
//
// FanGraphs 2024 wOBA values, used as the linear weights for the explicit
// xwOBA composition. Anchored so that league-average inputs produce the
// league-average xwOBA-allowed (.318) — see `composeXwobaAllowed` below.
//
// We carry HR explicitly (rather than letting it bake into a single
// `contact_xwoba` average) so that game-context adjustments to HR rate
// (park HR factor, ground-ball gating) propagate cleanly into the
// xwobaAllowed → xERA chain. Pre-2026-05 the chain was flawed: park
// HR scaled `expectedHR` but never reached `expectedERA`, so a Coors
// flyball SP showed inflated HR projections with talent-only ERA.
// ---------------------------------------------------------------------------

const W_BB = 0.69;
const W_HR = 1.97;

/**
 * The non-HR component of a pitcher's xwOBA-on-contact.
 *
 * `talent.contactXwoba` is the pitcher's average xwOBA on balls in play —
 * it INCLUDES HR. To compose xwOBA explicitly with HR (so park HR can
 * propagate into ERA), we need the average xwOBA on the *non-HR* portion
 * of contact. We back it out via:
 *
 *   contactXwoba × BIP = HR × wHR + nonHR × nonHrXwoba
 *   nonHrXwoba = (contactXwoba × BIP − HR × wHR) / (BIP − HR)
 *              = (contactXwoba − hrFraction × wHR) / (1 − hrFraction)
 *
 * where hrFraction = HR / BIP = hrPerContact for the talent vector.
 *
 * For league-average inputs (contactXwoba ≈ .368, hrPerContact ≈ .035):
 *   nonHrXwoba ≈ (.368 − .035 × 1.97) / (1 − .035) ≈ .311.
 */
export function talentNonHrContactXwoba(
  t: TalentForXwoba & { hrPerContact: number },
): number {
  const hrFraction = Math.max(0, Math.min(0.999, t.hrPerContact));
  return (t.contactXwoba - hrFraction * W_HR) / Math.max(1e-6, 1 - hrFraction);
}

/**
 * Composed talent xwOBA-allowed (un-adjusted for game context).
 *
 * Uses the FanGraphs linear-weights form with explicit HR:
 *   xwoba = BB/PA × wBB + nonHrContact/PA × nonHrXwoba + HR/PA × wHR
 *
 * Mathematically equivalent to the old `BB × 0.69 + contact × contactXwOBA`
 * form for un-adjusted inputs (HR is implicitly in contactXwOBA, so the
 * decomposition reassembles cleanly). The advantage of the explicit form
 * shows up when the forecast layer adjusts HR/PA for park/gb-rate — the
 * adjustment now flows into ERA / WHIP / W via this composition rather
 * than dangling as a separate expectedHR projection that doesn't reach
 * the rate stats.
 *
 * For game-context adjustments use `composeAdjustedXwobaAllowed` (in
 * `forecast.ts`) which takes pre-adjusted per-PA rates.
 */
export function composeXwobaAllowed(
  t: TalentForXwoba & { hrPerContact: number },
): number {
  const contactRate = talentContactRate(t);
  const hrPerPA = t.hrPerContact * contactRate;
  const nonHrContactPerPA = Math.max(0, contactRate - hrPerPA);
  const nonHrXwoba = talentNonHrContactXwoba(t);
  return t.bbPerPA * W_BB
       + nonHrContactPerPA * nonHrXwoba
       + hrPerPA * W_HR;
}

/**
 * Compose xwOBA-allowed from already-adjusted in-game per-PA rates. Used
 * by `buildGameForecast` after applying park (SO/BB/HR-with-gbRate-gate),
 * opp, and weather to the per-PA inputs. Same linear-weights form as
 * `composeXwobaAllowed`; this version takes the adjusted inputs directly.
 *
 *   xwoba = BB/PA × wBB + nonHrContact/PA × nonHrXwoba + HR/PA × wHR
 *
 * `nonHrContactValue` is the average xwOBA on non-HR balls in play in
 * THIS matchup — the talent's `nonHrXwoba` scaled by overall park /
 * opp / weather contact-quality factors (BABIP-like effects).
 */
export function composeAdjustedXwobaAllowed(args: {
  bbPerPA: number;
  kPerPA: number;
  hrPerPA: number;
  nonHrContactValue: number;
}): number {
  const contactRate = Math.max(0, 1 - args.kPerPA - args.bbPerPA);
  const nonHrContactPerPa = Math.max(0, contactRate - args.hrPerPA);
  return args.bbPerPA * W_BB
       + nonHrContactPerPa * args.nonHrContactValue
       + args.hrPerPA * W_HR;
}

/**
 * Convert composed talent xwOBA-allowed to xERA. Linear approximation
 * fit to roughly match Statcast's published xERA across the realistic
 * MLB starter distribution:
 *
 *   .243 xwOBA → 2.33 xERA  (Skubal-type ace)
 *   .270 xwOBA → 3.00 xERA  (high-end starter)
 *   .318 xwOBA → 4.20 xERA  (league average — anchor)
 *   .363 xwOBA → 5.32 xERA  (back-end starter)
 *   .420 xwOBA → 6.75 xERA  (replacement level)
 *
 * Slope of 25 ERA-points per .100 of xwOBA, intercept tuned so the
 * league-avg anchor lands at 4.20. Floor / ceiling clamps keep
 * degenerate inputs from producing nonsensical projections. Adjusting
 * the slope or anchor is "global blast radius" — see
 * docs/scoring-conventions.md.
 */
export function xwobaToXera(xwoba: number): number {
  return Math.max(1.50, Math.min(7.50, 25 * xwoba - 3.75));
}

/** Convenience: composed xERA directly from a talent vector. Equivalent
 *  to `xwobaToXera(composeXwobaAllowed(t))` — exists so consumers don't
 *  re-export both for the common case. */
export function talentExpectedEra(
  t: TalentForXwoba & { hrPerContact: number },
): number {
  return xwobaToXera(composeXwobaAllowed(t));
}

/** Talent-derived BAA proxy. Multiplier 1.5 matches the empirical
 *  2024 MLB league-mean ratio (xwOBACON ≈ .368, BAA ≈ .246). Used by
 *  the per-PA `baa` cell of `GameForecast` AND by the batter-rating
 *  log5 vs the SP. The ratio drifts at the tails (~1.6-1.8 for elite
 *  contact suppressors, ~1.4 for high-damage profiles); a single
 *  multiplier doesn't fit both ends perfectly, but 1.5 is closer to
 *  empirical center than the previous 1.4. */
export function talentBaa(t: Pick<PitcherTalent, 'contactXwoba'>): number {
  return t.contactXwoba / 1.5;
}

/** Talent-derived per-PA HR rate, NO park factor applied. Callers add
 *  park multipliers at the use site (the forecast applies park HR
 *  factor; the batter-side rating uses raw HR/PA for the HR cat). */
export function talentHrPerPA(t: TalentForHr): number {
  return t.hrPerContact * talentContactRate(t);
}

// ---------------------------------------------------------------------------
// League constants (used by SoS + the HR/contact regression)
//
// Exported so consumers (forecast.ts in particular) don't redefine them.
// These are population means; updating them is "global blast radius" —
// see docs/scoring-conventions.md.
// ---------------------------------------------------------------------------

/** League-average team OPS vs RHP / LHP. Used by `forecast.ts` for
 *  opp-OPS context multipliers. Single anchor for both sides; the
 *  tilt between hands is small (~5 points of OPS) and consumers that
 *  want hand-specific behaviour resolve `vsLeft` / `vsRight` themselves. */
export const LEAGUE_OPS = 0.710;

/** League-average HR-per-contact rate. Used as the regression anchor for
 *  hrPerContact. ~0.035 corresponds to a roughly league-average HR/9 of
 *  1.15 across the population. */
const LEAGUE_HR_PER_CONTACT = 0.035;
const LEAGUE_HR_PER_CONTACT_PRIOR_BIP = 200;

/** League-average IP/start. Anchors `ipPerStart` for thin samples. */
const LEAGUE_IP_PER_START = 5.4;
const LEAGUE_IP_PER_START_PRIOR_GS = 6;

/** League-average GB rate (anchor). */
const LEAGUE_GB_RATE = 0.435;
const LEAGUE_GB_PRIOR_PA = 150;

/** Confidence ramps. Effective PA needed for full sample-confidence. */
const PA_FULL_TRUST = 200;

// ---------------------------------------------------------------------------
// Regime-change probe
//
// When current-season leading indicators (K%, BB%, whiff%, barrel%, velo)
// move *together* vs prior, that's evidence the prior is contaminated by
// a regime change (decline, breakout, role swap, injury return) and the
// Bayesian regression should let the current sample dominate sooner.
// Conversely, when leading indicators agree with prior but the OUTCOMES
// (xERA, xwOBA) disagree, that's contact-quality luck and the prior
// should be preserved.
//
// This replaces the previous SoS sample-shrinking adjustment, which had
// the right intent (discount Montero-style "27 IP of pretty xERA vs four
// weak lineups → ACE" hot starts) but the wrong shape (it pulled declining
// pitchers facing soft lineups *toward* their better prior, inflating the
// estimate). The regime probe handles both Montero (skills flat → prior
// preserved → contact-quality outlier regressed) and the inverse case
// (Houser: K%+barrel% co-decline → prior weight collapses).
//
// SD constants are calibrated from y-to-y noise bands: roughly the
// magnitude at which a single metric's delta starts to look like signal
// rather than sampling noise. Cross-metric agreement is what makes the
// signal confident, not any one metric in isolation.
// ---------------------------------------------------------------------------

const REGIME_SD_K = 0.030;
const REGIME_SD_BB = 0.018;
const REGIME_SD_WHIFF = 0.025;
const REGIME_SD_BARREL = 0.020;
const REGIME_SD_VELO = 0.7;
/** Threshold above which a single metric's z-score is "significant"
 *  rather than noise. Below this, the metric is excluded from the
 *  regime aggregate. */
const REGIME_SIGNIFICANT_Z = 0.8;

/**
 * Compute a regime-shift score from per-metric year-over-year deltas.
 *
 * Returned `score` is signed: positive = breakout (skills improved
 * vs prior), negative = decline. Magnitude reflects how confidently
 * multiple leading indicators agree on direction.
 *
 * Aggregation: take metrics whose |z| ≥ REGIME_SIGNIFICANT_Z, sum
 * (signed), divide by max(2, count_significant). The denominator
 * floor dampens single-metric outliers; contradicting metrics
 * naturally cancel via the signed sum.
 */
export function computeRegimeShift(
  current: StatcastPitcher | null | undefined,
  prior: StatcastPitcher | null | undefined,
): { score: number; declines: number; breakouts: number; n: number } {
  if (!current || !prior) {
    return { score: 0, declines: 0, breakouts: 0, n: 0 };
  }
  const zs: number[] = [];
  // Sign convention: +z = pitcher improved vs prior (better K, fewer BB,
  // more whiffs, fewer barrels, more velo).
  if (current.kRate != null && prior.kRate != null) {
    zs.push((current.kRate - prior.kRate) / REGIME_SD_K);
  }
  if (current.bbRate != null && prior.bbRate != null) {
    zs.push(-(current.bbRate - prior.bbRate) / REGIME_SD_BB);
  }
  if (current.whiffPct != null && prior.whiffPct != null) {
    zs.push((current.whiffPct - prior.whiffPct) / REGIME_SD_WHIFF);
  }
  if (current.barrelPct != null && prior.barrelPct != null) {
    zs.push(-(current.barrelPct - prior.barrelPct) / REGIME_SD_BARREL);
  }
  if (current.avgFastballVelo != null && prior.avgFastballVelo != null) {
    zs.push((current.avgFastballVelo - prior.avgFastballVelo) / REGIME_SD_VELO);
  }

  const significant = zs.filter(z => Math.abs(z) >= REGIME_SIGNIFICANT_Z);
  const declines = significant.filter(z => z < 0).length;
  const breakouts = significant.filter(z => z > 0).length;
  const score = significant.length === 0
    ? 0
    : significant.reduce((s, z) => s + z, 0) / Math.max(2, significant.length);

  return { score, declines, breakouts, n: zs.length };
}

/**
 * Convert a regime-shift score into a multiplier on the prior-season
 * cap. |score| of 1 → 0.6× prior weight; 2 → 0.2× (floored at 0.25).
 * Symmetric for declines and breakouts — both indicate the prior
 * doesn't reflect current talent.
 */
function regimeShiftToShrink(score: number): number {
  const abs = Math.min(2.5, Math.abs(score));
  return Math.max(0.25, 1 - 0.4 * abs);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Bucket a per-PA rate into 'above' / 'avg' / 'below' relative to a
 * league mean and a half-band. Used for signal-agreement scoring inside
 * `computeConfidence` — "do K%, RV/100, and contact-xwOBA all classify
 * this pitcher in the same direction?"
 */
function bucket(value: number, mean: number, halfBand: number): 'above' | 'avg' | 'below' {
  if (value > mean + halfBand) return 'above';
  if (value < mean - halfBand) return 'below';
  return 'avg';
}

/**
 * Confidence model: sample × signal-agreement.
 *
 *   level_input  = clamp01(effectivePA / 200)   ← talent-pool size
 *   band_input   = clamp01(bandPA / 200)        ← current-season size only
 *   agreement    = 1.0 aligned, 0.7 fighting
 *
 * Two different PA inputs because they answer two different questions.
 * The tier-badge `level` reflects "how much DATA backs the talent
 * estimate" (current + capped prior). The numeric `band` reflects
 * "how stable is THIS YEAR'S sample at pinning down current talent" —
 * a thin current sample with a fat prior lets the model estimate a
 * mean confidently but the ± uncertainty is real, because if the
 * prior is contaminated, the estimate moves a lot.
 *
 * Pre-2026-05 the band used effectivePA too, which collapsed to 0
 * for any pitcher with a full prior season — making the model claim
 * suspiciously high confidence on early-April projections that were
 * actually heavily prior-anchored.
 *
 * Capped at ±15 so even a no-data pitcher doesn't get an unreadable
 * "50 ± 50" reading. The 15-point cap matches the maximum sample-size
 * sensitivity we'd expect for a 0-PA pitcher — beyond that, the score
 * itself is unreliable signal.
 */
const MAX_CONFIDENCE_BAND = 15;

function computeConfidence(args: {
  bandPA: number;
  effectivePA: number;
  kPerPA: number;
  contactXwoba: number;
  rv100: number | null;
  /** Absolute regime-shift score from `computeRegimeShift`. When large
   *  (>1), current and prior are actively disagreeing — a separate
   *  axis of uncertainty from "thin current sample" or "current vs
   *  league disagreement", widens the band proportionally. */
  regimeAbsScore: number;
  source: PitcherTalent['source'];
}): { level: 'high' | 'medium' | 'low'; reason: string; band: number } {
  const { bandPA, effectivePA, kPerPA, contactXwoba, rv100, regimeAbsScore, source } = args;
  const sampleScore = clamp01(effectivePA / PA_FULL_TRUST);
  const bandScore = clamp01(bandPA / PA_FULL_TRUST);

  // Signal agreement check. Each signal classifies the pitcher relative
  // to league average; we look at whether the directions cluster.
  const dirs: Array<'above' | 'avg' | 'below'> = [];

  // K rate vs league: ~22.3% mean, half-band of 4 percentage points.
  // (Above average for a pitcher = MORE Ks = better.)
  dirs.push(bucket(kPerPA, 0.223, 0.04));

  // contactXwoba vs league: ~.368 mean, half-band of .025.
  // For pitchers, LOWER contactXwoba is better — invert for direction.
  const cxBucket = bucket(contactXwoba, 0.368, 0.025);
  dirs.push(cxBucket === 'above' ? 'below' : cxBucket === 'below' ? 'above' : 'avg');

  // RV/100 (Savant arsenal). For pitchers, LOWER is better — invert.
  if (rv100 !== null) {
    const rvBucket = bucket(rv100, 0, 0.5);
    dirs.push(rvBucket === 'above' ? 'below' : rvBucket === 'below' ? 'above' : 'avg');
  }

  // Disagreement = ≥1 'above' AND ≥1 'below' across the directions.
  const hasAbove = dirs.some(d => d === 'above');
  const hasBelow = dirs.some(d => d === 'below');
  const agreementScore = hasAbove && hasBelow ? 0.7 : 1.0;

  const value = sampleScore * agreementScore;
  const level: 'high' | 'medium' | 'low' =
    value >= 0.7 ? 'high'
    : value >= 0.4 ? 'medium'
    : 'low';

  // Numeric uncertainty band on the score. Three sources of widening:
  //   1. bandScore — thin current-season sample (the dominant term for
  //      most early-season pitchers).
  //   2. disagreementWiden — current-season signals classify on opposite
  //      sides of league average (K% says ace, contact says back-end).
  //   3. regimeWiden — current-season vs prior-season disagreement (the
  //      regime probe fired). This is a separate axis: even with a fat
  //      current sample, if K%+barrel% just told us prior is contaminated,
  //      the talent estimate has more meaningful uncertainty than
  //      bandScore alone implies.
  // All three are multiplicative on the base sample-uncertainty scale.
  const disagreementWiden = agreementScore < 1 ? 1.3 : 1.0;
  const regimeWiden = 1 + 0.15 * Math.min(2, regimeAbsScore);
  const band = clamp(
    (1 - bandScore) * MAX_CONFIDENCE_BAND * disagreementWiden * regimeWiden,
    0,
    MAX_CONFIDENCE_BAND,
  );

  const samplePart = `${effectivePA.toFixed(0)} effective PA`;
  const agreementPart = agreementScore < 1 ? 'signals disagree' : 'signals aligned';
  const reason = source === 'rookie_unknown'
    ? 'No usable MLB sample'
    : `${samplePart} · ${agreementPart}`;

  return { level, reason, band };
}

// ---------------------------------------------------------------------------
// Public: compute talent
// ---------------------------------------------------------------------------

export interface ComputeTalentArgs {
  mlbId: number;
  throws: 'L' | 'R' | 'S';
  /** Stats-API starter line, current season. */
  currentLine: PitcherSeasonLine | null;
  /** Stats-API starter line, prior season — used for ipPerStart anchor
   *  and as a fallback when current sample is empty. */
  priorLine: PitcherSeasonLine | null;
  /** Savant pitcher row, current season. */
  currentSavant: StatcastPitcher | null;
  /** Savant pitcher row, prior season. */
  priorSavant: StatcastPitcher | null;
}

/**
 * Compute the canonical talent vector. Pure function — no I/O, no side
 * effects. The orchestrator (currently `schedule.ts:enrichPitcher`)
 * fetches everything and hands it in.
 */
export function computePitcherTalent(args: ComputeTalentArgs): PitcherTalent {
  const {
    mlbId, throws, currentLine, priorLine,
    currentSavant, priorSavant,
  } = args;

  // ----- Regime-shift probe -----------------------------------------------
  // Detects when leading indicators (K%, BB%, whiff%, barrel%, velo) move
  // together vs prior. Replaces the previous SoS sample-shrinking, which
  // had the wrong direction for declining pitchers facing weak lineups.
  // See `computeRegimeShift` for the math; `regimeShiftToShrink` maps the
  // signed score to a 0.25..1.0 multiplier on the prior-season cap.
  const regime = computeRegimeShift(currentSavant, priorSavant);
  const regimeShrink = regimeShiftToShrink(regime.score);

  // ----- Component talent (K%, BB%, xwOBACON-allowed, regressed) ----------
  const componentTalent = computePitcherTalentXwobaAllowed(
    currentSavant ?? undefined,
    priorSavant ?? undefined,
    regimeShrink,
  );

  // ----- HR / contact (Bayesian blend, separate from xwOBA model) ---------
  // Savant gives us xwoba, woba, and we can derive HR/contact from
  // current.hr / current.bip if Savant carried it — it doesn't on this
  // endpoint, so fall back to Stats API hr9 → HR/contact via standard
  // PA-per-IP conversion. Still better than ignoring HR rate entirely.
  // Same regime-shrink applies to the HR/contact prior cap so the chain
  // stays consistent.
  const hrPerContact = computeHrPerContact({
    currentLine, priorLine,
    currentBip: currentSavant?.bip ?? 0,
    priorBip: priorSavant?.bip ?? 0,
    regimeShrink,
  });

  // ----- ipPerStart (Bayesian blend across current + prior + league) -----
  const ipPerStart = blendIpPerStart(currentLine, priorLine);

  // ----- gbRate (Bayesian blend) ------------------------------------------
  const gbRate = blendGbRate(currentLine, priorLine);

  // ----- Velocity (no regression — current is current, trend = delta) ----
  const fastballVelo = currentSavant?.avgFastballVelo ?? priorSavant?.avgFastballVelo ?? null;
  const veloTrend =
    currentSavant?.avgFastballVelo !== null && currentSavant?.avgFastballVelo !== undefined
    && priorSavant?.avgFastballVelo !== null && priorSavant?.avgFastballVelo !== undefined
      ? currentSavant.avgFastballVelo - priorSavant.avgFastballVelo
      : null;

  // ----- Resolve final outcome rates --------------------------------------
  // The component talent model (from `talentModel.ts`) has TWO success
  // paths:
  //   - Full path: blended K%/BB%/xwOBACON from Savant skills CSV with
  //     real backing PAs (`components.kN > 0`, `bbN > 0`).
  //   - Degraded path (`degradeToXwobaOnly`): when the skills CSV didn't
  //     merge, it returns a non-null result with `kRate = LEAGUE_K_RATE`
  //     and `bbRate = LEAGUE_BB_RATE` — i.e. components.kN === 0 means
  //     "this isn't a real measurement, just the league mean."
  //
  // We have to detect the degraded path explicitly. Otherwise every
  // pitcher silently collapses to league-average K%/BB% during a Savant
  // outage, which is wrong — we have Stats-API K/9 and BB/9 right there.
  // Convert via the standard PA/inning anchor (4.2 PA per IP for an
  // average pitcher) and use those instead.
  const fallbackKPerPA = currentLine?.strikeoutsPer9 != null
    ? clamp(currentLine.strikeoutsPer9 / 9 / 4.2, 0.10, 0.45)
    : 0.223;
  const fallbackBbPerPA = currentLine?.bb9 != null
    ? clamp(currentLine.bb9 / 9 / 4.2, 0.02, 0.20)
    : 0.084;

  const kFromSkills = componentTalent != null && componentTalent.components.kN > 0;
  const bbFromSkills = componentTalent != null && componentTalent.components.bbN > 0;
  const kPerPA = kFromSkills ? componentTalent!.components.kRate : fallbackKPerPA;
  const bbPerPA = bbFromSkills ? componentTalent!.components.bbRate : fallbackBbPerPA;

  // contactXwoba: degraded path falls back to LEAGUE_XWOBACON when no
  // real Savant xwOBACON is available. We can do better via BAA: BAA
  // and xwOBACON correlate well enough that a regressed BAA → xwOBACON
  // estimate beats the flat league mean. Map: contactXwoba ≈ 1.4 × BAA
  // (inverse of the BAA synthesis used in forecast.ts).
  const xwobaConFromSkills = componentTalent != null
    && componentTalent.components.xwobaconN > 0
    && (currentSavant?.xwobacon != null || priorSavant?.xwobacon != null);
  const fallbackContactXwoba = (() => {
    const baa = currentLine?.battingAvgAgainst ?? priorLine?.battingAvgAgainst ?? null;
    if (baa == null) return 0.368;
    return clamp(baa * 1.4, 0.260, 0.460);
  })();
  const contactXwoba = xwobaConFromSkills
    ? componentTalent!.components.xwobacon
    : fallbackContactXwoba;
  const hardHitPct = (componentTalent?.components.hardHitN ?? 0) > 0
    ? componentTalent!.components.hardHitRate
    : null;

  // ----- Effective PA (drives confidence) ---------------------------------
  // Prefer the talent-model's effectivePA when it's backed by real
  // skills data. The degraded path returns effectivePA = curN + priN
  // for xwOBA-only purposes, but that overstates trust in K/BB which
  // we just supplemented from Stats-API. Use the Stats-API PA estimate
  // when we're K/BB-degraded — it reflects actual sample size of the
  // numbers we just used.
  const statsApiPaEstimate = (currentLine?.ip ?? 0) * 4.3
    + Math.min(150, (priorLine?.ip ?? 0) * 4.3);
  const effectivePA = (kFromSkills || bbFromSkills) && componentTalent
    ? componentTalent.effectivePA
    : statsApiPaEstimate;
  // Current-season-only PA: drives the confidence band. Prior-season
  // weight in `effectivePA` reflects the talent estimator's input pool;
  // the *uncertainty* of that estimate, however, is dominated by how
  // much current-season data we have. A 143-PA current sample with a
  // 500-PA prior is genuinely uncertain even when the talent estimate
  // is well-anchored.
  const currentSeasonPA = currentSavant?.pa ?? (currentLine?.ip ?? 0) * 4.3;

  // ----- Source label -----------------------------------------------------
  // 'savant_full' now requires that K and BB came from real skills data,
  // not the degraded fallback. Otherwise we'd brand a Stats-API blend as
  // savant-grade in the breakdown UI.
  let source: PitcherTalent['source'];
  if (componentTalent && kFromSkills && bbFromSkills && currentSavant && priorSavant) {
    source = 'savant_full';
  } else if (kFromSkills && bbFromSkills) {
    source = 'savant_partial';
  } else if (currentLine || priorLine) {
    source = 'stats_only';
  } else {
    source = 'rookie_unknown';
  }

  // ----- Confidence -------------------------------------------------------
  // Band combines three uncertainty sources: thin current-season sample,
  // signals disagreeing within the current season, and current-vs-prior
  // regime disagreement. See `computeConfidence` for the composition.
  const confidenceResult = computeConfidence({
    bandPA: currentSeasonPA,
    effectivePA,
    kPerPA,
    contactXwoba,
    rv100: currentSavant?.runValuePer100 ?? null,
    regimeAbsScore: Math.abs(regime.score),
    source,
  });

  return {
    mlbId,
    throws,
    kPerPA,
    bbPerPA,
    contactXwoba,
    hrPerContact,
    ipPerStart,
    gbRate,
    fastballVelo,
    veloTrend,
    // Leading indicators surfaced from the current-season Savant skills
    // leaderboard. Not used in the regression — the `kPerPA` and HR/contact
    // numbers above already capture the predictive signal from these.
    // Plumbed through for breakdown-UI transparency.
    whiffPct: currentSavant?.whiffPct ?? null,
    chasePct: null,  // not yet on the skills CSV; future plumbing pass
    barrelPct: currentSavant?.barrelPct ?? null,
    hardHitPct,
    effectivePA,
    confidence: confidenceResult.level,
    confidenceReason: confidenceResult.reason,
    confidenceBand: confidenceResult.band,
    source,
    regime: {
      score: regime.score,
      declines: regime.declines,
      breakouts: regime.breakouts,
      n: regime.n,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * HR / contact rate, Bayesian-blended. We don't have HR/contact directly
 * on Savant, so we derive from Stats-API HR/9 + outs-per-game arithmetic:
 *   HR/contact ≈ HR / (PA - K - BB) ≈ HR / (IP × 4.3 × (1 - K% - BB%))
 *
 * For simplicity we use the population (1 - K% - BB%) ≈ 0.69 to convert
 * IP → contact. Anchored to LEAGUE_HR_PER_CONTACT with a 200-BIP prior.
 */
function computeHrPerContact(args: {
  currentLine: PitcherSeasonLine | null;
  priorLine: PitcherSeasonLine | null;
  currentBip: number;
  priorBip: number;
  /** Same regime-shrink as the talent xwOBA chain; collapses prior weight
   *  when leading indicators say the pitcher is no longer the same arm
   *  as last season. Default 1.0 preserves legacy behaviour. */
  regimeShrink?: number;
}): number {
  const { currentLine, priorLine, currentBip, priorBip } = args;
  const shrink = Math.max(0.1, Math.min(1.0, args.regimeShrink ?? 1.0));
  const lgShrink = Math.sqrt(shrink);

  const fromLine = (line: PitcherSeasonLine | null): number | null => {
    if (!line || line.ip <= 0 || line.hr9 == null) return null;
    const totalContact = Math.max(1, line.ip * 4.3 * 0.69);
    const totalHr = line.hr9 * line.ip / 9;
    return totalHr / totalContact;
  };

  const blend = blendRate({
    current: fromLine(currentLine),
    currentN: currentBip > 0 ? currentBip : (currentLine?.ip ?? 0) * 4.3 * 0.69,
    prior: fromLine(priorLine),
    priorN: priorBip > 0 ? priorBip : (priorLine?.ip ?? 0) * 4.3 * 0.69,
    leagueMean: LEAGUE_HR_PER_CONTACT,
    leaguePriorN: LEAGUE_HR_PER_CONTACT_PRIOR_BIP * lgShrink,
    priorCap: 250 * shrink,
  });

  return blend.value;
}

/**
 * IP/start, Bayesian-blended toward league average. A pitcher with 5
 * starts averaging 4.5 IP shouldn't project as a 4.5-IP arm; their true
 * talent is a mix of their (small) sample and the league.
 */
function blendIpPerStart(
  currentLine: PitcherSeasonLine | null,
  priorLine: PitcherSeasonLine | null,
): number {
  const blend = blendRate({
    current: currentLine?.inningsPerStart ?? null,
    currentN: currentLine?.gamesStarted ?? 0,
    prior: priorLine?.inningsPerStart ?? null,
    priorN: priorLine?.gamesStarted ?? 0,
    leagueMean: LEAGUE_IP_PER_START,
    leaguePriorN: LEAGUE_IP_PER_START_PRIOR_GS,
    priorCap: 30,
  });
  return blend.value;
}

/**
 * GB rate, Bayesian-blended toward league average. Used by Layer 2 for
 * park-HR interactions (a 60%-GB arm in Coors is not as scary as a flyball
 * arm in Coors).
 */
function blendGbRate(
  currentLine: PitcherSeasonLine | null,
  priorLine: PitcherSeasonLine | null,
): number {
  const blend = blendRate({
    current: currentLine?.gbRate ?? null,
    currentN: (currentLine?.ip ?? 0) * 4.3,
    prior: priorLine?.gbRate ?? null,
    priorN: (priorLine?.ip ?? 0) * 4.3,
    leagueMean: LEAGUE_GB_RATE,
    leaguePriorN: LEAGUE_GB_PRIOR_PA,
    priorCap: 600,
  });
  return blend.value;
}
