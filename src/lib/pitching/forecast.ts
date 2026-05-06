/**
 * Pitcher Game Forecast — Layer 2.
 *
 * Given a pitcher's context-free talent (Layer 1) and a specific game
 * context, produce:
 *
 *   - per-PA outcome rates adjusted for THIS matchup (consumed by the
 *     batter side via log5)
 *   - per-game expected fantasy stats (consumed by Layer 3 rating)
 *   - QS / W probabilities
 *   - the named context multipliers, for breakdown UI display
 *
 * This module is the single shared layer between pitcher-as-subject
 * (streaming, today, holds, drops) and pitcher-as-obstacle (batter
 * matchup ratings). Both consume `forecast.expectedPerPA` — the batter
 * rating uses it as the right-hand side of log5; the pitcher rating
 * uses `expectedPerGame` to project category outcomes.
 *
 * No fantasy-league logic here. Yahoo `stat_id` mapping happens at
 * Layer 3. Talent + context → baseball-shaped projections.
 */

import { getWeatherScore } from '@/lib/mlb/analysis';
import { getParkAdjustment } from '@/lib/mlb/parkAdjustment';
import type { EnrichedGame, ParkData, GameWeather } from '@/lib/mlb/types';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { PitcherTalent } from './talent';
import {
  composeXwobaAllowed,
  composeAdjustedXwobaAllowed,
  xwobaToXera,
  talentNonHrContactXwoba,
  LEAGUE_OPS,
} from './talent';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContextMultiplier {
  /** Multiplier applied to a relevant projection (e.g. 1.04 = +4%). */
  multiplier: number;
  /** Multiplier - 1, in percent space. Positive = boosts pitcher. */
  deltaPct: number;
  /** Short raw display ("12 mph out", "vs Yankees", "Coors"). */
  display: string;
  /** Human-readable summary ("offense suppressed"). */
  summary: string;
  /** Whether the underlying data was actually available. */
  available: boolean;
}

export interface ExpectedPerPA {
  /** K rate adjusted for opp K-rate vs hand. */
  kPerPA: number;
  /** BB rate adjusted for opp discipline. */
  bbPerPA: number;
  /** HR per PA — talent.hrPerContact × contact_rate × parkHR factor. */
  hrPerPA: number;
  /** Contact xwOBA-allowed adjusted for opp contact quality. */
  contactXwoba: number;
  /** Synthesized batting average against (for batter-side AVG log5). */
  baa: number;
}

export interface ExpectedPerGame {
  ip: number;
  pa: number;
  k: number;
  bb: number;
  er: number;
  h: number;
  hr: number;
}

export interface GameForecast {
  pitcher: PitcherTalent;
  game: EnrichedGame;
  isHome: boolean;
  /** Talent-rooted xwOBA-allowed composed for this matchup. The batter
   *  side uses this as the run-environment signal for R / RBI cats. */
  xwobaAllowed: number;
  /** Talent-rooted ERA estimate (xwOBA → xERA via FanGraphs linear).
   *  This is the single canonical "what ERA does this pitcher project"
   *  number — replaces the old `effectiveEra ?? tierToEra` fallback. */
  expectedERA: number;
  expectedPerPA: ExpectedPerPA;
  expectedPerGame: ExpectedPerGame;
  probabilities: {
    qs: number;
    w: number;
  };
  multipliers: {
    velocity: ContextMultiplier;
    platoon: ContextMultiplier;
    park: ContextMultiplier;
    weather: ContextMultiplier;
    opp: ContextMultiplier;
    /** Bullpen — used ONLY inside probabilities.w. Not folded into the
     *  Layer 3 composite (per architecture decision a1: bullpen affects
     *  only Wins). Surfaced here for breakdown UI. */
    bullpen: ContextMultiplier;
  };
}

// ---------------------------------------------------------------------------
// Build inputs
// ---------------------------------------------------------------------------

export interface BuildForecastArgs {
  pitcher: PitcherTalent;
  game: EnrichedGame;
  isHome: boolean;
  /** Pitcher's opposing offense — looked up by caller from the game and
   *  the team-offense cache. */
  opposingOffense: TeamOffense | null;
  /** Talent vector for the OTHER pitcher in this game (the opposing SP).
   *  Used to dampen Wins probability against an ace. Null when TBD. */
  opposingPitcher: PitcherTalent | null;
}

// ---------------------------------------------------------------------------
// Constants
//
// `LEAGUE_OPS` is imported from `./talent` — that's the single home for
// population means. The old local copies of LEAGUE_K_RATE / LEAGUE_BB_RATE
// / LEAGUE_CONTACT_XWOBA were unused (suppressed via `void` statements);
// dropped to remove the drift hazard. Add them back HERE only if a real
// consumer materialises, and re-export from `./talent` so we have one
// authoritative copy.
// ---------------------------------------------------------------------------

/** League-average opponent K-rate. Anchors the log5 baseline for K
 *  matchup adjustments. Same value as LEAGUE_K_RATE in `./talent` but
 *  keyed semantically to the OPS-K-rate batter context. */
const LEAGUE_OPS_K_RATE = 0.223;

// `xwobaToXera`, `composeXwobaAllowed`, `talentBaa`, `talentHrPerPA`, and
// `talentContactRate` now live in `./talent` as the single canonical
// home for talent-vector → outcome conversions. Re-exported above for
// back-compat. See talent.ts header comment for the rationale (drift
// caused the Max-Meyer ace-in-Painter's-card inversion on 2026-05-04).

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

// ---------------------------------------------------------------------------
// Multipliers
// ---------------------------------------------------------------------------

/**
 * Velocity informational display.
 *
 * Velocity used to apply a ±6% multiplier directly to the composite
 * score. As of 2026-05, velo trend is one of the inputs to the talent
 * layer's `computeRegimeShift` probe (in `talent.ts`), where it
 * contributes to deciding how aggressively to shrink the prior-season
 * weight. Keeping a composite-level velocity multiplier on top of that
 * was double-counting: a pitcher losing 1.5 mph who has *also* lost a
 * tick of K% would get penalized once via the regime probe's prior-cap
 * shrinkage (current K% dominates → talent estimate moves toward
 * current) and *again* via the composite multiplier.
 *
 * The function still returns a populated `ContextMultiplier` for the
 * breakdown UI (so users see "Velo: −1.2 mph · Velo slipping"), but
 * `multiplier` is fixed at 1.0 so it has no effect on the composite
 * score. The display/summary fields are preserved for transparency.
 */
function buildVelocityMultiplier(t: PitcherTalent): ContextMultiplier {
  if (t.veloTrend == null || t.fastballVelo == null) {
    return {
      multiplier: 1.0, deltaPct: 0, display: '—',
      summary: 'No velo history', available: false,
    };
  }
  const delta = clamp(t.veloTrend, -2.0, 2.0);
  const sign = delta >= 0 ? '+' : '';
  const summary =
    delta >= 1.0 ? 'Velo trending up'
    : delta >= 0.3 ? 'Velo uptick'
    : delta <= -1.0 ? 'Velo red flag'
    : delta <= -0.3 ? 'Velo slipping'
    : 'Velo stable';

  return {
    multiplier: 1.0,
    deltaPct: 0,
    display: `${sign}${delta.toFixed(1)} mph`,
    summary,
    available: true,
  };
}

/**
 * Platoon multiplier — does the opposing offense stack the pitcher's
 * weaker handedness side? Uses team-vs-hand OPS allowed as the proxy.
 * Currently driven by team-aggregate OPS-vs-hand; future upgrade is
 * per-game lineup-stack detection.
 */
function buildPlatoonMultiplier(
  pitcher: PitcherTalent,
  opp: TeamOffense | null,
): ContextMultiplier {
  if (!opp) {
    return {
      multiplier: 1.0, deltaPct: 0, display: '—',
      summary: 'No opponent data', available: false,
    };
  }

  const handLabel = pitcher.throws === 'L' ? 'vs LHP' : 'vs RHP';
  const oppOps = pitcher.throws === 'L'
    ? opp.vsLeft?.ops ?? opp.ops
    : opp.vsRight?.ops ?? opp.ops;
  if (oppOps == null) {
    return {
      multiplier: 1.0, deltaPct: 0, display: handLabel,
      summary: 'No platoon split', available: false,
    };
  }

  // 0.650 OPS = +5% (clean split, easy lineup), 0.900 = -5% (stacked).
  const raw = 1 - (oppOps - LEAGUE_OPS) * 0.4;
  const multiplier = clamp(raw, 0.93, 1.05);
  const summary =
    oppOps <= 0.690 ? 'Easy platoon'
    : oppOps <= 0.730 ? 'Neutral platoon'
    : 'Tough platoon';

  return {
    multiplier,
    deltaPct: (multiplier - 1) * 100,
    display: oppOps.toFixed(3).replace(/^0\./, '.'),
    summary,
    available: true,
  };
}

/**
 * Park multiplier on offense suppression — for the pitcher this is
 * inverted (extreme-pitcher park BOOSTS pitcher rating). Delegates to
 * the canonical `getParkAdjustment` primitive (composite path) so a
 * pitcher rating @ Coors and a batter rating @ Coors share the same
 * underlying park math. Wind-sensitive parks (Wrigley, Oracle, Sutter)
 * apply an extra wind tilt at this layer too.
 */
function buildParkMultiplier(
  park: ParkData | null,
  weather: GameWeather | null,
): ContextMultiplier {
  if (!park) {
    return {
      multiplier: 1.0, deltaPct: 0, display: '—',
      summary: 'No park data', available: false,
    };
  }
  const adj = getParkAdjustment({ park, weather });
  const pf = park.parkFactor;
  const pfHr = park.parkFactorHR;
  const display = Math.abs(pfHr - 100) > Math.abs(pf - 100) ? pfHr : pf;

  return {
    multiplier: adj.multiplier,
    deltaPct: (adj.multiplier - 1) * 100,
    display: `PF ${display}`,
    summary: adj.hint || 'Neutral park',
    available: true,
  };
}

function buildWeatherMultiplier(game: EnrichedGame, park: ParkData | null): ContextMultiplier {
  const weatherScore = getWeatherScore(game, park); // 0 = boost offense, 1 = suppress
  const display = formatWeatherDisplay(game.weather);
  const available = display !== '—';

  // Weather: 0 → 0.94 (offense boost = bad for pitcher), 1 → 1.06.
  const multiplier = clamp(0.94 + weatherScore * 0.12, 0.94, 1.06);
  const summary =
    weatherScore >= 0.65 ? 'Offense suppressed'
    : weatherScore <= 0.35 ? 'Offense boosted'
    : 'Neutral conditions';

  return {
    multiplier,
    deltaPct: (multiplier - 1) * 100,
    display,
    summary,
    available,
  };
}

function formatWeatherDisplay(w: GameWeather): string {
  const parts: string[] = [];
  if (w.temperature != null) parts.push(`${w.temperature}°`);
  if (w.windSpeed != null && w.windSpeed > 0 && w.windDirection) {
    parts.push(`${w.windSpeed}mph ${w.windDirection.toLowerCase().includes('out') ? 'out' : w.windDirection.toLowerCase().includes('in') ? 'in' : 'cross'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * Opponent lineup display multiplier — same OPS slice the per-PA path uses
 * (`vsLeft` / `vsRight` from the starter's throwing hand), not season
 * overall team OPS. Overall OPS made SD-type offenses look "soft" in
 * the breakdown while K/BB/contact were adjusted off the tougher split.
 */
function buildOppMultiplier(
  opp: TeamOffense | null,
  throws: PitcherTalent['throws'],
): ContextMultiplier {
  const ops =
    throws === 'L' ? opp?.vsLeft?.ops ?? opp?.ops ?? null
    : throws === 'R' ? opp?.vsRight?.ops ?? opp?.ops ?? null
    : opp?.ops ?? null;

  if (!opp || ops == null) {
    return {
      multiplier: 1.0, deltaPct: 0, display: '—',
      summary: 'No opponent data', available: false,
    };
  }
  // 0.650 OPS = +6% (weak), 0.770 OPS = -6% (strong).
  const multiplier = clamp(1 - (ops - LEAGUE_OPS) * 0.6, 0.92, 1.08);
  const summary =
    ops <= 0.685 ? 'Weak lineup'
    : ops >= 0.745 ? 'Strong lineup'
    : 'Average lineup';

  return {
    multiplier,
    deltaPct: (multiplier - 1) * 100,
    display: ops.toFixed(3).replace(/^0\./, '.'),
    summary,
    available: true,
  };
}

/**
 * Bullpen multiplier — used ONLY inside Wins probability. Bad bullpens
 * blow leads; good bullpens lock them. Currently uses team staff ERA
 * as a proxy for relief ERA (~0.7 correlation in practice).
 */
function buildBullpenMultiplier(game: EnrichedGame, isHome: boolean): ContextMultiplier {
  const ownStaffEra = (isHome ? game.homeTeam.staffEra : game.awayTeam.staffEra) ?? null;
  if (ownStaffEra == null) {
    return {
      multiplier: 1.0, deltaPct: 0, display: '—',
      summary: 'No bullpen data', available: false,
    };
  }
  // 5.00 ERA = -8% on W odds, 3.40 ERA = +8% on W odds.
  const multiplier = clamp(1 - (ownStaffEra - 4.20) * 0.10, 0.90, 1.10);
  const summary =
    ownStaffEra <= 3.60 ? 'Elite bullpen'
    : ownStaffEra >= 4.60 ? 'Shaky bullpen'
    : 'Average bullpen';

  return {
    multiplier,
    deltaPct: (multiplier - 1) * 100,
    display: `${ownStaffEra.toFixed(2)}`,
    summary,
    available: true,
  };
}

// ---------------------------------------------------------------------------
// Public: build the forecast
// ---------------------------------------------------------------------------

export function buildGameForecast(args: BuildForecastArgs): GameForecast {
  const { pitcher, game, isHome, opposingOffense, opposingPitcher } = args;
  const park = game.park ?? null;

  // ============================================================
  // Per-PA rate computation
  //
  // Architecture rule (post-2026-05): every stat-specific signal
  // (opp, park, weather) lives at the per-PA layer. Composite-level
  // multipliers carry only matchup-wide factors that scale every
  // category proportionally (velocity, platoon).
  //
  // The full chain for each per-PA rate:
  //   talent → opp adj → park adj → weather adj → in-game value
  // ============================================================

  // ----- Opponent factors (read once, applied below) ----------------------
  const oppK = pitcher.throws === 'L'
    ? opposingOffense?.vsLeft?.strikeOutRate ?? opposingOffense?.strikeOutRate ?? null
    : opposingOffense?.vsRight?.strikeOutRate ?? opposingOffense?.strikeOutRate ?? null;
  const oppOps = pitcher.throws === 'L'
    ? opposingOffense?.vsLeft?.ops ?? opposingOffense?.ops ?? null
    : opposingOffense?.vsRight?.ops ?? opposingOffense?.ops ?? null;
  /** Opponent OPS-vs-hand factor relative to league. > 1 = stronger lineup
   *  (more BB, more contact value); < 1 = weaker lineup. Clamped ±15%. */
  const oppOpsFactor = oppOps != null
    ? clamp(1 + (oppOps - LEAGUE_OPS) * 1.0, 0.85, 1.15)
    : 1.0;

  // ----- Park adjustments (per-stat tracks) -------------------------------
  // Each track is gated by stat-id: SO, BB, HR, and overall (for non-HR
  // contact value). The wind-amplification adder fires inside getParkAdjustment
  // for HR/2B/R/RBI tracks in wind-sensitive parks (Wrigley/Oracle/Sutter).
  const parkSoAdj = getParkAdjustment({ park, statId: 21, weather: game.weather });
  const parkBbAdj = getParkAdjustment({ park, statId: 18, weather: game.weather });
  const parkHrAdj = getParkAdjustment({ park, statId: 12, weather: game.weather });
  /** Overall hitter friendliness — drives the BABIP-like adjustment to
   *  non-HR contact value. Reads `parkFactor` (overall wOBA index) via
   *  the AVG track (statId 3) without batter-hand resolution. */
  const parkOverallAdj = getParkAdjustment({ park, statId: 3, weather: game.weather });

  // ----- Weather offense factor (0 = suppress, 1 = boost) -----------------
  const weatherScore = getWeatherScore(game, park); // 0=suppress, 1=boost
  /** Weather contact-value multiplier: maps weatherScore 0..1 → 0.96..1.04
   *  on contact-quality (4% swing). Only applied to non-HR contact value
   *  and HR rate; not to K/BB. */
  const weatherContactFactor = clamp(0.96 + weatherScore * 0.08, 0.96, 1.04);
  /** Weather HR multiplier — separate, larger swing for HR specifically.
   *  Wind out + warm air helps balls carry; wind in + cold suppresses. */
  const weatherHrFactor = clamp(0.92 + weatherScore * 0.16, 0.92, 1.08);

  // ----- gbRate × parkHR gating -------------------------------------------
  // A ground-ball pitcher in Coors gets less of the park HR boost than a
  // flyball pitcher, because their balls don't reach the fences. Maps
  // gbRate ∈ [.30, .60] → gbBoost ∈ [0, 0.5]; the effective parkHR
  // adjustment is `1 + (parkHrAdj - 1) × (1 - gbBoost)`. A 60%-GB arm
  // gets half the HR-park bump; a 30%-GB arm gets the full bump.
  const gbBoost = clamp((pitcher.gbRate - 0.30) / (0.60 - 0.30) * 0.5, 0, 0.5);
  const effectiveParkHrMult = 1 + (parkHrAdj.multiplier - 1) * (1 - gbBoost);

  // ----- In-game per-PA rates ---------------------------------------------
  /** K/PA — log5 against opp K-rate, then × parkSO. (No weather term: K
   *  rate is largely temperature/wind-independent.) */
  const kPerPABase = oppK != null
    ? log5(pitcher.kPerPA, oppK, LEAGUE_OPS_K_RATE)
    : pitcher.kPerPA;
  const kPerPA = kPerPABase * parkSoAdj.multiplier;

  /** BB/PA — base × oppOps × parkBB. Opp lineups with more discipline
   *  (high OPS) draw more walks; pitcher parks reduce walks slightly
   *  (pitcher generally pitches ahead in better counts). */
  const bbPerPA = pitcher.bbPerPA * oppOpsFactor * parkBbAdj.multiplier;

  /** HR/PA — talent's HR/contact × in-game contactRate × gb-gated parkHR
   *  × weather. The gb-gating is the single biggest park-HR refinement:
   *  a Skubal-type GB arm in Yankee Stadium gets nothing close to the
   *  +18% park bump; a Cole-type FB arm gets nearly all of it. */
  const inGameContactRate = Math.max(0, 1 - kPerPA - bbPerPA);
  const baseHrPerPA = pitcher.hrPerContact * inGameContactRate;
  const hrPerPA = baseHrPerPA * effectiveParkHrMult * weatherHrFactor;

  /** Non-HR contact value (xwOBA on contact, HR-removed). The talent's
   *  base value gets a BABIP-like adjustment from overall park factor
   *  + weather + opp OPS. This is what makes Coors's overall hitter
   *  friendliness propagate into ERA / WHIP / W via the chain (rather
   *  than living only as a dangling composite multiplier). */
  const baseNonHrContactValue = talentNonHrContactXwoba(pitcher);
  const nonHrContactValue = baseNonHrContactValue
    * oppOpsFactor
    * parkOverallAdj.multiplier
    * weatherContactFactor;

  /** In-game contactXwoba (HR-inclusive, for downstream consumers like
   *  the batter-side AVG log5 against this SP). Re-composed from the
   *  in-game non-HR contact value plus the in-game HR rate.
   *
   *   contactXwoba = (HR/BIP × wHR + nonHR/BIP × nonHrXwoba)
   */
  const W_HR = 1.97;
  const hrFractionInContact = inGameContactRate > 0 ? hrPerPA / inGameContactRate : 0;
  const contactXwoba = hrFractionInContact * W_HR
                     + (1 - hrFractionInContact) * nonHrContactValue;

  /** BAA — derived from in-game contact xwOBA (HR-inclusive). Used by
   *  batter-side log5 vs SP's BAA for the AVG cat AND by the WHIP / hits
   *  derivation below.
   *
   *  Multiplier 1.5 matches the empirical league-mean ratio: 2024 MLB
   *  league xwOBACON ≈ .368, BAA ≈ .246, ratio = 1.50. The previous
   *  multiplier of 1.4 systematically overstated BAA by ~7% across all
   *  pitchers, which had been compensating for a separate hits/PA bug
   *  (see `expectedH` below) — now that both are corrected, league-avg
   *  hits/PA matches reality within rounding. The ratio drifts at the
   *  tails (~1.6-1.8 for elite contact suppressors, ~1.4 for high-
   *  damage profiles); single-multiplier model doesn't fit both ends
   *  perfectly, but 1.5 is closer to empirical center. */
  const baa = contactXwoba / 1.5;

  // ----- xwOBA-allowed and ERA --------------------------------------------
  /** Compose xwOBA from the explicit linear-weights form. HR is now
   *  carried as its own term so park HR / gbRate / weather all flow
   *  into expectedERA via this single composition. */
  const xwobaAllowed = composeAdjustedXwobaAllowed({
    bbPerPA, kPerPA, hrPerPA, nonHrContactValue,
  });
  /** Base xERA from linear weights. Captures the *average* run value
   *  of each event (BB at 0.69 wOBA, HR at 1.97). Calibrated against
   *  the population, where most pitchers walk 8% — this works well
   *  near the mean but understates ER risk for high-walk pitchers,
   *  whose walks compound (multi-runner situations, errors / wp / sb
   *  more impactful) in ways linear weights collapse to a constant.
   *
   *  See `bbCompoundingPenalty` below. The penalty is 0 at league-mean
   *  BB% and grows as walk rate departs from the population — so
   *  population-mean pitchers are unaffected, while a 15% BB rate
   *  pitcher's expected ERA gets the runner-stacking damage that
   *  pure linear weights miss. Calibration anchor: empirically,
   *  pitchers walking 15% run ~0.7 ERA above their xERA on average. */
  const expectedERA = xwobaToXera(xwobaAllowed) + bbCompoundingPenalty(bbPerPA);

  // ----- Per-game expected counts -----------------------------------------
  const oppWorkloadFactor = oppOps != null
    ? clamp(1 - (oppOps - LEAGUE_OPS) * 1.0, 0.85, 1.10)
    : 1.0;
  const expectedIp = pitcher.ipPerStart * oppWorkloadFactor;
  const paPerInning = 4.3 + (oppOps != null ? (oppOps - LEAGUE_OPS) * 1.5 : 0);
  const expectedPa = expectedIp * paPerInning;

  const expectedK = expectedPa * kPerPA;
  const expectedBB = expectedPa * bbPerPA;
  const expectedHR = expectedPa * hrPerPA;
  const expectedER = expectedERA * expectedIp / 9;
  /** Hits = PA × (1 − BB/PA) × BAA.
   *
   *  Standard BAA is hits/AB, where AB = PA − BB − HBP − sac. So
   *  hits/PA = BAA × (AB/PA) ≈ BAA × (1 − BB/PA). The previous formula
   *  used `contactRate × baa` = `(1 − K/PA − BB/PA) × BAA`, which double-
   *  discounted strikeouts (BAA already accounts for K's by including
   *  them in AB) and systematically undercounted hits by ~19% at league
   *  mean — biggest impact on high-K pitchers, which is why the cluster
   *  at ~1.20 WHIP showed up across so many starter projections regardless
   *  of underlying quality.
   *
   *  HR is included in BAA (and in xwOBACON), so this hit count includes
   *  HR — which is correct for WHIP (HR counts as a hit). */
  const expectedH = expectedPa * (1 - bbPerPA) * baa;

  // ----- Probabilities ----------------------------------------------------
  // QS: P(IP ≥ 6 AND ER ≤ 3). Heuristic on IP and expectedERA. Now that
  // expectedERA includes park/opp/weather, QS odds respond to context too
  // (a tough park dampens an ace's QS probability, etc.).
  const ipFactor = clamp((expectedIp - 4.5) / 1.5, 0, 1);
  const eraFactor = clamp((4.50 - expectedERA) / 2.50, 0, 1);
  const qs = clamp01(0.5 * ipFactor + 0.5 * eraFactor);

  // W: pitcher talent vs opposing SP talent + bullpen + home/away.
  // talent diff is computed from the un-adjusted talent xwOBAs (it's
  // a relative measure of skill; we don't want park to swing W odds via
  // BOTH our SP's xwoba going up AND the opposing SP's going up — they
  // cancel for the talent-diff, then bullpen and home/away add).
  const ourTalentXwoba = composeXwobaAllowed(pitcher);
  const oppPitcherTalentDiff = opposingPitcher
    ? ourTalentXwoba - composeXwobaAllowed(opposingPitcher)
    : 0;
  const talentDiff = clamp(-oppPitcherTalentDiff / 0.04 * 0.15, -0.15, 0.15);
  const bullpen = buildBullpenMultiplier(game, isHome);
  const bullpenAdjust = (bullpen.multiplier - 1) * 0.5;
  const homeAdj = isHome ? 0.025 : -0.025;
  const w = clamp01(0.40 + talentDiff + bullpenAdjust + homeAdj);

  // ----- Surface multipliers (display only — already folded in above) ----
  // These are computed for the breakdown UI to show the user WHY their
  // pitcher's score landed where it did. They are NOT applied to the
  // composite score in rating.ts — every signal is already in the per-PA
  // chain above. Architecture rule: the only composite-level multipliers
  // are matchup-wide signals that scale every category proportionally
  // (velocity, platoon).
  const velocity = buildVelocityMultiplier(pitcher);
  const platoon = buildPlatoonMultiplier(pitcher, opposingOffense);
  const parkMult = buildParkMultiplier(park, game.weather);
  const weather = buildWeatherMultiplier(game, park);
  const opp = buildOppMultiplier(opposingOffense, pitcher.throws);

  return {
    pitcher,
    game,
    isHome,
    xwobaAllowed,
    expectedERA,
    expectedPerPA: { kPerPA, bbPerPA, hrPerPA, contactXwoba, baa },
    expectedPerGame: {
      ip: expectedIp,
      pa: expectedPa,
      k: expectedK,
      bb: expectedBB,
      er: expectedER,
      h: expectedH,
      hr: expectedHR,
    },
    probabilities: { qs, w },
    multipliers: { velocity, platoon, park: parkMult, weather, opp, bullpen },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log5(rateA: number, rateB: number, leagueRate: number): number {
  if (leagueRate <= 0 || leagueRate >= 1) return rateA;
  const num = (rateA * rateB) / leagueRate;
  const den = num + ((1 - rateA) * (1 - rateB)) / (1 - leagueRate);
  if (den <= 0) return rateA;
  return num / den;
}

/**
 * BB-stacking damage that linear-weights xwOBA undercounts.
 *
 * xwOBA's BB linear weight (0.69) is the average run value of *one*
 * walk in isolation. For pitchers with elevated walk rates, the run
 * value of walks #2, #3, etc. in an inning is higher than walk #1 —
 * runners are already on, errors / wild pitches / SBs cause more
 * damage, and wOBA's linear-additivity assumption collapses these
 * compounding effects to a constant. The xwOBA → xERA conversion
 * (slope 25, anchored at population mean BB ≈ .085) inherits this
 * miscalibration: it's accurate near the population mean but understates
 * ER risk for high-walk pitchers.
 *
 * Empirical anchor: across the MLB pitcher distribution, pitchers
 * walking 12% run roughly +0.35 ERA above their xERA on average;
 * pitchers walking 15% run roughly +0.65 ERA above. The slope of 10
 * matches that anchor when measured linearly above the league mean.
 * Capped at +1.0 ERA so a pathological 18%+ walk pitcher doesn't get
 * a runaway penalty (real-world selection bias removes such pitchers
 * from rotations before the model needs to handle them).
 *
 * Returns 0 ERA points for pitchers at or below league-mean BB rate —
 * so this is a one-sided correction that affects only the tail. The
 * average pitcher is unaffected; this fix only kicks in for the
 * Lopez-shaped profiles where the linear-weights model's miscalibration
 * matters for fantasy-decision purposes.
 */
function bbCompoundingPenalty(bbPerPA: number): number {
  const LEAGUE_BB = 0.085;
  const SLOPE = 10;
  const CAP = 1.0;
  return clamp((bbPerPA - LEAGUE_BB) * SLOPE, 0, CAP);
}
