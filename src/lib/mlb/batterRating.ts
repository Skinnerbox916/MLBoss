/**
 * Per-category batter matchup rating.
 *
 * Replaces the old six-factor xwOBA-centric `getBatterMatchupScore` with
 * a rating that is driven by the categories the user's league actually
 * scores — and, optionally, by a per-category chase/punt focus map so
 * the user can skew the rating toward the stats they're trying to win
 * (e.g. "I'm chasing AVG this week, punting HR").
 *
 * Structure (post-2026-05 unified architecture):
 *   1. For each scored category, build an `expected` per-PA rate:
 *        baseline = Bayesian blend (current + prior + league)
 *        expected = baseline · matchup modifier (log5 for K/AVG, mult
 *                    for HR/R/RBI/SB, pass-through for BB)
 *      Matchup modifiers fold in **all** stat-specific signals: the
 *      opposing SP, the park (per-stat track via `getParkAdjustment`),
 *      and weather (via the per-cat weather factor below).
 *   2. Normalise `expected` onto 0-1 using the category's floor/elite
 *      window (shared with roster scoring).
 *   3. Weight each category by focus (chase / neutral / punt) and sum.
 *   4. Multiply the composite by ONLY the matchup-wide adjustments:
 *        - platoon multiplier (regressed split ratio, centered on 1.0)
 *        - opportunity multiplier (batting order → PA count)
 *      Weather and park live at the per-cat layer; pulling them up to
 *      the composite would double-count and would also paper over the
 *      stat-specific differences (wind out helps HR/R/RBI but doesn't
 *      help K-suppression — the per-cat layer captures that).
 *   5. Multiply by 100 and bucket into great/good/neutral/poor/bad tiers.
 *
 * Matchup modifiers live INSIDE each category's expected rate so we
 * don't double-count. Platoon and opportunity are multipliers on the
 * whole composite because they scale every category proportionally
 * (platoon: every per-PA rate is shifted by the same talent-vs-hand
 * factor; opportunity: PA count scales every counting stat the same).
 */

import { toBatterSeasonStats } from './adapters';
import type { BatterSeasonStats, PlayerStatLine } from './types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import {
  talentExpectedEra,
  talentBaa as talentBaaPrimitive,
  talentHrPerPA as talentHrPerPAPrimitive,
} from '@/lib/pitching/talent';

/** Migration-era helper. Accept either shape; operate on the legacy one. */
function asBatterStats(
  input: PlayerStatLine | BatterSeasonStats | null,
): BatterSeasonStats | null {
  if (!input) return null;
  return 'identity' in input ? toBatterSeasonStats(input) : input;
}
import {
  CATEGORY_BASELINE_CONFIG,
  blendedBaselineForCategory,
  normalizeRate,
  supportsStatId,
} from './categoryBaselines';
import { getPlatoonAdjustedTalent, getWeatherScore, getWeatherFlag, type MatchupContext } from './analysis';
import { getParkAdjustment } from './parkAdjustment';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Focus = 'neutral' | 'chase' | 'punt';

export interface CategoryContribution {
  statId: number;
  label: string;
  betterIs: 'higher' | 'lower';
  /** Blended per-PA rate (or AVG) — talent only, no matchup. */
  baseline: number;
  /** Matchup-adjusted per-PA rate — baseline · log5 / multiplier modifiers. */
  expected: number;
  /** `expected` mapped onto the category's 0-1 norm window. Always
   *  "higher = more favourable for the batter" regardless of `betterIs`. */
  normalized: number;
  /** Effective sample size behind the baseline (current + capped prior). */
  effectivePA: number;
  /** Assigned weight in the composite (0 for punted, ≥0 else; all
   *  non-punted weights sum to 1.0 across scored categories). */
  weight: number;
  /** weight · (normalized - 0.5) — signed contribution in "points of
   *  score", ready to render as the waterfall row. */
  contribution: number;
  focus: Focus;
  /** Pre-formatted display string for the waterfall (e.g. ".298 AVG",
   *  "0.138 R/PA", ".024 HR/PA"). */
  display: string;
  /** Short matchup-modifier hint (e.g. "vs Alcántara (sub-.230 BAA)",
   *  "Coors park", ""). Empty when the modifier is neutral / missing. */
  modifierHint: string;
}

export interface RatingMultiplier {
  multiplier: number;       // e.g. 1.048 for +4.8%
  deltaPct: number;         // multiplier - 1, in percent space (+4.8)
  /** Raw "value" display (e.g. "#2", "15 mph out", "vs RHP"). */
  display: string;
  /** Human-readable summary (e.g. "Top of the order"). */
  summary: string;
  /** Was the underlying data actually available? */
  available: boolean;
}

export interface BatterRating {
  /** Final rating on 0-100 (50 = neutral). */
  score: number;
  /** Symmetric ± uncertainty band (in score points). Reflects effective
   *  PA across the rated categories — thinner samples → wider band. */
  scoreBand: number;
  /** score - 50, displayed in the "net vs neutral" header. */
  netVsNeutral: number;
  tier: 'great' | 'good' | 'neutral' | 'poor' | 'bad';
  /** All scored categories, in stable order (sorted by absolute
   *  contribution descending at the call site if the UI wants to). */
  categories: CategoryContribution[];
  platoon: RatingMultiplier;
  opportunity: RatingMultiplier;
  /** Surface multiplier — weather is now applied per-cat, this is the
   *  display-only summary for the breakdown panel. */
  weather: RatingMultiplier;
  /** Confidence level + reason + numeric band, mirroring the pitcher
   *  side. Sample size on the batter side comes from the per-cat
   *  effectivePA (capped at 200). */
  confidence: { level: 'high' | 'medium' | 'low'; reason: string; band: number };
}

// ---------------------------------------------------------------------------
// Shared league constants (must match categoryBaselines.ts leagueMean values)
// ---------------------------------------------------------------------------

const LEAGUE_AVG = 0.243;
const LEAGUE_K_PER_PA = 0.223;
/** League-average HR per plate appearance. ~0.034 across MLB pitchers. */
const LEAGUE_HR_PER_PA = 0.034;

// SP-perspective wrappers around the canonical talent-math primitives in
// `pitching/talent.ts`. We accept either a `null`/`undefined` SP (no
// talent → null) or one with `talent: null` and shrink to a single null
// guard. Keeping the wrappers thin so the underlying primitives remain
// the only place these formulas live — we used to have a stale local
// `xwobaToXera` here with the wrong slope (5.0 vs canonical 25), which
// caused batter ratings vs SP to score way too low.

type SpForXera = { talent?: { kPerPA: number; bbPerPA: number; contactXwoba: number; hrPerContact: number } | null };
type SpForHr = { talent?: { kPerPA: number; bbPerPA: number; hrPerContact: number } | null };
type SpForBaa = { talent?: { contactXwoba: number } | null };

function spExpectedEra(sp: SpForXera | null | undefined): number | null {
  const t = sp?.talent;
  return t ? talentExpectedEra(t) : null;
}
function spHrPerPA(sp: SpForHr | null | undefined): number | null {
  const t = sp?.talent;
  return t ? talentHrPerPAPrimitive(t) : null;
}
function spBaa(sp: SpForBaa | null | undefined): number | null {
  const t = sp?.talent;
  return t ? talentBaaPrimitive(t) : null;
}

// ---------------------------------------------------------------------------
// Category-specific matchup adjustments
// ---------------------------------------------------------------------------

function log5(batterRate: number, pitcherRate: number, leagueRate: number): number {
  if (leagueRate <= 0 || leagueRate >= 1) return batterRate;
  const num = (batterRate * pitcherRate) / leagueRate;
  const den = num + ((1 - batterRate) * (1 - pitcherRate)) / (1 - leagueRate);
  if (den <= 0) return batterRate;
  return num / den;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

interface ExpectedRate {
  /** Matchup-adjusted rate (HR/PA, AVG, etc.). */
  expected: number;
  /** Short hint describing the strongest non-neutral modifier applied,
   *  used on the waterfall row. "" when everything netted to neutral. */
  modifierHint: string;
}

/**
 * Per-cat weather factors. Weather offense effect (wind/temp) is small
 * but real: wind-out + warm air → HR carry up ~5-8%, R/RBI up ~3-5%
 * (less than HR because R/RBI are mediated by team offense too); cold
 * + wind-in → opposite. Mirrors the pitcher-side weather factors in
 * forecast.ts for symmetry.
 */
function weatherCatFactor(ctx: MatchupContext | null, statId: number): number {
  if (!ctx) return 1.0;
  const score = getWeatherScore(ctx.game, ctx.game.park); // 0=suppress, 1=boost
  // HR — biggest swing (±8%); R/RBI smaller (±4%); H/TB tiny (±2%).
  // K, BB, SB are weather-independent.
  switch (statId) {
    case 12: return clamp(0.92 + score * 0.16, 0.92, 1.08); // HR
    case 7: case 13: return clamp(0.96 + score * 0.08, 0.96, 1.04); // R, RBI
    case 8: case 23: return clamp(0.98 + score * 0.04, 0.98, 1.02); // H, TB
    default: return 1.0;
  }
}

/**
 * Apply the category-specific matchup modifier on top of the baseline
 * rate. Categories not handled here (BB) pass through baseline-only.
 */
function applyMatchupModifier(
  statId: number,
  baseline: number,
  bats: 'L' | 'R' | 'S' | undefined | null,
  ctx: MatchupContext | null,
  battingOrder: number | null,
): ExpectedRate {
  const sp = ctx?.opposingPitcher ?? null;
  const weatherMult = weatherCatFactor(ctx, statId);

  // Shared `getParkAdjustment` call for any stat with park signal — the
  // primitive picks the right field by `statId`, resolves switch hitters
  // against `pitcherThrows`, and applies the wind term in wind-sensitive
  // parks. Cases below just use it.
  const parkAdj = getParkAdjustment({
    park: ctx?.game.park ?? null,
    statId,
    batterHand: bats,
    pitcherThrows: sp?.throws ?? null,
    weather: ctx?.game.weather ?? null,
  });

  switch (statId) {
    case 3: { // AVG — log5 against SP BAA + park.
      const baa = spBaa(sp);
      const useLog5 = baa != null;
      const expected = useLog5
        ? log5(baseline, baa, LEAGUE_AVG) * parkAdj.multiplier
        : baseline * parkAdj.multiplier;
      const hints: string[] = [];
      if (useLog5 && baa! <= 0.225) hints.push(`sub-${baa!.toFixed(3)} BAA SP`);
      else if (useLog5 && baa! >= 0.260) hints.push(`${baa!.toFixed(3)} BAA SP`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 12: { // HR — pitcher HR/PA from talent vector + park HR + weather.
      const hrPerPA = spHrPerPA(sp);
      const spMod = hrPerPA != null ? clamp(hrPerPA / LEAGUE_HR_PER_PA, 0.5, 2.0) : 1.0;
      const expected = baseline * spMod * parkAdj.multiplier * weatherMult;
      const hints: string[] = [];
      if (hrPerPA != null && hrPerPA >= 0.045) hints.push('HR-prone SP');
      else if (hrPerPA != null && hrPerPA <= 0.025) hints.push('HR-suppressing SP');
      if (parkAdj.hint) hints.push(parkAdj.hint);
      if (weatherMult >= 1.04) hints.push('wind-boost');
      else if (weatherMult <= 0.96) hints.push('wind-suppress');
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 16: { // SB — small bump vs RHP (slide step not SP's focus)
      const vsRhpBump = sp?.throws === 'R' ? 1.05 : 1.0;
      const hints = sp?.throws === 'R' ? ['RHP (easier to run)'] : [];
      return { expected: baseline * vsRhpBump, modifierHint: hints.join(' · ') };
    }

    case 7: { // R — SP quality + park + staff ERA + batting order + weather.
      const orderMod = battingOrder && battingOrder >= 1 && battingOrder <= 3 ? 1.05
                     : battingOrder && battingOrder >= 7 ? 0.92
                     : 1.0;
      const expEra = spExpectedEra(sp);
      const spMod = expEra != null ? clamp(Math.sqrt(expEra / 4.0), 0.7, 1.35) : 1.0;
      const opposingTeam = ctx?.isHome ? ctx.game.awayTeam : ctx?.game.homeTeam ?? null;
      const staffEra = opposingTeam?.staffEra ?? null;
      const staffMod = staffEra != null ? clamp(Math.sqrt(staffEra / 4.2), 0.85, 1.2) : 1.0;
      const expected = baseline * spMod * parkAdj.multiplier * staffMod * orderMod * weatherMult;
      const hints: string[] = [];
      if (expEra != null && expEra >= 4.5) hints.push(`${expEra.toFixed(2)} xERA SP`);
      else if (expEra != null && expEra <= 3.20) hints.push(`${expEra.toFixed(2)} xERA SP`);
      if (orderMod > 1) hints.push('top of order');
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 13: { // RBI — SP quality + park + middle-of-order + weather. (Staff-
              //       ERA intentionally NOT applied: RBI scoring depends on
              //       SP and own batters in front, not the relief pen.)
      const orderMod = battingOrder && battingOrder >= 3 && battingOrder <= 5 ? 1.08
                     : battingOrder && battingOrder >= 8 ? 0.9
                     : 1.0;
      const expEra = spExpectedEra(sp);
      const spMod = expEra != null ? clamp(Math.sqrt(expEra / 4.0), 0.7, 1.35) : 1.0;
      const expected = baseline * spMod * parkAdj.multiplier * orderMod * weatherMult;
      const hints: string[] = [];
      if (expEra != null && expEra >= 4.5) hints.push(`${expEra.toFixed(2)} xERA SP`);
      else if (expEra != null && expEra <= 3.20) hints.push(`${expEra.toFixed(2)} xERA SP`);
      if (orderMod > 1) hints.push('middle of order');
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 21: { // K — log5 against SP K/PA + park SO factor.
      const spKRate = sp?.talent?.kPerPA ?? null;
      const expected = (spKRate != null
        ? log5(baseline, spKRate, LEAGUE_K_PER_PA)
        : baseline) * parkAdj.multiplier;
      const hints: string[] = [];
      if (spKRate != null && spKRate >= 0.27) hints.push(`high-K SP (${(spKRate * 100).toFixed(0)}%)`);
      else if (spKRate != null && spKRate <= 0.18) hints.push(`low-K SP (${(spKRate * 100).toFixed(0)}%)`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 8:   // H  — overall hitter friendliness with hand skew + small weather effect.
    case 23:  // TB — same. HR-track effect is captured for HR-specific
              //      scoring; using the AVG track here avoids double-counting.
      return { expected: baseline * parkAdj.multiplier * weatherMult, modifierHint: parkAdj.hint };

    case 18: // BB — park walks factor (pitcher caution vs pitcher park).
      return { expected: baseline * parkAdj.multiplier, modifierHint: parkAdj.hint };

    default:
      return { expected: baseline, modifierHint: '' };
  }
}

// ---------------------------------------------------------------------------
// Multipliers
// ---------------------------------------------------------------------------

/**
 * Platoon multiplier from the regressed split ratio. Caps the output to
 * ±15% so extreme observed ratios on thin samples (rare) can't swamp
 * the category composite — the priors already regress most cases into
 * that band.
 */
function buildPlatoonMultiplier(
  stats: BatterSeasonStats | null,
  ctx: MatchupContext | null,
): RatingMultiplier {
  const platoon = getPlatoonAdjustedTalent(stats, ctx?.opposingPitcher?.throws);
  const clamped = clamp(platoon.multiplier, 0.85, 1.15);
  const pct = (clamped - 1) * 100;
  const handLabel = platoon.facingHand === 'L' ? 'vs LHP' : platoon.facingHand === 'R' ? 'vs RHP' : '';

  let summary: string;
  const available = platoon.facingHand !== null;
  if (!available) {
    summary = ctx?.opposingPitcher
      ? 'Switch-pitcher matchup'
      : 'SP unknown';
  } else if (clamped >= 1.05) {
    summary = 'Strong vs hand';
  } else if (clamped >= 1.02) {
    summary = 'Favorable vs hand';
  } else if (clamped >= 0.98) {
    summary = 'Neutral platoon';
  } else if (clamped >= 0.95) {
    summary = 'Mild tilt vs hand';
  } else {
    summary = 'Rough vs hand';
  }

  return {
    multiplier: clamped,
    deltaPct: pct,
    display: handLabel || '—',
    summary,
    available,
  };
}

/**
 * Batting-order → PA opportunity multiplier. Top-of-order bats average
 * ~4.6 PA/game vs #9's ~3.6 — ~±8% of the expected PA count, which is
 * what we reflect here.
 */
function buildOpportunityMultiplier(battingOrder: number | null): RatingMultiplier {
  const known = battingOrder !== null && battingOrder >= 1 && battingOrder <= 9;
  if (!known) {
    return {
      multiplier: 1.0,
      deltaPct: 0,
      display: '—',
      summary: 'No lineup data',
      available: false,
    };
  }
  // #1 → +8%, #9 → −8%, linear between.
  const pct = 8 - ((battingOrder! - 1) / 8) * 16;
  const mult = 1 + pct / 100;
  const summary = battingOrder! <= 2 ? 'Top of the order'
                : battingOrder! <= 5 ? 'Middle of the order'
                : 'Bottom of the order';
  return {
    multiplier: mult,
    deltaPct: pct,
    display: `#${battingOrder}`,
    summary,
    available: true,
  };
}

/**
 * Weather multiplier. Maps the existing 0-1 `getWeatherScore` onto a
 * 0.94 → 1.06 range so max-boost conditions add ~6% to the rating and
 * max-suppress take off ~6%. Neutral 0.5 → 1.0.
 */
function buildWeatherMultiplier(ctx: MatchupContext | null): RatingMultiplier {
  if (!ctx) {
    return { multiplier: 1.0, deltaPct: 0, display: '—', summary: 'No game', available: false };
  }
  const raw = getWeatherScore(ctx.game, ctx.game.park);
  const flag = getWeatherFlag(ctx.game, ctx.game.park);
  const mult = 1 + (raw - 0.5) * 0.24; // 0 → 0.88, 1 → 1.12 (soft clamp below)
  const clamped = clamp(mult, 0.94, 1.06);
  const pct = (clamped - 1) * 100;

  const display = flag.label || (ctx.game.park?.roof === 'dome' ? 'Dome' : 'Normal');
  const summary =
    flag.kind === 'boost' ? 'Offense boost'
    : flag.kind === 'suppress' ? 'Offense suppressed'
    : flag.kind === 'neutral' ? 'Controlled env'
    : 'Neutral conditions';
  const available = flag.kind !== 'none';

  return { multiplier: clamped, deltaPct: pct, display, summary, available };
}

// ---------------------------------------------------------------------------
// Focus-based weight vector
// ---------------------------------------------------------------------------

/**
 * Build a weight for each scored statId from the focus map.
 *
 *   punt    → 0
 *   chase   → 2 × base
 *   neutral → 1 × base
 *
 * Where base = 1 / (count of non-punted categories). Weights renormalise
 * to sum to 1.0 across active categories so the composite stays on a
 * 0-1 scale regardless of how many cats are chased/punted.
 *
 * Edge case: if every category is punted, returns all zeros and the
 * caller's composite degrades to 0 (score = 0 × multipliers = 0). We
 * warn only in-console — the user did it on purpose.
 */
function buildWeightVector(
  scoredStatIds: number[],
  focusMap: Record<number, Focus>,
): Record<number, number> {
  const active = scoredStatIds.filter(id => (focusMap[id] ?? 'neutral') !== 'punt');
  if (active.length === 0) {
    const empty: Record<number, number> = {};
    for (const id of scoredStatIds) empty[id] = 0;
    return empty;
  }

  // Pre-normalised weights: chase=2, neutral=1, punt=0.
  const raw: Record<number, number> = {};
  let total = 0;
  for (const id of scoredStatIds) {
    const f = focusMap[id] ?? 'neutral';
    const w = f === 'punt' ? 0 : f === 'chase' ? 2 : 1;
    raw[id] = w;
    total += w;
  }
  const out: Record<number, number> = {};
  for (const id of scoredStatIds) {
    out[id] = total > 0 ? raw[id] / total : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatRate(statId: number, rate: number): string {
  if (statId === 3) return rate.toFixed(3).replace(/^0\./, '.'); // AVG
  // Per-PA stats → 3-decimal for HR/SB (small), 3-decimal for others.
  return rate.toFixed(3).replace(/^0\./, '.');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BatterRatingArgs {
  context: MatchupContext | null;
  /** Accepts the new stratified shape OR the legacy flat shape. The function
   *  adapts internally during the migration. New call sites should pass the
   *  stratified `PlayerStatLine`. */
  stats: PlayerStatLine | BatterSeasonStats | null;
  scoredCategories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, Focus>;
  battingOrder: number | null;
}

/**
 * Compute the category-weighted batter rating for a single matchup.
 *
 * Returns a neutral (score=50) rating when:
 *   - `context` is null (no game today)
 *   - `stats` is null (no season data yet)
 *   - `scoredCategories` is empty (can happen mid-load before league
 *     categories resolve — degrade to neutral rather than crash)
 */
export function getBatterRating(args: BatterRatingArgs): BatterRating {
  const { context, scoredCategories, focusMap, battingOrder } = args;
  const stats = asBatterStats(args.stats);

  const platoon = buildPlatoonMultiplier(stats, context);
  const opportunity = buildOpportunityMultiplier(battingOrder);
  const weather = buildWeatherMultiplier(context);

  if (!context || !stats || scoredCategories.length === 0) {
    return {
      score: 50,
      scoreBand: 15,
      netVsNeutral: 0,
      tier: 'neutral',
      categories: [],
      platoon,
      opportunity,
      weather,
      confidence: {
        level: 'low',
        reason: !context ? 'No game today' : !stats ? 'No season data' : 'No scored categories',
        band: 15,
      },
    };
  }

  // Filter to the scored categories this engine can actually compute.
  const supported = scoredCategories.filter(c => supportsStatId(c.stat_id));
  const statIds = supported.map(c => c.stat_id);
  const weights = buildWeightVector(statIds, focusMap);

  const contributions: CategoryContribution[] = [];
  let composite = 0;

  for (const cat of supported) {
    const cfg = CATEGORY_BASELINE_CONFIG[cat.stat_id]!;
    const baselineResult = blendedBaselineForCategory(stats, cat.stat_id);
    if (!baselineResult) continue;

    const { expected, modifierHint } = applyMatchupModifier(
      cat.stat_id,
      baselineResult.rate,
      stats.bats,
      context,
      battingOrder,
    );
    const normalized = normalizeRate(expected, cat.stat_id, cat.betterIs);
    const weight = weights[cat.stat_id] ?? 0;
    const focus = focusMap[cat.stat_id] ?? 'neutral';
    // Contribution measured as the category's pull on score, centered on
    // neutral (0.5). Positive = above-average for this category today.
    const contribution = weight * (normalized - 0.5);

    contributions.push({
      statId: cat.stat_id,
      label: cfg.label,
      betterIs: cat.betterIs,
      baseline: baselineResult.rate,
      expected,
      normalized,
      effectivePA: Math.round(baselineResult.effectivePA),
      weight,
      contribution,
      focus,
      display: `${formatRate(cat.stat_id, expected)} ${cfg.label}${cat.stat_id === 3 ? '' : '/PA'}`,
      modifierHint,
    });

    composite += weight * normalized;
  }

  // When every active category has weight 0 (all-punt), composite = 0.
  // Treat that as explicit "batter has nothing to offer in my league" →
  // score stays at 0 but we avoid multiplier inflation/deflation which
  // would be meaningless.
  const activeWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const preMultScore = activeWeight > 0 ? composite * 100 : 50;

  // Composite multipliers — only platoon and opportunity. Weather is
  // applied per-cat (see weatherCatFactor) so the K and BB cats — which
  // weather doesn't affect — are not penalised, while HR/R/RBI carry
  // the wind/temperature signal where it actually applies.
  const finalScore = activeWeight > 0
    ? preMultScore * platoon.multiplier * opportunity.multiplier
    : preMultScore;

  const score = Math.max(0, Math.min(100, Math.round(finalScore)));
  const netVsNeutral = score - 50;

  const tier: BatterRating['tier'] =
    score >= 70 ? 'great'
    : score >= 55 ? 'good'
    : score >= 45 ? 'neutral'
    : score >= 30 ? 'poor'
    : 'bad';

  // Confidence band — weighted average of per-cat shrinkage. Each cat's
  // shrinkage is approximately (1 - effectivePA/200), capped. Aggregated
  // by the active focus weights so a player with thin samples in chased
  // cats is flagged less confident than thin samples in punted cats.
  const PA_FULL_TRUST = 200;
  const MAX_BATTER_BAND = 15;
  let bandWeighted = 0;
  let weightSum = 0;
  for (const c of contributions) {
    if (c.weight <= 0) continue;
    const shrink = clamp(1 - c.effectivePA / PA_FULL_TRUST, 0, 1);
    bandWeighted += c.weight * shrink;
    weightSum += c.weight;
  }
  const aggregateShrink = weightSum > 0 ? bandWeighted / weightSum : 1;
  const band = clamp(aggregateShrink * MAX_BATTER_BAND, 0, MAX_BATTER_BAND);
  const confidenceLevel: 'high' | 'medium' | 'low' =
    aggregateShrink <= 0.30 ? 'high'
    : aggregateShrink <= 0.60 ? 'medium'
    : 'low';
  const minEffectivePA = contributions.length > 0
    ? Math.min(...contributions.map(c => c.effectivePA))
    : 0;

  return {
    score,
    scoreBand: band,
    netVsNeutral,
    tier,
    categories: contributions,
    platoon,
    opportunity,
    weather,
    confidence: {
      level: confidenceLevel,
      reason: `${minEffectivePA.toFixed(0)} min effective PA`,
      band,
    },
  };
}
