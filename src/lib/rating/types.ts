/**
 * Unified rating types shared between batter and pitcher engines.
 *
 * Both `getBatterRating` and `scorePitcher` return `Rating`. The
 * discriminator `engine: 'batter' | 'pitcher'` carries the tier
 * vocabulary; everything else (composite, surface, categories,
 * confidence) is structurally identical.
 *
 * Design rule: only multipliers that genuinely scale every category
 * proportionally live in `composite.multipliers`. Stat-specific signals
 * (park, opp, weather) feed the per-cat layer and surface here as
 * `surface` for breakdown display only — they do NOT multiply the score
 * a second time. See docs/unified-rating-model.md for the why.
 */
export type PitcherTier = 'ace' | 'tough' | 'average' | 'weak' | 'bad';
export type BatterTier = 'great' | 'good' | 'neutral' | 'poor' | 'bad';

export type Focus = 'neutral' | 'chase' | 'punt';

export interface ContextMultiplier {
  /** 1.0 = neutral. Already clamped to the engine's per-multiplier band. */
  multiplier: number;
  /** (multiplier − 1) × 100, rounded for display. Sign carries direction
   *  (positive = boosts the player, negative = hurts). */
  deltaPct: number;
  /** Short raw display ("Coors", "+1.4 mph", "vs RHP", "PF 112"). */
  display: string;
  /** Human-readable summary ("Hitter park", "Velo trending up"). */
  summary: string;
  /** Whether the underlying data was actually present. UI can hide rows
   *  with `available: false`. */
  available: boolean;
}

export interface CategoryContribution {
  statId: number;
  /** Display label ("AVG", "K", "ERA"). */
  label: string;
  /** Whether higher or lower of the underlying rate is better. Surface
   *  hint only — `normalized` is always "1 = best for the player". */
  betterIs: 'higher' | 'lower';
  /** 0-1 normalized score against the league window. 1 = best possible
   *  for this matchup, 0 = worst. */
  normalized: number;
  /** User-set weight (chase=2, neutral=1, punt=0, renormalised across
   *  the league's scored cats). */
  weight: number;
  /** weight × (normalized − 0.5) — signed contribution in score points. */
  contribution: number;
  focus: Focus;
  /** Pre-formatted display string (e.g. ".298 AVG", "6.4 K · 5.4 IP"). */
  display: string;
  /** Short per-cat modifier hint (e.g. "vs ace · Coors", "weak lineup"). */
  modifierHint: string;
  /** Effective sample size behind the per-cat baseline. Drives the
   *  per-cat shrinkage that aggregates into Rating.confidence.band. */
  effectivePA: number;
}

export interface RatingConfidence {
  /** Bucket — kept for backwards-compatible display ("Sample: Thin"). */
  level: 'high' | 'medium' | 'low';
  /** Human-readable reason ("130 effective PA · signals aligned"). */
  reason: string;
  /** Numeric ± uncertainty band on the score, in score points. Rendered
   *  next to the score when ≥ 5. Capped at 15. */
  band: number;
}

interface RatingBase {
  /** 0-100, 50 = neutral. */
  score: number;
  /** Symmetric ± uncertainty band on the score. Same as
   *  `confidence.band` — duplicated at the top level for ergonomic
   *  destructuring at common UI sites. */
  scoreBand: number;
  /** score − 50, for the "net vs neutral" header. */
  netVsNeutral: number;
  categories: CategoryContribution[];
  /** Composite multipliers — these were applied to the score. */
  composite: {
    multipliers: Record<string, ContextMultiplier>;
  };
  /** Surface multipliers — context the user sees in the breakdown but
   *  that have already been folded in at the per-cat layer. NOT applied
   *  to the composite. Examples: park, weather, opposing-lineup quality. */
  surface: {
    park: ContextMultiplier;
    weather: ContextMultiplier;
    opp: ContextMultiplier;
  };
  confidence: RatingConfidence;
}

export interface PitcherRating extends RatingBase {
  engine: 'pitcher';
  tier: PitcherTier;
}

export interface BatterRating extends RatingBase {
  engine: 'batter';
  tier: BatterTier;
}

export type Rating = PitcherRating | BatterRating;

// ---------------------------------------------------------------------------
// Tier helpers — single source of truth for score → tier mapping
// ---------------------------------------------------------------------------

/** Pitcher: ace ≥ 78, tough ≥ 62, average ≥ 42, weak ≥ 28, bad < 28.
 *  These thresholds were calibrated against the synthetic archetypes in
 *  /api/admin/test-pitcher-eval. Touch with care; re-run the harness. */
export function pitcherTierFromScore(score: number): PitcherTier {
  if (score >= 78) return 'ace';
  if (score >= 62) return 'tough';
  if (score >= 42) return 'average';
  if (score >= 28) return 'weak';
  return 'bad';
}

/** Batter: great ≥ 70, good ≥ 55, neutral ≥ 45, poor ≥ 30, bad < 30. */
export function batterTierFromScore(score: number): BatterTier {
  if (score >= 70) return 'great';
  if (score >= 55) return 'good';
  if (score >= 45) return 'neutral';
  if (score >= 30) return 'poor';
  return 'bad';
}

export function pitcherTierLabel(t: PitcherTier | undefined): string {
  if (!t) return '?';
  switch (t) {
    case 'ace': return 'ACE';
    case 'tough': return 'Tough';
    case 'average': return 'Avg';
    case 'weak': return 'Weak';
    case 'bad': return 'Bad';
  }
}

export function batterTierLabel(t: BatterTier | undefined): string {
  if (!t) return '?';
  switch (t) {
    case 'great': return 'Great';
    case 'good': return 'Good';
    case 'neutral': return 'Neutral';
    case 'poor': return 'Poor';
    case 'bad': return 'Bad';
  }
}

/** Format the score for display. Includes the band when ≥ 5. */
export function formatScore(score: number, band: number): string {
  const s = Math.round(score);
  if (band >= 5) return `${s} ± ${Math.round(band)}`;
  return `${s}`;
}

// ---------------------------------------------------------------------------
// Helper: build a neutral ContextMultiplier
// ---------------------------------------------------------------------------

export function neutralMultiplier(display = '—', summary = 'No data'): ContextMultiplier {
  return { multiplier: 1.0, deltaPct: 0, display, summary, available: false };
}
