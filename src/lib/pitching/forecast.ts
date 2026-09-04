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
  LEAGUE_IP_PER_START,
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
    /** P(W) decomposition — P(team win) × P(SP credited | team win) and
     *  the run rates behind the win odds. Snapshot into the ledger's
     *  context so the next calibration pass can grade each part instead
     *  of reverse-engineering the total (the 2026-07 pass couldn't). */
    wParts: {
      pTeam: number;
      credit: number;
      /** Expected runs scored / allowed per 9 for the pitcher's side. */
      rs: number;
      ra: number;
      /** False when run support fell back to league-average (no own-team
       *  offense supplied — deliberate in L6 neutral paths). */
      ownOffenseKnown: boolean;
    };
  };
  multipliers: {
    velocity: ContextMultiplier;
    platoon: ContextMultiplier;
    park: ContextMultiplier;
    weather: ContextMultiplier;
    opp: ContextMultiplier;
    /** Bullpen — breakdown-UI + ledger knob-attribution surface only.
     *  Not folded into the Layer 3 composite (per architecture decision
     *  a1: bullpen affects only Wins), and since 2026-07-25 the Wins
     *  odds price both pens directly in run units (see `probabilities.
     *  wParts`) rather than through this multiplier. */
    bullpen: ContextMultiplier;
  };
  /** Per-stat modifier attribution — see `PitcherModifierKnobs`. */
  knobs: PitcherModifierKnobs;
}

/** The forecast quantities a knob can touch: per-PA rates (k/bb/hr/h), the
 *  per-9 ERA rate (er) and the two volume terms (ip/pa). */
export type PitcherKnobStat = 'k' | 'bb' | 'hr' | 'h' | 'er' | 'ip' | 'pa';

/**
 * Per-stat modifier attribution (2026-09-04): each L2 knob as the effective
 * multiplier it applied to each forecast rate, knob-first (`knobs.opp.k`,
 * `knobs.park.hr`) — the pitcher twin of `BatterModifierKnobs`. Attribution
 * is sequential along the chain the engine actually runs, talent → opp →
 * park → weather: a knob's value for a stat is that stat's rate after the
 * knob's stage divided by its rate before it, so the product over knobs
 * equals in-game rate ÷ talent rate exactly, cross-terms included (opp K/BB
 * move the contact rate that HR and hits ride on; that lands on `opp`).
 * Only the knobs that touch a stat are present. `platoon`, `velocity` and
 * `bullpen` are absent on purpose: none of them enters a graded stat line
 * (platoon scales only the L3 composite, velocity is a fixed 1.0, bullpen
 * prices W through `wParts`), and platoon is the same OPS-vs-hand scalar
 * `opp` reads, so a column for it could never be separated from `opp`.
 * Stamped into ledger snapshots (`context.knobs`) for the per-knob fit —
 * docs/forecast-verification.md#snapshot-context.
 */
export interface PitcherModifierKnobs {
  /** Opposing lineup vs the pitcher's hand: K via log5 on the opp K rate,
   *  BB / non-HR contact via the OPS factor, HR and H through the contact
   *  rate those move; IP via the workload factor, PA via workload × PA/inning. */
  opp?: Partial<Record<PitcherKnobStat, number>>;
  /** Park tracks: SO, BB, gb-gated HR (incl. the wind adder in wind-sensitive
   *  parks), overall wOBA on non-HR contact; ER inherits all four. */
  park?: Partial<Record<PitcherKnobStat, number>>;
  /** Weather on HR and non-HR contact value (never K/BB); ER inherits both. */
  weather?: Partial<Record<PitcherKnobStat, number>>;
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
   *  Prices the run-scoring side of the Wins odds. Null when TBD →
   *  league-average anchor. */
  opposingPitcher: PitcherTalent | null;
  /** The pitcher's OWN team's offense — run support for the Wins odds.
   *  Optional: omit/null = league-average support (deliberate in the L6
   *  neutral/matchup-vacuum paths, a data gap everywhere else). */
  ownOffense?: TeamOffense | null;
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

/** League-average opponent K-rate per PA. Anchors the log5 baseline for
 *  K matchup adjustments — same denominator and value as LEAGUE_K_RATE
 *  in `talentModel.ts` (2026 MLB season aggregate ≈ .222), and the same
 *  denominator as `TeamOffense.strikeOutRate` (per-PA since 2026-07 —
 *  see docs/history.md "Ledger-driven calibration fixes"). */
const LEAGUE_OPS_K_RATE = 0.221;

/** League-average batters faced per inning; the opposing lineup's OPS tilts
 *  it by 1.5 PA/inning per OPS unit in `buildGameForecast`. */
const PA_PER_INNING_BASE = 4.3;

/** P(QS) shrink anchors + P(W) model anchors. Ledger-calibrated
 *  2026-07-25 against the first 188 graded starts — rationale and
 *  sourcing per constant: docs/unified-rating-model.md#start-probabilities. */
const QS_BASE = 0.40;
const QS_SPREAD = 0.55;
/** League ERA anchor for missing pens / TBD opposing SPs — same center
 *  as `xwobaToXera` (.318 xwOBA → 4.20). */
const LEAGUE_ERA_ANCHOR = 4.20;
/** MLB Pythagorean exponent (Bill James; Pythagenpat ≈ 1.83 at MLB
 *  run environments). */
const PYTH_EXP = 1.83;
/** Long-run MLB home win rate ≈ .540, expressed as odds. */
const HOME_ODDS = 0.54 / 0.46;
/** P(SP credited | team win) at a league-average 5.4-IP projection, and
 *  its slope per projected IP (must complete 5 and leave with the lead —
 *  deeper starts hold credit more often). Slope is estimated, not
 *  hard-sourced; the ledger's wParts grading will check it. */
const W_CREDIT_BASE = 0.64;
const W_CREDIT_PER_IP = 0.10;

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

  // Platoon is unknowable without the pitcher's hand — there's no "weaker
  // side" to stack against. Unknown hand (null) falls through to the
  // oppOps == null guard below and reports as unavailable rather than
  // silently grading the matchup as if the pitcher were a righty.
  const handLabel =
    pitcher.throws === 'L' ? 'vs LHP'
    : pitcher.throws === 'R' ? 'vs RHP'
    : 'hand TBD';
  const oppOps =
    pitcher.throws === 'L' ? opp.vsLeft?.ops ?? opp.ops
    : pitcher.throws === 'R' ? opp.vsRight?.ops ?? opp.ops
    : null;
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

/** Relief-only ERA with staff-wide fallback (first cold start of the
 *  season may lack splits). Null when the team has no staff data at all. */
function rpEraOf(team: EnrichedGame['homeTeam']): number | null {
  return team.staffSplits?.rp?.era ?? team.staffEra ?? null;
}

/**
 * Team-offense OPS → run-rate factor for the Wins odds. Cross-team
 * season regressions put runs/game ≈ linear in OPS with a slope of
 * ~3% of league scoring per 10 OPS points (coefficient ~3 per OPS
 * unit); clamps sit at the best/worst real MLB team offenses (±20%).
 * See docs/unified-rating-model.md#start-probabilities.
 */
function runsFactor(ops: number | null): number {
  if (ops == null) return 1.0;
  return clamp(1 + (ops - LEAGUE_OPS) * 3.0, 0.80, 1.20);
}

/**
 * Bullpen multiplier — DISPLAY + ledger knob-attribution only since
 * 2026-07-25. Bad bullpens blow leads; good bullpens lock them. The
 * Wins odds now price both pens directly in run units (`rpEraOf`
 * inside the P(W) block); this ContextMultiplier survives as the
 * breakdown-UI surface and the captured `mults.bullpen` knob.
 *
 * Anchor: 4.20 ERA = neutral, ±0.10 multiplier at the clamp edges.
 * Bullpen ERA scale runs slightly hotter than overall staff ERA, but
 * the clamp range absorbs the small offset and the per-team baseline
 * is still ~4.10-4.20 — same calibration as the staffEra path.
 */
function buildBullpenMultiplier(game: EnrichedGame, isHome: boolean): ContextMultiplier {
  const ownTeam = isHome ? game.homeTeam : game.awayTeam;
  const era = rpEraOf(ownTeam);

  if (era == null) {
    return {
      multiplier: 1.0, deltaPct: 0, display: '—',
      summary: 'No bullpen data', available: false,
    };
  }

  const multiplier = clamp(1 - (era - 4.20) * 0.10, 0.90, 1.10);
  const summary =
    era <= 3.60 ? 'Elite bullpen'
    : era >= 4.60 ? 'Shaky bullpen'
    : 'Average bullpen';

  return {
    multiplier,
    deltaPct: (multiplier - 1) * 100,
    display: era.toFixed(2),
    summary,
    available: true,
  };
}

// ---------------------------------------------------------------------------
// Public: build the forecast
// ---------------------------------------------------------------------------

export function buildGameForecast(args: BuildForecastArgs): GameForecast {
  const { pitcher, game, isHome, opposingOffense, opposingPitcher, ownOffense = null } = args;
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
  // Unknown hand (null) uses the bats-agnostic overall opponent rate rather
  // than defaulting to the vs-RHP split.
  const oppK =
    pitcher.throws === 'L' ? opposingOffense?.vsLeft?.strikeOutRate ?? opposingOffense?.strikeOutRate ?? null
    : pitcher.throws === 'R' ? opposingOffense?.vsRight?.strikeOutRate ?? opposingOffense?.strikeOutRate ?? null
    : opposingOffense?.strikeOutRate ?? null;
  const oppOps =
    pitcher.throws === 'L' ? opposingOffense?.vsLeft?.ops ?? opposingOffense?.ops ?? null
    : pitcher.throws === 'R' ? opposingOffense?.vsRight?.ops ?? opposingOffense?.ops ?? null
    : opposingOffense?.ops ?? null;
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
  // The chain itself lives in `rateChain` (below) so the per-stat knob
  // attribution can re-run it one stage at a time; the fully-loaded call
  // here IS the forecast.
  const factors: RateChainFactors = {
    oppK,
    oppOpsFactor,
    parkSo: parkSoAdj.multiplier,
    parkBb: parkBbAdj.multiplier,
    parkHr: effectiveParkHrMult,
    parkOverall: parkOverallAdj.multiplier,
    weatherContact: weatherContactFactor,
    weatherHr: weatherHrFactor,
  };
  const chain = rateChain(pitcher, factors);
  const { kPerPA, bbPerPA, hrPerPA, contactXwoba, baa, xwobaAllowed, expectedERA } = chain;

  // ----- Per-game expected counts -----------------------------------------
  const oppWorkloadFactor = oppOps != null
    ? clamp(1 - (oppOps - LEAGUE_OPS) * 1.0, 0.85, 1.10)
    : 1.0;
  const expectedIp = pitcher.ipPerStart * oppWorkloadFactor;
  const paPerInning = PA_PER_INNING_BASE + (oppOps != null ? (oppOps - LEAGUE_OPS) * 1.5 : 0);
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
  // (a tough park dampens an ace's QS probability, etc.). The raw 0-1
  // heuristic is over-spread — its middle is honest but its tails aren't —
  // so it's shrunk toward the league QS base before use. Evidence +
  // anchors: docs/unified-rating-model.md#start-probabilities.
  const ipFactor = clamp((expectedIp - 4.5) / 1.5, 0, 1);
  const eraFactor = clamp((4.50 - expectedERA) / 2.50, 0, 1);
  const rawQs = 0.5 * ipFactor + 0.5 * eraFactor;
  const qs = clamp01(QS_BASE + QS_SPREAD * (rawQs - QS_BASE));

  // W: P(team wins) × P(SP credited | team win), both sides priced in
  // runs. Replaced the additive talent-nudge formula 2026-07-25 after
  // the ledger graded its spread as noise (n=188, slope ~0.1, AUC 0.52) —
  // wins hinge on run support and game context far more than SP-vs-SP
  // talent. Talent ERAs enter context-free: park/weather inflate both
  // sides of the same game and roughly cancel in the win odds, while
  // lineup quality is side-specific and enters via run factors.
  // Anchors + evidence: docs/unified-rating-model.md#start-probabilities.
  const ourTalentXwoba = composeXwobaAllowed(pitcher);
  const ownPenEra = rpEraOf(isHome ? game.homeTeam : game.awayTeam) ?? LEAGUE_ERA_ANCHOR;
  const oppPenEra = rpEraOf(isHome ? game.awayTeam : game.homeTeam) ?? LEAGUE_ERA_ANCHOR;

  // Runs allowed per 9 while we pitch: our SP's talent ERA over his
  // expected innings, our pen for the rest, the opposing lineup's run
  // factor (OPS vs our hand — `oppOps`, read at the top) on the whole.
  const ra = ((xwobaToXera(ourTalentXwoba) * expectedIp
    + ownPenEra * Math.max(0, 9 - expectedIp)) / 9) * runsFactor(oppOps);

  // Runs scored per 9 — the run-support side the old formula assumed
  // average: opposing SP talent (league anchor when TBD) over a league-
  // average start, their pen after, our own offense's run factor (OPS
  // vs the opposing SP's hand) on the whole.
  const oppSpEra = opposingPitcher
    ? xwobaToXera(composeXwobaAllowed(opposingPitcher))
    : LEAGUE_ERA_ANCHOR;
  const ownOps =
    opposingPitcher?.throws === 'L' ? ownOffense?.vsLeft?.ops ?? ownOffense?.ops ?? null
    : opposingPitcher?.throws === 'R' ? ownOffense?.vsRight?.ops ?? ownOffense?.ops ?? null
    : ownOffense?.ops ?? null;
  const rs = ((oppSpEra * LEAGUE_IP_PER_START
    + oppPenEra * (9 - LEAGUE_IP_PER_START)) / 9) * runsFactor(ownOps);

  // Pythagorean win odds + the long-run home edge, capped to the range
  // real single-game MLB win probabilities live in (~.28-.72; the
  // biggest moneyline favorites sit around −300).
  const teamOdds = Math.pow(rs / ra, PYTH_EXP) * (isHome ? HOME_ODDS : 1 / HOME_ODDS);
  const pTeam = clamp(teamOdds / (1 + teamOdds), 0.28, 0.72);

  const credit = clamp(
    W_CREDIT_BASE + W_CREDIT_PER_IP * (expectedIp - LEAGUE_IP_PER_START),
    0.52, 0.78,
  );
  const w = clamp(pTeam * credit, 0.10, 0.55);
  const wParts = { pTeam, credit, rs, ra, ownOffenseKnown: ownOps != null };
  const bullpen = buildBullpenMultiplier(game, isHome);

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

  // ----- Per-stat knob attribution (see PitcherModifierKnobs) -------------
  // Re-run the rate chain with the stages switched on cumulatively; each
  // knob is the ratio between consecutive stages. `chain` is stage 3.
  const stage0 = rateChain(pitcher, NEUTRAL_FACTORS);
  const stage1 = rateChain(pitcher, { ...NEUTRAL_FACTORS, oppK, oppOpsFactor });
  const stage2 = rateChain(pitcher, { ...factors, weatherContact: 1, weatherHr: 1 });
  const ratio = (after: number, before: number) =>
    before > 1e-12 && Number.isFinite(after / before) ? after / before : 1;
  const knobs: PitcherModifierKnobs = {
    opp: {
      k: ratio(stage1.kPerPA, stage0.kPerPA),
      bb: ratio(stage1.bbPerPA, stage0.bbPerPA),
      hr: ratio(stage1.hrPerPA, stage0.hrPerPA),
      h: ratio(stage1.hPerPA, stage0.hPerPA),
      er: ratio(stage1.expectedERA, stage0.expectedERA),
      ip: oppWorkloadFactor,
      pa: ratio(expectedPa, pitcher.ipPerStart * PA_PER_INNING_BASE),
    },
    park: {
      k: ratio(stage2.kPerPA, stage1.kPerPA),
      bb: ratio(stage2.bbPerPA, stage1.bbPerPA),
      hr: ratio(stage2.hrPerPA, stage1.hrPerPA),
      h: ratio(stage2.hPerPA, stage1.hPerPA),
      er: ratio(stage2.expectedERA, stage1.expectedERA),
    },
    weather: {
      hr: ratio(chain.hrPerPA, stage2.hrPerPA),
      h: ratio(chain.hPerPA, stage2.hPerPA),
      er: ratio(chain.expectedERA, stage2.expectedERA),
    },
  };

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
    probabilities: { qs, w, wParts },
    multipliers: { velocity, platoon, park: parkMult, weather, opp, bullpen },
    knobs,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Context factors the per-PA chain multiplies onto talent. Neutral = 1
 *  (and no opponent K rate). */
interface RateChainFactors {
  oppK: number | null;
  oppOpsFactor: number;
  parkSo: number;
  parkBb: number;
  /** gb-gated effective park HR multiplier. */
  parkHr: number;
  parkOverall: number;
  weatherContact: number;
  weatherHr: number;
}

interface RateChain {
  kPerPA: number;
  bbPerPA: number;
  hrPerPA: number;
  inGameContactRate: number;
  nonHrContactValue: number;
  contactXwoba: number;
  baa: number;
  /** Hits per PA = (1 − BB/PA) × BAA — see `expectedH` for the derivation. */
  hPerPA: number;
  xwobaAllowed: number;
  expectedERA: number;
}

const NEUTRAL_FACTORS: RateChainFactors = {
  oppK: null, oppOpsFactor: 1, parkSo: 1, parkBb: 1, parkHr: 1, parkOverall: 1, weatherContact: 1, weatherHr: 1,
};

/**
 * The per-PA rate chain: talent → opp adj → park adj → weather adj → in-game
 * value, for one set of factors. Factored out of `buildGameForecast` so the
 * per-stat knob attribution can run the identical code with the stages
 * switched on one at a time — the fully-loaded call is the production
 * forecast, so attribution can never drift from what is forecast.
 */
function rateChain(pitcher: PitcherTalent, f: RateChainFactors): RateChain {
  /** K/PA — log5 against opp K-rate, then × parkSO. (No weather term: K
   *  rate is largely temperature/wind-independent.) */
  const kPerPABase = f.oppK != null
    ? log5(pitcher.kPerPA, f.oppK, LEAGUE_OPS_K_RATE)
    : pitcher.kPerPA;
  const kPerPA = kPerPABase * f.parkSo;

  /** BB/PA — base × oppOps × parkBB. Opp lineups with more discipline
   *  (high OPS) draw more walks; pitcher parks reduce walks slightly
   *  (pitcher generally pitches ahead in better counts). */
  const bbPerPA = pitcher.bbPerPA * f.oppOpsFactor * f.parkBb;

  /** HR/PA — talent's HR/contact × in-game contactRate × gb-gated parkHR
   *  × weather. The gb-gating is the single biggest park-HR refinement:
   *  a Skubal-type GB arm in Yankee Stadium gets nothing close to the
   *  +18% park bump; a Cole-type FB arm gets nearly all of it. */
  const inGameContactRate = Math.max(0, 1 - kPerPA - bbPerPA);
  const baseHrPerPA = pitcher.hrPerContact * inGameContactRate;
  const hrPerPA = baseHrPerPA * f.parkHr * f.weatherHr;

  /** Non-HR contact value (xwOBA on contact, HR-removed). The talent's
   *  base value gets a BABIP-like adjustment from overall park factor
   *  + weather + opp OPS. This is what makes Coors's overall hitter
   *  friendliness propagate into ERA / WHIP / W via the chain (rather
   *  than living only as a dangling composite multiplier). */
  const baseNonHrContactValue = talentNonHrContactXwoba(pitcher);
  const nonHrContactValue = baseNonHrContactValue
    * f.oppOpsFactor
    * f.parkOverall
    * f.weatherContact;

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
  const hPerPA = (1 - bbPerPA) * baa;

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

  return {
    kPerPA, bbPerPA, hrPerPA, inGameContactRate, nonHrContactValue, contactXwoba, baa, hPerPA,
    xwobaAllowed, expectedERA,
  };
}

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

// ---------------------------------------------------------------------------
// Reliever per-week forecast
//
// Mirrors `buildGameForecast` for the reliever side. Where the SP forecast
// is per-start (one probable, opponent + park + weather context), the
// reliever forecast is per-week (no per-opponent context — relievers can
// throw in any game). The unit of work is "calendar week" because that's
// the cadence the matchup-week IP/GS caps measure against.
//
// Inputs:
//   - PitcherTalent with role='reliever' (callers should gate before
//     invoking; behavior on a non-reliever talent is well-defined —
//     returns all-zero — but semantically meaningless).
//   - daysRemaining in the matchup window (1..14 — the combined all-star
//     week is Yahoo's longest).
//
// Output: rollup of expected IP + counting cats over the window. Counting
// cats use the same per-PA rates that drive the SP forecast (kPerPA,
// bbPerPA, hrPerContact); ratios (ERA, WHIP) aren't projected per-window
// for relievers (the corrected-margin pipeline reads only counting cats
// from L4, matching SP behavior).
//
// What's deliberately NOT modeled here:
//   - Holds, Saves, Losses: the L6 neutral-week projection models SV
//     directly from observed save pace (`observedSavesPerAppearance` in
//     talent.ts — see docs/roster-strategy.md#saves); this L2/L4 weekly
//     rollup still doesn't. Add here when a weekly surface (streaming
//     reliever tab, matchup SV margin) needs schedule-aware saves.
//   - Opponent quality: relievers face whoever's up; over a week the
//     opponent mix averages to neutral. Park/weather similarly average
//     out over the week of appearances.
//   - Multi-inning leverage: if a reliever is used in 2-IP outings vs
//     1-IP, `ipPerAppearance` already captures that empirically.
// ---------------------------------------------------------------------------

export interface ReliefWeekForecast {
  pitcher: PitcherTalent;
  daysRemaining: number;
  expectedAppearances: number;
  expectedIp: number;
  expectedK: number;
  expectedBb: number;
  expectedHr: number;
  /** Expected hits + walks (the WHIP numerator) — included so callers
   *  doing a "what's my total WHIP exposure" can sum across pitchers. */
  expectedWhipNumerator: number;
}

// TODO: closer SV-opportunity refinement. `team.staffSplits` (and the
// underlying MLB Stats API statSplits response) carries saves,
// saveOpportunities, blownSaves, holds per role per team. A team with
// high SV-opp rate generates more save chances for its closer; the
// observed-pace model (`observedSavesPerAppearance`) doesn't use this,
// so just-anointed closers under-credit until saves accrue.
// See docs/history.md "2026-05 — Batter forecast SP/RP blend".
export function buildReliefWeekForecast(
  pitcher: PitcherTalent,
  daysRemaining: number,
): ReliefWeekForecast {
  // Cap at 14: Yahoo's longest matchup window (the combined all-star week).
  // `days / 7` below is a per-week RATE application, so windows longer than
  // 7 days scale correctly — the cap only guards absurd inputs.
  const days = clamp(daysRemaining, 0, 14);
  const appsPerWeek = pitcher.appearancesPerWeek ?? 0;
  const ipPerApp = pitcher.ipPerAppearance ?? 0;

  // Expected appearances over the remaining window. Linear scaling on
  // the per-week rate — no day-of-week effects (relievers don't have
  // them — they pitch whenever the game calls them).
  const expectedAppearances = appsPerWeek * (days / 7);
  const expectedIp = expectedAppearances * ipPerApp;

  // Counting-cat projections: same per-PA rates as the SP path, applied
  // to the reliever's expected PA window. PA/inning anchor is 4.3 — the
  // same constant `buildGameForecast` uses for the league-mean opponent
  // case (relievers face a mix of opponents that averages neutral).
  const PA_PER_INNING = 4.3;
  const expectedPa = expectedIp * PA_PER_INNING;
  const expectedK = expectedPa * pitcher.kPerPA;
  const expectedBb = expectedPa * pitcher.bbPerPA;
  // HR/PA = HR/contact × contact_rate. Same shape as SP path (talent.ts'
  // `talentHrPerPA` would give the same number).
  const contactRate = Math.max(0, 1 - pitcher.kPerPA - pitcher.bbPerPA);
  const expectedHr = expectedPa * pitcher.hrPerContact * contactRate;
  // Hits = PA × (1 − BB/PA) × BAA; same identity as the SP per-game
  // chain above. BAA derived from contactXwoba via the same factor.
  const baa = pitcher.contactXwoba / 1.5;
  const expectedH = expectedPa * (1 - pitcher.bbPerPA) * baa;
  const expectedWhipNumerator = expectedH + expectedBb;

  return {
    pitcher,
    daysRemaining: days,
    expectedAppearances,
    expectedIp,
    expectedK,
    expectedBb,
    expectedHr,
    expectedWhipNumerator,
  };
}
