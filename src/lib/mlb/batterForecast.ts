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

import type { BatterSeasonStats, TeamStaffSplits } from './types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import { type MatchupContext, getWeatherScore } from './analysis';
import { platoonFactor, facingHandFrom } from './platoon';
import { blendedBaselineForCategory, supportsStatId } from './categoryBaselines';
import { getParkAdjustment } from './parkAdjustment';
import { getLeagueSbAllowedPerIp } from './leagueRates';
import {
  LEAGUE_IP_PER_START,
  talentExpectedEra,
  talentBaa as talentBaaPrimitive,
  talentHrPerPA as talentHrPerPAPrimitive,
  talentHitsPerPA as talentHitsPerPAPrimitive,
} from '@/lib/pitching/talent';

// ---------------------------------------------------------------------------
// Shared league constants (must match categoryBaselines.ts leagueMean values
// AND pitcher-side LEAGUE_K_RATE / LEAGUE_BB_RATE / LEAGUE_XBA in
// talentModel.ts — MLB is zero-sum, both sides must agree). Refreshed
// 2026 mid-season from /api/v1/teams/stats?stats=season&group=pitching;
// see docs/history.md "2026-05 — League rate calibration refresh".
// ---------------------------------------------------------------------------

const LEAGUE_AVG = 0.239;
const LEAGUE_K_PER_PA = 0.221;
const LEAGUE_BB_PER_PA = 0.094;
const LEAGUE_H_PER_PA = 0.212;
/** League-average HR per plate appearance. 2026 MLB rate is ~0.028
 *  (notably lower than the 2024 anchor 0.034). HR is the constant most
 *  sensitive to era — the dead-ball-ish 2026 environment means HR
 *  ratio-clamp anchors were systematically pessimistic at 0.034. */
const LEAGUE_HR_PER_PA = 0.0275;

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

/** SB-allowed team multiplier: team SB/IP ratio to league mean. Tight
 *  bounds — SB success rate variance across staffs is small relative
 *  to runner skill and base-state. ±25% absorbs the team-aggregate
 *  signal without overstating its predictive weight. */
const SB_SWING = { lo: 0.80, hi: 1.25 };

// ---------------------------------------------------------------------------
// SP/RP blend — every per-PA modifier the batter sees is a weighted mix
// of the opposing SP (for `spShare` of the PAs) and the opposing
// bullpen (for the rest). Without this blend the forecast assumes the
// SP pitches all 9 IP, which overweights the SP signal by ~40% per game
// on average and silently distorts forecasts for teams whose bullpen
// quality diverges from their rotation (the Reds-style profile in the
// 2025 batter-streaming examples).
//
// See docs/unified-rating-model.md "SP/RP blend".
// ---------------------------------------------------------------------------

/** Per-pitcher IP share clamp. Opener floor (~3.0) and rare
 *  complete-game ceiling (~7.5) — anchors what's physically plausible
 *  for `ipPerStart`-derived SP-share. */
const SP_SHARE_CLAMP = { lo: 0.30, hi: 0.85 };

/** RP IP at which we fully trust the team bullpen aggregate. Below
 *  this, the blend shrinks back toward SP-only via `rpConfidence`.
 *  ~100 IP is ~1 month of team bullpen play — past the early-season
 *  noise window, and individual rates within the aggregate are
 *  well-stabilized at the relevant PA counts. */
const RP_FULL_TRUST_IP = 100;

/**
 * Effective SP-share of the batter's PAs in the game, with
 * thin-sample shrinkage. Returns 1.0 when there's no usable bullpen
 * aggregate (early season, missing data) — clean fallback to SP-only.
 *
 * Formula:
 *   spShareBase = clamp(sp.ipPerStart / 9, 0.30, 0.85)
 *   rpConfidence = clamp(rpIp / 100, 0, 1)
 *   spShare = spShareBase + (1 - spShareBase) × (1 - rpConfidence)
 */
function computeSpShare(
  sp: { talent?: { ipPerStart: number } | null } | null | undefined,
  oppStaffSplits: TeamStaffSplits | null | undefined,
): number {
  const ipPerStart = sp?.talent?.ipPerStart ?? LEAGUE_IP_PER_START;
  const spShareBase = clamp(ipPerStart / 9, SP_SHARE_CLAMP.lo, SP_SHARE_CLAMP.hi);
  const rpIp = oppStaffSplits?.rp?.ip ?? 0;
  const rpConfidence = clamp(rpIp / RP_FULL_TRUST_IP, 0, 1);
  return spShareBase + (1 - spShareBase) * (1 - rpConfidence);
}

/** Blend two per-PA log5 results by SP-share weight. When the RP
 *  rate is missing, the rpShare term contributes baseline (no
 *  modifier) — which is mathematically a no-op when `spShare = 1.0`
 *  (the only state in which RP data is missing in practice). */
function blendLog5(
  baseline: number,
  spRate: number | null,
  rpRate: number | null,
  leagueRate: number,
  spShare: number,
): number {
  const spEffective = spRate != null ? log5(baseline, spRate, leagueRate) : baseline;
  const rpEffective = rpRate != null ? log5(baseline, rpRate, leagueRate) : baseline;
  return spShare * spEffective + (1 - spShare) * rpEffective;
}

/** Blend two pitcher-ratio-clamped multipliers by SP-share weight. */
function blendRatioMult(
  spRate: number | null,
  rpRate: number | null,
  leagueRate: number,
  swing: { lo: number; hi: number },
  spShare: number,
): number {
  const spMod = spRate != null ? pitcherRatioClamp(spRate, leagueRate, swing) : 1.0;
  const rpMod = rpRate != null ? pitcherRatioClamp(rpRate, leagueRate, swing) : 1.0;
  return spShare * spMod + (1 - spShare) * rpMod;
}

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
 * rate. Every per-PA modifier blends the opposing SP and bullpen
 * contributions by `spShare`. When the opposing team's bullpen
 * aggregate is missing or thin, `spShare` shrinks back toward 1.0 so
 * the forecast cleanly falls back to SP-only.
 *
 * Categories not handled here pass through baseline-only.
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

  // Opposing-team staff splits drive the bullpen side of every blend.
  // `computeSpShare` returns 1.0 when these are missing or thin, so
  // the SP-only fallback is automatic.
  const opposingTeam = ctx?.isHome ? ctx.game.awayTeam : ctx?.game.homeTeam ?? null;
  const oppStaffSplits = opposingTeam?.staffSplits ?? null;
  const oppRp = oppStaffSplits?.rp ?? null;
  const spShare = computeSpShare(sp, oppStaffSplits);

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
    case 3: { // AVG — log5 blend (SP BAA, bullpen BAA) + park.
      const spBaaR = spBaa(sp);
      const rpBaaR = oppRp?.baa ?? null;
      const blended = blendLog5(baseline, spBaaR, rpBaaR, LEAGUE_AVG, spShare);
      const expected = blended * parkAdj.multiplier;
      const hints: string[] = [];
      if (spBaaR != null) hints.push(`${spBaaR.toFixed(3)} BAA SP`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 12: { // HR — ratio-clamp blend (SP, bullpen HR/PA) + park + weather.
      // Pitcher swing tightened to literature: HR variance is dominated
      // by batter and park; the empirical extreme-pitcher edge per-PA is
      // ~2% (Tango/Clemens). PITCHER_SWING_HR caps at ±18%.
      const spHr = spHrPerPA(sp);
      const rpHr = oppRp?.hrPerPA ?? null;
      const blendedMod = blendRatioMult(spHr, rpHr, LEAGUE_HR_PER_PA, PITCHER_SWING_HR, spShare);
      const expected = baseline * blendedMod * parkAdj.multiplier * weatherMult;
      const hints: string[] = [];
      if (spHr != null) hints.push(`${spHr.toFixed(3)} HR/PA SP`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      if (weatherMult >= 1.04) hints.push('wind-boost');
      else if (weatherMult <= 0.96) hints.push('wind-suppress');
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 16: { // SB — RHP hand bump + team SB-allowed-per-IP blend.
      // RHP bump is an SP-specific signal (slide step not the SP's
      // focus). Team SB-allowed blend captures opposing-staff
      // tendencies (catcher arm, pitcher times-to-plate). Both
      // multiply, not additive — independent dimensions.
      const handMult = sp?.throws === 'R' ? 1.05 : 1.0;

      const leagueSbRate = getLeagueSbAllowedPerIp();
      const oppSp = oppStaffSplits?.sp ?? null;
      let teamSbMult = 1.0;
      let teamSbHint = '';
      if (leagueSbRate > 0 && (oppSp || oppRp)) {
        const spRate = oppSp?.sbAllowedPerIp ?? leagueSbRate;
        const rpRate = oppRp?.sbAllowedPerIp ?? leagueSbRate;
        const blendedRate = spShare * spRate + (1 - spShare) * rpRate;
        teamSbMult = clamp(blendedRate / leagueSbRate, SB_SWING.lo, SB_SWING.hi);
        if (teamSbMult >= 1.10) teamSbHint = 'SB-permissive staff';
        else if (teamSbMult <= 0.90) teamSbHint = 'SB-stingy staff';
      }

      const expected = baseline * handMult * teamSbMult;
      const hints: string[] = [];
      if (sp?.throws === 'R') hints.push('RHP (easier to run)');
      else if (sp?.throws === 'L') hints.push('LHP');
      if (teamSbHint) hints.push(teamSbHint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 7: { // R — ratio-clamp blend (SP xERA, bullpen ERA) + park + order + weather.
      // R/PA flows through team offense; per-PA pitcher contribution is
      // a fraction of their ERA share. PITCHER_SWING_RUNS caps at ±20%.
      // The SP+RP blend captures both rotation and bullpen quality,
      // replacing the previous orphan `staffEra` clamp that
      // double-counted the SP and asymmetrically excluded RBI.
      const orderMod = battingOrder && battingOrder >= 1 && battingOrder <= 3 ? 1.05
                     : battingOrder && battingOrder >= 7 ? 0.92
                     : 1.0;
      const expEra = spExpectedEra(sp);
      const rpEra = oppRp?.era ?? null;
      const blendedMod = blendRatioMult(expEra, rpEra, 4.0, PITCHER_SWING_RUNS, spShare);
      const expected = baseline * blendedMod * parkAdj.multiplier * orderMod * weatherMult;
      const hints: string[] = [];
      if (expEra != null) hints.push(`${expEra.toFixed(2)} xERA SP`);
      if (orderMod > 1) hints.push('top of order');
      if (parkAdj.hint) hints.push(parkAdj.hint);
      if (weatherMult >= 1.03) hints.push('wind-boost');
      else if (weatherMult <= 0.97) hints.push('wind-suppress');
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 13: { // RBI — ratio-clamp blend (SP xERA, bullpen ERA) + park + order + weather.
      // Same blend pattern as R — RBI per-PA is similarly team-mediated.
      // RBI now picks up bullpen contribution (it didn't before, when
      // staffEra was R-only); this is a correctness fix, not a tuning
      // change.
      const orderMod = battingOrder && battingOrder >= 3 && battingOrder <= 5 ? 1.08
                     : battingOrder && battingOrder >= 8 ? 0.9
                     : 1.0;
      const expEra = spExpectedEra(sp);
      const rpEra = oppRp?.era ?? null;
      const blendedMod = blendRatioMult(expEra, rpEra, 4.0, PITCHER_SWING_RUNS, spShare);
      const expected = baseline * blendedMod * parkAdj.multiplier * orderMod * weatherMult;
      const hints: string[] = [];
      if (expEra != null) hints.push(`${expEra.toFixed(2)} xERA SP`);
      if (orderMod > 1) hints.push('middle of order');
      if (parkAdj.hint) hints.push(parkAdj.hint);
      if (weatherMult >= 1.03) hints.push('wind-boost');
      else if (weatherMult <= 0.97) hints.push('wind-suppress');
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 21: { // K — log5 blend (SP K/PA, bullpen K/PA) + park SO factor.
      const spKRate = sp?.talent?.kPerPA ?? null;
      const rpKRate = oppRp?.kPerPA ?? null;
      const blended = blendLog5(baseline, spKRate, rpKRate, LEAGUE_K_PER_PA, spShare);
      const expected = blended * parkAdj.multiplier;
      const hints: string[] = [];
      if (spKRate != null) hints.push(`${(spKRate * 100).toFixed(0)}% K SP`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 8: { // H — log5 blend (SP, bullpen hits/PA) + park + weather.
      const spHits = spHitsPerPA(sp);
      const rpHits = oppRp?.hitsPerPA ?? null;
      const blended = blendLog5(baseline, spHits, rpHits, LEAGUE_H_PER_PA, spShare);
      const expected = blended * parkAdj.multiplier * weatherMult;
      const hints: string[] = [];
      if (spHits != null) hints.push(`${spHits.toFixed(3)} H/PA SP`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 23: { // TB — log5 blend (SP, bullpen hits/PA) + park + weather.
      const spHits = spHitsPerPA(sp);
      const rpHits = oppRp?.hitsPerPA ?? null;
      const blended = blendLog5(baseline, spHits, rpHits, LEAGUE_H_PER_PA, spShare);
      const expected = blended * parkAdj.multiplier * weatherMult;
      const hints: string[] = [];
      if (spHits != null) hints.push(`${spHits.toFixed(3)} H/PA SP`);
      if (parkAdj.hint) hints.push(parkAdj.hint);
      return { expected, modifierHint: hints.join(' · ') };
    }

    case 18: { // BB — log5 blend (SP, bullpen BB/PA) + park.
      const spBb = sp?.talent?.bbPerPA ?? null;
      const rpBb = oppRp?.bbPerPA ?? null;
      const blended = blendLog5(baseline, spBb, rpBb, LEAGUE_BB_PER_PA, spShare);
      const expected = blended * parkAdj.multiplier;
      const hints: string[] = [];
      if (spBb != null) hints.push(`${(spBb * 100).toFixed(0)}% BB SP`);
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
  // Per-category platoon (per-cat) — applied after the SP/park/weather
  // modifier. Multiplicative, so order vs the pitcher modifier doesn't
  // matter. Regresses the batter's own vs-hand split toward the population
  // target, weighted by his PA on that side; see platoon.ts.
  const facingHand = facingHandFrom(ctx?.opposingPitcher?.throws);
  const handRatios = facingHand === 'L' ? stats.ratiosVsL : facingHand === 'R' ? stats.ratiosVsR : null;
  const handPA = facingHand === 'L' ? stats.paVsL : facingHand === 'R' ? stats.paVsR : 0;
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
    const obsRatio = handRatios?.[statId];
    const obs = obsRatio != null ? { ratio: obsRatio, pa: handPA } : null;
    const platoonMult = platoonFactor(statId, stats.bats, facingHand, obs);
    let hint = modifierHint;
    if (facingHand && Math.abs(platoonMult - 1) >= 0.02) {
      const pct = Math.round((platoonMult - 1) * 100);
      const token = `vs ${facingHand}HP ${pct >= 0 ? '+' : ''}${pct}%`;
      hint = hint ? `${hint} · ${token}` : token;
    }
    perCategory[statId] = {
      baseline: baselineResult.rate,
      expected: expected * platoonMult,
      effectivePA: baselineResult.effectivePA,
      modifierHint: hint,
    };
  }
  return { perCategory };
}
