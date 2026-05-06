/**
 * Pitcher Rating — Layer 3.
 *
 * Project a `GameForecast` (Layer 2) onto the user's league-scored
 * categories with their chase/punt focus, producing a 0-100 score with
 * 50 = neutral. Mirrors the structural shape of `getBatterRating` —
 * per-category contributions, focus-weighted composite, composite
 * multipliers, tier derived from score.
 *
 *   score = 100 × Σ (cat.weight × cat.normalized) × platoon.multiplier
 *
 * **Architecture rule (post-2026-05):** only matchup-wide signals that
 * scale every category proportionally multiply the composite. As of
 * 2026-05, that's just platoon (the SP's weak-handed side stack).
 * Velocity used to be a composite multiplier here too, but YoY velo
 * delta is now an input to the talent-layer regime-shift probe (see
 * `computeRegimeShift` in talent.ts), which folds it into the per-PA
 * outcome rates by adjusting how much weight the prior season carries.
 * Keeping a composite-level velo multiplier on top of that would
 * double-count.
 *
 * Stat-specific signals — park, opp, weather — live at the per-PA
 * layer (in `forecast.ts`) where they shape `expectedPerPA` directly.
 * They show up here in `Rating.surface` for breakdown display only;
 * they do NOT multiply the score a second time.
 *
 * Why: Coors suppresses K and inflates HR by different amounts; pulling
 * those into a single composite multiplier flattens that distinction
 * and double-counts versus the per-PA effect already applied. The
 * per-cat layer is where stat-specific signals belong.
 *
 * Bullpen does NOT multiply the composite either (architecture decision
 * a1): it only affects the W probability, which is itself one of the
 * categories. Including bullpen at the composite would dilute K/ERA/
 * WHIP scores for pitchers behind a bad pen, which isn't right.
 *
 * Tier label is derived from `score`, NOT classified separately. There
 * is exactly one mapping (score → tier) and it lives in
 * `src/lib/rating/types.ts`. The Montero ACE-vs-FAIR situation is
 * structurally impossible: tier and score are projections of the same
 * number.
 */

import type { Focus } from '@/lib/mlb/batterRating';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { GameForecast, ContextMultiplier } from './forecast';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PitcherTier = 'ace' | 'tough' | 'average' | 'weak' | 'bad';

export interface PitcherCategoryContribution {
  statId: number;
  /** Display label — Yahoo-mapped here. */
  label: string;
  /** Whether higher or lower is better for this stat. Drives normalization. */
  betterIs: 'higher' | 'lower';
  /** Expected value of the stat in this game (e.g. 6.4 K, 2.8 ER, 5.5 IP). */
  expected: number;
  /** Normalized into [0,1] against the league window for this stat.
   *  Always "higher = more favorable for the pitcher", regardless of
   *  betterIs (we invert internally for lower-is-better cats). */
  normalized: number;
  /** Weight assigned by the focus map. Sums to 1.0 across non-punted cats. */
  weight: number;
  /** weight × (normalized - 0.5). Signed contribution in points-of-score. */
  contribution: number;
  focus: Focus;
  /** Display string — e.g. "6.4 K · 5.4 IP", "3.1 ER · 4.30 ERA". */
  display: string;
  /** Short matchup-modifier hint — e.g. "vs weak K-rate · pitcher park". */
  modifierHint: string;
}

export interface PitcherRating {
  /** Final composite 0-100 (50 = neutral). */
  score: number;
  /** score - 50 — for the "net vs neutral" header. */
  netVsNeutral: number;
  /** Tier label, derived from score via `tierFromScore`. */
  tier: PitcherTier;
  /** All scored categories, in stable order. */
  categories: PitcherCategoryContribution[];
  /** **Composite-level multipliers** — these were applied to the score.
   *  Only velocity and platoon scale every category proportionally; the
   *  others (park, weather, opp) live in `surface` because they're
   *  already folded in at the per-PA layer. Bullpen is intentionally
   *  excluded (only affects P(W); see file header). */
  velocity: ContextMultiplier;
  platoon: ContextMultiplier;
  /** **Surface multipliers** — these are computed for the breakdown UI
   *  to show the user WHY their per-cat numbers landed where they did,
   *  but they did NOT multiply the final score (already in per-PA layer).
   *  Treating them as composite multipliers would double-count. */
  park: ContextMultiplier;
  weather: ContextMultiplier;
  opp: ContextMultiplier;
  /** Confidence cue — surfaced in the UI as a pill plus a numeric ±
   *  band on the score. Comes through from the talent layer; the rating
   *  doesn't add or remove confidence. */
  confidence: { level: 'high' | 'medium' | 'low'; reason: string; band: number };
}

// ---------------------------------------------------------------------------
// Normalization windows per Yahoo stat_id
// ---------------------------------------------------------------------------

interface NormWindow {
  /** Display label (Yahoo-mapped). */
  label: string;
  /** "lower" or "higher" wins this category. */
  betterIs: 'higher' | 'lower';
  /** Worst end of the rating window — maps to 0.0. */
  worst: number;
  /** Best end of the rating window — maps to 1.0. */
  best: number;
  /** How to format the expected value for display. */
  formatExpected: (v: number) => string;
}

const PITCHER_NORM: Record<number, NormWindow> = {
  // QS — P(QS), so window is straightforwardly 0-1.
  83: {
    label: 'QS', betterIs: 'higher', worst: 0.10, best: 0.70,
    formatExpected: (v) => `${(v * 100).toFixed(0)}% QS`,
  },
  // K — per-game expected K count. Window 3.5 (low) → 9.0 (elite).
  42: {
    label: 'K', betterIs: 'higher', worst: 3.5, best: 9.0,
    formatExpected: (v) => `${v.toFixed(1)} K`,
  },
  // W — P(W). Window 0.20 (long-shot) → 0.65 (favorite).
  28: {
    label: 'W', betterIs: 'higher', worst: 0.20, best: 0.65,
    formatExpected: (v) => `${(v * 100).toFixed(0)}% W`,
  },
  // ERA — per-game expected ERA. Window 5.50 (worst) → 2.30 (best).
  26: {
    label: 'ERA', betterIs: 'lower', worst: 5.50, best: 2.30,
    formatExpected: (v) => `${v.toFixed(2)} ERA`,
  },
  // WHIP — per-game expected WHIP. Window 1.55 → 0.95.
  27: {
    label: 'WHIP', betterIs: 'lower', worst: 1.55, best: 0.95,
    formatExpected: (v) => `${v.toFixed(2)} WHIP`,
  },
  // IP — per-game expected IP. Window 4.5 → 6.0.
  //
  // The 7.0 ceiling we used originally was wishful thinking — almost no
  // modern MLB starter averages 7+ IP across a season. Realistic
  // distribution:
  //
  //   ~4.5 IP   back-end starter / opener territory     → 0
  //   ~5.4 IP   league-average starter                  → 0.60
  //   ~6.0 IP   the best workhorses (Skubal, Burnes-y)  → 1.0
  //
  // With best=6.0, a 5.4-IP projection scores 60 ("clearly good for an
  // IP-counting league") instead of 36 ("apparently bad?"). League-mean
  // outcomes naturally land above 50 on this cat because IP/start
  // distribution is left-skewed — most regular SPs cluster between
  // 5.0-5.8 and 6.5+ outliers are rare.
  50: {
    label: 'IP', betterIs: 'higher', worst: 4.5, best: 6.0,
    formatExpected: (v) => `${v.toFixed(1)} IP`,
  },
};

/** Categories the engine knows how to project. */
export function supportsPitcherStatId(statId: number): boolean {
  return statId in PITCHER_NORM;
}

// ---------------------------------------------------------------------------
// Project forecast to category expected
// ---------------------------------------------------------------------------

function projectCategory(
  statId: number,
  forecast: GameForecast,
): { expected: number; modifierHint: string } | null {
  const eg = forecast.expectedPerGame;
  switch (statId) {
    case 83: return { expected: forecast.probabilities.qs, modifierHint: '' };
    case 42: return { expected: eg.k, modifierHint: pickKHint(forecast) };
    case 28: return { expected: forecast.probabilities.w, modifierHint: pickWHint(forecast) };
    case 26: return { expected: forecast.expectedERA, modifierHint: pickEraHint(forecast) };
    case 27: return { expected: (eg.bb + eg.h) / Math.max(0.1, eg.ip), modifierHint: pickWhipHint(forecast) };
    case 50: return { expected: eg.ip, modifierHint: '' };
    default: return null;
  }
}

function pickKHint(f: GameForecast): string {
  // Prefer the strongest non-neutral signal: opp K-rate vs hand or velocity.
  const opp = f.multipliers.opp;
  if (opp.available && Math.abs(opp.deltaPct) >= 3) {
    return opp.deltaPct > 0 ? 'weak lineup' : 'tough lineup';
  }
  return '';
}

function pickWHint(f: GameForecast): string {
  const bullpen = f.multipliers.bullpen;
  if (bullpen.available && Math.abs(bullpen.deltaPct) >= 4) {
    return bullpen.deltaPct > 0 ? 'elite pen' : 'shaky pen';
  }
  return '';
}

function pickEraHint(f: GameForecast): string {
  const park = f.multipliers.park;
  const weather = f.multipliers.weather;
  if (park.available && Math.abs(park.deltaPct) >= 4) {
    return park.summary.toLowerCase();
  }
  if (weather.available && Math.abs(weather.deltaPct) >= 3) {
    return weather.summary.toLowerCase();
  }
  return '';
}

function pickWhipHint(f: GameForecast): string {
  // BB/9 from talent — roughly bbPerPA × 4.3 × 9 / 1.
  const bb9 = f.pitcher.bbPerPA * 4.3 * 9 / 1;
  if (bb9 <= 2.2) return 'elite command';
  if (bb9 >= 3.8) return 'shaky command';
  return '';
}

function normalize(expected: number, window: NormWindow): number {
  const { worst, best, betterIs } = window;
  if (betterIs === 'higher') {
    return clamp01((expected - worst) / (best - worst));
  } else {
    return clamp01((worst - expected) / (worst - best));
  }
}

// ---------------------------------------------------------------------------
// Weight vector — same shape as batterRating.buildWeightVector
// ---------------------------------------------------------------------------

function buildPitcherWeightVector(
  scoredStatIds: number[],
  focusMap: Record<number, Focus>,
): Record<number, number> {
  const active = scoredStatIds.filter(id => (focusMap[id] ?? 'neutral') !== 'punt');
  if (active.length === 0) {
    const empty: Record<number, number> = {};
    for (const id of scoredStatIds) empty[id] = 0;
    return empty;
  }
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
// Tier derivation — the ONLY mapping from score to tier
// ---------------------------------------------------------------------------

/**
 * Single source of truth for "what tier is this pitcher?". Used by all
 * UI badges. There is no alternative classifier; if you want a tier
 * label, you compute the score and read it through here.
 */
export function tierFromScore(score: number): PitcherTier {
  if (score >= 78) return 'ace';
  if (score >= 62) return 'tough';
  if (score >= 42) return 'average';
  if (score >= 28) return 'weak';
  return 'bad';
}

/** Display label for a rating-derived tier. The single source of truth
 *  for this mapping; `scoring.ts` re-exports for convenience. The
 *  `undefined` branch covers the streaming UI where the rating may not
 *  exist yet (loading state). */
export function tierLabel(tier: PitcherTier | undefined): string {
  if (!tier) return '?';
  switch (tier) {
    case 'ace': return 'ACE';
    case 'tough': return 'Tough';
    case 'average': return 'Avg';
    case 'weak': return 'Weak';
    case 'bad': return 'Bad';
  }
}

// `tierColor` lives in `pitching/display.tsx` — the UI-helper module.
// Don't add a duplicate here; consumers should import from display.

// ---------------------------------------------------------------------------
// Core: getPitcherRating
// ---------------------------------------------------------------------------

export interface PitcherRatingArgs {
  forecast: GameForecast;
  scoredCategories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, Focus>;
}

export function getPitcherRating(args: PitcherRatingArgs): PitcherRating {
  const { forecast, scoredCategories, focusMap } = args;
  const { multipliers, pitcher } = forecast;

  // Filter to scored cats this engine can project.
  const supported = scoredCategories.filter(c => supportsPitcherStatId(c.stat_id));
  const statIds = supported.map(c => c.stat_id);
  const weights = buildPitcherWeightVector(statIds, focusMap);

  const contributions: PitcherCategoryContribution[] = [];
  let composite = 0;

  for (const cat of supported) {
    const window = PITCHER_NORM[cat.stat_id]!;
    const projection = projectCategory(cat.stat_id, forecast);
    if (!projection) continue;

    const normalized = normalize(projection.expected, window);
    const weight = weights[cat.stat_id] ?? 0;
    const focus = focusMap[cat.stat_id] ?? 'neutral';
    const contribution = weight * (normalized - 0.5);

    contributions.push({
      statId: cat.stat_id,
      label: window.label,
      betterIs: window.betterIs,
      expected: projection.expected,
      normalized,
      weight,
      contribution,
      focus,
      display: window.formatExpected(projection.expected),
      modifierHint: projection.modifierHint,
    });
    composite += weight * normalized;
  }

  const activeWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const preMult = activeWeight > 0 ? composite * 100 : 50;

  // Apply composite-level multipliers — only platoon. Velocity is
  // folded into the talent layer's regime probe instead of multiplying
  // the composite a second time (see file header). Park, weather, opp
  // already shape per-cat values upstream in the forecast layer.
  // Bullpen affects only P(W), which is its own category.
  const finalScore = activeWeight > 0
    ? preMult * multipliers.platoon.multiplier
    : preMult;

  const score = Math.max(0, Math.min(100, Math.round(finalScore)));
  const netVsNeutral = score - 50;
  const tier = tierFromScore(score);

  return {
    score,
    netVsNeutral,
    tier,
    categories: contributions,
    velocity: multipliers.velocity,
    platoon: multipliers.platoon,
    park: multipliers.park,
    weather: multipliers.weather,
    opp: multipliers.opp,
    confidence: { level: pitcher.confidence, reason: pitcher.confidenceReason, band: pitcher.confidenceBand },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
