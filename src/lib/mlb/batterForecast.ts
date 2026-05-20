/**
 * Per-PA batter forecast — Layer 2.
 *
 * Pure function: given a batter's Bayesian-blended baseline rates per
 * category and a specific game context, returns per-PA expected rates
 * adjusted for SP matchup, park, weather, and (where applicable)
 * batting order. Mirrors the pitcher side's `buildGameForecast` in
 * `src/lib/pitching/forecast.ts`.
 *
 * Architecture: this module owns the L2 forecast for batters. L3 rating
 * — `getBatterRating` in `./batterRating.ts` — consumes `BatterForecast`
 * and adds normalization, weighting, focus map, composite multipliers,
 * tier mapping, and confidence aggregation. See
 * `docs/unified-rating-model.md`.
 */

import type { BatterSeasonStats } from './types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import { type MatchupContext, getWeatherScore } from './analysis';
import { blendedBaselineForCategory, supportsStatId } from './categoryBaselines';
import { getParkAdjustment } from './parkAdjustment';
import {
  talentExpectedEra,
  talentBaa as talentBaaPrimitive,
  talentHrPerPA as talentHrPerPAPrimitive,
  talentHitsPerPA as talentHitsPerPAPrimitive,
} from '@/lib/pitching/talent';

// ---------------------------------------------------------------------------
// Shared league constants (must match categoryBaselines.ts leagueMean values)
// ---------------------------------------------------------------------------

const LEAGUE_AVG = 0.243;
const LEAGUE_K_PER_PA = 0.223;
const LEAGUE_BB_PER_PA = 0.084;
const LEAGUE_H_PER_PA = 0.215;
/** League-average HR per plate appearance. ~0.034 across MLB pitchers. */
const LEAGUE_HR_PER_PA = 0.034;

// ---------------------------------------------------------------------------
// Pitcher share-of-variance bounds — anchored to published research, not
// gut-tuned. Each clamp expresses the maximum per-PA effect a single
// pitcher can plausibly have on the batter's outcome rate, given the
// fraction of variance the literature attributes to the pitcher.
//
// Where log5 fits (K, BB, AVG, H, TB) the math derives the magnitude
// from the rates themselves — no clamp needed. Where it doesn't (HR is
// a contact-quality outcome, R/RBI flow through team offense) we clamp
// the multiplicative ratio.
//
// See docs/unified-rating-model.md "Calibration anchors".
// ---------------------------------------------------------------------------

/** HR/PA: Tango/Clemens 2018→19 study found only ~2% real per-PA edge
 *  facing the most-HR-prone vs most-stingy pitcher; variance-decomp
 *  research shows batter and park dominate HR variance. ±15% absorbs
 *  modeling noise around that small empirical effect. */
const PITCHER_SWING_HR = { lo: 0.85, hi: 1.18 };

/** R/PA, RBI/PA: per-PA run scoring flows through teammate offense,
 *  baserunning, and 8+ unrelated PAs. Pitcher's per-PA R contribution
 *  is a fraction of their ERA share. ±20% bounds the indirect effect. */
const PITCHER_SWING_RUNS = { lo: 0.85, hi: 1.20 };

// ---------------------------------------------------------------------------
// SP-perspective wrappers around the canonical talent-math primitives in
// `pitching/talent.ts`. We accept either a `null`/`undefined` SP (no
// talent → null) or one with `talent: null` and shrink to a single null
// guard. Keeping the wrappers thin so the underlying primitives remain
// the only place these formulas live.
// ---------------------------------------------------------------------------

type SpForXera = { talent?: { kPerPA: number; bbPerPA: number; contactXwoba: number; hrPerContact: number } | null };
type SpForHr = { talent?: { kPerPA: number; bbPerPA: number; hrPerContact: number } | null };
type SpForBaa = { talent?: { contactXwoba: number } | null };
type SpForHits = { talent?: { contactXwoba: number; bbPerPA: number } | null };

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
function spHitsPerPA(sp: SpForHits | null | undefined): number | null {
  const t = sp?.talent;
  return t ? talentHitsPerPAPrimitive(t) : null;
}

// ---------------------------------------------------------------------------
// Math utilities
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

/** Bounded multiplicative pitcher modifier. Used when log5 doesn't fit
 *  (HR is a contact-quality outcome, R/RBI are downstream of team play).
 *  Clamps `pitcherRate / leagueRate` to a swing window anchored to the
 *  published per-PA share-of-variance for that outcome. */
function pitcherRatioClamp(
  pitcherRate: number,
  leagueRate: number,
  swing: { lo: number; hi: number },
): number {
  if (leagueRate <= 0) return 1.0;
  return clamp(pitcherRate / leagueRate, swing.lo, swing.hi);
}

// ---------------------------------------------------------------------------
// Per-cat weather factor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Per-cat matchup modifier (the core)
// ---------------------------------------------------------------------------

interface ExpectedRate {
  /** Matchup-adjusted rate (HR/PA, AVG, etc.). */
  expected: number;
  /** Short hint describing the strongest non-neutral modifier applied,
   *  used on the waterfall row. "" when everything netted to neutral. */
  modifierHint: string;
}

/**
 * Apply the category-specific matchup modifier on top of the baseline
 * rate. Categories not handled here pass through baseline-only.
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
      // Pitcher swing tightened to literature: HR variance is dominated
      // by batter and park; the empirical extreme-pitcher edge per-PA is
      // ~2% (Tango/Clemens). PITCHER_SWING_HR caps at ±18%.
      const hrPerPA = spHrPerPA(sp);
      const spMod = hrPerPA != null ? pitcherRatioClamp(hrPerPA, LEAGUE_HR_PER_PA, PITCHER_SWING_HR) : 1.0;
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
      // R/PA flows through team offense; per-PA pitcher contribution is
      // a fraction of their ERA share. PITCHER_SWING_RUNS caps at ±20%.
      // Express SP modifier as a normalized ratio (xERA / 4.0) so the
      // clamp is the single source of truth on swing magnitude.
      const orderMod = battingOrder && battingOrder >= 1 && battingOrder <= 3 ? 1.05
                     : battingOrder && battingOrder >= 7 ? 0.92
                     : 1.0;
      const expEra = spExpectedEra(sp);
      const spMod = expEra != null ? pitcherRatioClamp(expEra, 4.0, PITCHER_SWING_RUNS) : 1.0;
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
      // Same swing bounds as R — RBI per-PA is similarly team-mediated.
      const orderMod = battingOrder && battingOrder >= 3 && battingOrder <= 5 ? 1.08
                     : battingOrder && battingOrder >= 8 ? 0.9
                     : 1.0;
      const expEra = spExpectedEra(sp);
      const spMod = expEra != null ? pitcherRatioClamp(expEra, 4.0, PITCHER_SWING_RUNS) : 1.0;
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

    case 8: { // H — log5 against pitcher hits-per-PA + park + weather.
      // Previously park-only, which left H asymmetrically uncalibrated
      // vs AVG (AVG got a log5 SP modifier; H didn't). Same primitive
      // applied here keeps AVG ↔ H consistent.
      const hitsPerPA = spHitsPerPA(sp);
      const log5Mod = hitsPerPA != null ? log5(baseline, hitsPerPA, LEAGUE_H_PER_PA) / baseline : 1.0;
      const expected = baseline * log5Mod * parkAdj.multiplier * weatherMult;
      const hints: string[] = [];
      if (hitsPerPA != null && hitsPerPA >= 0.235) hints.push(`hit-prone SP (${hitsPerPA.toFixed(3)} H/PA)`);
      else if (hitsPerPA != null && hitsPerPA <= 0.195) hints.push(`hit-suppressing SP (${hitsPerPA.toFixed(3)} H/PA)`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 23: { // TB — log5 against pitcher hits-per-PA + park + weather.
      // TB tracks H + extra bases. Hits-per-PA captures the contact
      // dimension; HR-specific power is already separately credited in
      // the HR cat. Using the same hit-allowance primitive keeps H ↔ TB
      // moving together (a hit-suppressing SP suppresses both).
      const hitsPerPA = spHitsPerPA(sp);
      const log5Mod = hitsPerPA != null ? log5(baseline, hitsPerPA, LEAGUE_H_PER_PA) / baseline : 1.0;
      const expected = baseline * log5Mod * parkAdj.multiplier * weatherMult;
      return { expected, modifierHint: parkAdj.hint };
    }

    case 18: { // BB — log5 against pitcher BB/PA + park.
      // BB is one of the three true outcomes (K, BB, HR) and the most
      // pitcher-controlled rate after K. log5 is the right primitive
      // here; previously BB had only a park modifier, leaving the
      // pitcher's BB-prone tendency uncredited.
      const spBb = sp?.talent?.bbPerPA ?? null;
      const log5Mod = spBb != null ? log5(baseline, spBb, LEAGUE_BB_PER_PA) / baseline : 1.0;
      const expected = baseline * log5Mod * parkAdj.multiplier;
      const hints: string[] = [];
      if (spBb != null && spBb >= 0.10) hints.push(`high-BB SP (${(spBb * 100).toFixed(0)}%)`);
      else if (spBb != null && spBb <= 0.06) hints.push(`low-BB SP (${(spBb * 100).toFixed(0)}%)`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    default:
      return { expected: baseline, modifierHint: '' };
  }
}

// ---------------------------------------------------------------------------
// Public types and entrypoint
// ---------------------------------------------------------------------------

export interface BatterCategoryForecast {
  /** Bayesian-blended pre-matchup rate (the input baseline). Retained
   *  so consumers can show the "baseline → expected" delta. */
  baseline: number;
  /** Matchup-adjusted per-PA rate (or AVG). */
  expected: number;
  /** Effective sample size behind the baseline. Drives the per-cat
   *  shrinkage that aggregates into Rating.confidence.band. */
  effectivePA: number;
  /** Short human-readable hint (e.g. "vs Alcántara (sub-.230 BAA)").
   *  Empty when the modifier is neutral / missing data. */
  modifierHint: string;
}

export interface BatterForecast {
  /** Map keyed by stat_id. Includes one entry per supported scored cat. */
  perCategory: Record<number, BatterCategoryForecast>;
}

/**
 * Build the per-PA batter forecast for a single matchup.
 *
 * Pure function. Same inputs always produce the same outputs. Iterates
 * the supplied scored categories, builds a Bayesian-blended baseline per
 * cat via `blendedBaselineForCategory`, applies the per-cat matchup
 * modifier (SP log5/clamp + park + weather + batting order where
 * applicable), and returns a map keyed by stat_id.
 *
 * Categories where `supportsStatId(statId)` returns false (the engine
 * has no per-cat handler) are skipped silently. Categories where the
 * baseline is null (talent + raw both missing) are also skipped.
 */
export function buildBatterForecast(
  stats: BatterSeasonStats,
  ctx: MatchupContext | null,
  battingOrder: number | null,
  scoredCategories: EnrichedLeagueStatCategory[],
): BatterForecast {
  const perCategory: Record<number, BatterCategoryForecast> = {};
  for (const cat of scoredCategories) {
    const statId = cat.stat_id;
    if (!supportsStatId(statId)) continue;
    const baselineResult = blendedBaselineForCategory(stats, statId);
    if (!baselineResult) continue;
    const { expected, modifierHint } = applyMatchupModifier(
      statId,
      baselineResult.rate,
      stats.bats,
      ctx,
      battingOrder,
    );
    perCategory[statId] = {
      baseline: baselineResult.rate,
      expected,
      effectivePA: baselineResult.effectivePA,
      modifierHint,
    };
  }
  return { perCategory };
}
