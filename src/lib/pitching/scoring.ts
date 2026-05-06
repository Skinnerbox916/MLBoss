/**
 * Streaming-page rating composition layer.
 *
 * This module is the consumer-facing surface for "score this pitcher in
 * this game." It composes the lower layers (`buildGameForecast` from
 * forecast.ts and `getPitcherRating` from rating.ts) into a UI-shaped
 * output that matches the streaming board's column model:
 *
 *   - 0-1 composite (legacy scale; lower layers use 0-100)
 *   - Per-category contributions keyed by `StreamGoal` ('QS', 'K', etc.)
 *     with display strings ready for table cells
 *   - Velocity and platoon multipliers
 *   - Sample-quality cue (was a "credibility multiplier" in the prior
 *     architecture; now informational only — sample-size handling lives
 *     in the talent layer's Bayesian regression)
 *
 * The exported `scorePitcher` function is intentionally distinct from
 * `getPitcherRating` in `rating.ts`. The rating-layer function is a pure
 * function from `GameForecast` to a 0-100 score; this one takes the raw
 * `ProbablePitcher` + `MLBGame` bag and returns the table-ready shape.
 * Don't add talent or tier logic here — extend the lower layers and let
 * this module's adapter pick it up.
 */

import type { ProbablePitcher, ParkData, GameWeather, EnrichedGame } from '@/lib/mlb/types';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';
import { buildGameForecast, type ContextMultiplier } from './forecast';
import {
  getPitcherRating as ratingV2,
  tierFromScore,
  type PitcherRating as RatingV2,
  type PitcherTier as RatingTier,
} from './rating';

// ---------------------------------------------------------------------------
// Legacy types (preserved for back-compat — StreamingBoard etc. read them)
// ---------------------------------------------------------------------------

/** Yahoo stat_ids for the streaming-relevant pitcher categories. The
 *  five core stream goals drive the strong/weak pill under each row;
 *  `IP` is a scored cat in some leagues but never gets a stream pill
 *  (you don't "stream IP" — it's a side effect of QS/W). */
export const PITCHER_CATEGORY_STAT_IDS = {
  QS: 83,
  K: 42,
  W: 28,
  ERA: 26,
  WHIP: 27,
  IP: 50,
} as const;

export type StreamGoal = keyof typeof PITCHER_CATEGORY_STAT_IDS;

/** Stream-pill goals — the categories `getStreamPills` will surface as
 *  strong/weak. IP is intentionally excluded; the rating still scores
 *  IP for leagues that count it, but no pill. */
const STREAM_PILL_GOALS = ['QS', 'K', 'W', 'ERA', 'WHIP'] as const;

const STAT_ID_TO_GOAL: Record<number, StreamGoal> = {
  83: 'QS',
  42: 'K',
  28: 'W',
  26: 'ERA',
  27: 'WHIP',
  50: 'IP',
};

/** Single canonical short labels — used by both the collapsed strip and
 *  the expanded category-fit table. We deliberately use the short forms
 *  ("K" / "W") over long forms ("Strikeouts" / "Wins") because the row
 *  layout is space-constrained and consistency between collapsed and
 *  expanded reduces cognitive load. The full names are available in
 *  the breakdown panel's tooltips on hover. */
const GOAL_LABEL: Record<StreamGoal, string> = {
  QS: 'QS', K: 'K', W: 'W', ERA: 'ERA', WHIP: 'WHIP', IP: 'IP',
};

export interface StreamPill {
  goal: StreamGoal;
  verdict: 'strong' | 'weak';
}

export interface ScoreComponent {
  label: string;
  detail: string;
  val: number;     // 0-1 sub-score (higher = better for the pitcher)
  weight: number;  // contribution weight (sum = 1.0 across rendered components)
  labelOverride?: string;
}

export interface ScoredBreakdown {
  total: number;
  components: ScoreComponent[];
}

export interface PillInput {
  pp: ProbablePitcher;
  oppOffense: TeamOffense | null;
  park: ParkData | null;
  weather: GameWeather;
  isHome: boolean;
  game: EnrichedGame;
  scoredCategories?: EnrichedLeagueStatCategory[];
  focusMap?: Record<number, Focus>;
}

export type PitcherRatingMultiplier = ContextMultiplier;

export interface PitcherCategoryContribution {
  statId: number;
  goal: StreamGoal;
  label: string;
  /** 0-1 where 1 = best possible for this category. */
  subScore: number;
  weight: number;
  contribution: number;  // weight * (subScore - 0.5)
  focus: Focus;
  /** Display string like ".295 BAA · 5.8 IP/GS". */
  detail: string;
}

export interface PitcherCredibility {
  multiplier: number;
  currentIp: number;
  priorIp: number;
  reason: string;
}

/** UI-shaped rating produced by `scorePitcher`. Distinct from the
 *  rating-layer `PitcherRating` (in `./rating`) which uses the canonical
 *  0-100 score and is structured for the rating engine, not the table. */
export interface PitcherStreamingRating {
  /** Final 0-1 composite (legacy scale). The new rating layer produces
   *  0-100; we divide by 100 here for back-compat with table widgets. */
  score: number;
  /** Symmetric ± uncertainty band on the score. Same units as `score`
   *  (0-1 scale; multiply by 100 for display). Renders next to the
   *  score when band ≥ 0.05. */
  scoreBand: number;
  /** Pre-multiplier composite (also 0-1). */
  base: number;
  velocity: PitcherRatingMultiplier;
  platoon: PitcherRatingMultiplier;
  credibility: PitcherCredibility;
  categories: PitcherCategoryContribution[];
  /** Tier derived from the canonical score via `tierFromScore`. */
  tier: RatingTier;
  confidence: { level: 'high' | 'medium' | 'low'; reason: string; band: number };
}

// ---------------------------------------------------------------------------
// Tier label / re-exports from rating layer
// ---------------------------------------------------------------------------

// Both re-exported so the streaming-board and today-page can import
// the rating + label helpers from a single module. Canonical homes are
// in `./rating`; this file is the streaming-page composition layer.
export { tierFromScore, tierLabel } from './rating';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Build the table-shaped credibility object from the rating layer's
 *  confidence cue. The Bayesian regression at the talent layer already
 *  protected against thin-sample inflation, so the multiplier here is
 *  always 1.0 — we don't downweight a second time. The reason string is
 *  preserved so the breakdown UI can show the user why a thin-sample
 *  rating is what it is. */
function buildCredibilityCell(rating: RatingV2, currentIp: number): PitcherCredibility {
  return {
    multiplier: 1.0,
    currentIp,
    priorIp: 0,
    reason: rating.confidence.reason,
  };
}

// ---------------------------------------------------------------------------
// Default-cat fallback when consumer doesn't supply scoredCategories
// ---------------------------------------------------------------------------

const DEFAULT_SCORED_CATS: EnrichedLeagueStatCategory[] = [
  { stat_id: 83, name: 'Quality Starts', display_name: 'QS', betterIs: 'higher',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false, sort_order: '1' },
  { stat_id: 42, name: 'Strikeouts', display_name: 'K', betterIs: 'higher',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false, sort_order: '1' },
  { stat_id: 28, name: 'Wins', display_name: 'W', betterIs: 'higher',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false, sort_order: '1' },
  { stat_id: 26, name: 'Earned Run Average', display_name: 'ERA', betterIs: 'lower',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false, sort_order: '0' },
  { stat_id: 27, name: 'WHIP', display_name: 'WHIP', betterIs: 'lower',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false, sort_order: '0' },
];

// ---------------------------------------------------------------------------
// Core: scorePitcher
// ---------------------------------------------------------------------------

/**
 * UI-shaped streaming rating for a single pitcher matchup.
 *
 * Composes Layer-2 forecast + Layer-3 rating into the table-shaped
 * output the streaming board / today / breakdown panel consume.
 *
 *   - `score` is the 0-1 form of the canonical 0-100 rating
 *   - `categories[].subScore` is the canonical `normalized`
 *   - `credibility` is the canonical `confidence` reshaped (multiplier
 *     always 1.0 — sample-size handling lives upstream in the talent
 *     layer's Bayesian regression)
 *
 * Returns a neutral rating (score 0.5, no multipliers) when the pitcher
 * has no talent vector — same fail-safe behaviour the page expects.
 */
export function scorePitcher(input: PillInput): PitcherStreamingRating {
  const { pp, game, isHome, oppOffense, scoredCategories, focusMap } = input;

  if (!pp.talent) {
    return neutralStreamingRating(pp.inningsPitched);
  }

  const opposingProbable = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;
  const opposingTalent = opposingProbable?.talent ?? null;

  const forecast = buildGameForecast({
    pitcher: pp.talent,
    game,
    isHome,
    opposingOffense: oppOffense,
    opposingPitcher: opposingTalent,
  });

  const cats = scoredCategories ?? DEFAULT_SCORED_CATS;
  const canonical = ratingV2({ forecast, scoredCategories: cats, focusMap: focusMap ?? {} });

  const tableCats: PitcherCategoryContribution[] = canonical.categories.map(c => {
    // Map stat_id → StreamGoal. If the rating layer added a category we
    // haven't registered here, fall back to the rating layer's own label
    // for both `goal` and `label` — this keeps the breakdown panel honest
    // (no more "Strikeouts twice" when IP slips through unmapped) and
    // prevents the goal-label drift that was producing duplicate rows.
    const mappedGoal = STAT_ID_TO_GOAL[c.statId];
    return {
      statId: c.statId,
      goal: mappedGoal ?? (c.label as StreamGoal),
      label: mappedGoal ? GOAL_LABEL[mappedGoal] : c.label,
      subScore: c.normalized,
      weight: c.weight,
      contribution: c.contribution,
      focus: c.focus,
      detail: c.modifierHint ? `${c.display} · ${c.modifierHint}` : c.display,
    };
  });

  return {
    score: canonical.score / 100,
    scoreBand: canonical.confidence.band / 100,
    base: canonical.score / 100,
    velocity: canonical.velocity,
    platoon: canonical.platoon,
    credibility: buildCredibilityCell(canonical, pp.inningsPitched),
    categories: tableCats,
    tier: canonical.tier,
    confidence: canonical.confidence,
  };
}

function neutralStreamingRating(currentIp: number): PitcherStreamingRating {
  const noMult: ContextMultiplier = {
    multiplier: 1.0, deltaPct: 0, display: '—',
    summary: 'No data', available: false,
  };
  return {
    score: 0.5,
    scoreBand: 0.15,
    base: 0.5,
    velocity: noMult,
    platoon: noMult,
    credibility: { multiplier: 1.0, currentIp, priorIp: 0, reason: 'No talent vector' },
    categories: [],
    tier: tierFromScore(50),
    confidence: { level: 'low', reason: 'No data', band: 15 },
  };
}

// ---------------------------------------------------------------------------
// Convenience wrappers around scorePitcher
// ---------------------------------------------------------------------------

export function overallScore(input: PillInput): number {
  return scorePitcher(input).score;
}

export function computeBreakdown(input: PillInput): ScoredBreakdown {
  const rating = scorePitcher(input);
  const components: ScoreComponent[] = rating.categories.map(cat => ({
    label: cat.label,
    detail: cat.detail,
    val: cat.subScore,
    weight: cat.weight,
  }));
  if (rating.velocity.available) {
    components.push({
      label: 'Velocity',
      detail: `${rating.velocity.display} · ${rating.velocity.summary}`,
      val: clamp01(0.5 + rating.velocity.deltaPct / 14),
      weight: 0,
    });
  }
  if (rating.platoon.available) {
    components.push({
      label: 'Platoon',
      detail: `${rating.platoon.display} · ${rating.platoon.summary}`,
      val: clamp01(0.5 + rating.platoon.deltaPct / 10),
      weight: 0,
    });
  }
  // Surface sample quality as a breakdown row when it's not 'high'.
  // Replaces the legacy "Experience" credibility row. We label this
  // "Sample" rather than "Confidence" because we're not actually
  // computing a probabilistic confidence bound — it's a cue about how
  // much data is backing the estimate. The Bayesian regression at the
  // talent layer already handled the math; this is purely informational.
  if (rating.confidence.level !== 'high') {
    components.push({
      label: 'Sample',
      detail: rating.confidence.reason,
      val: rating.confidence.level === 'medium' ? 0.65 : 0.4,
      weight: 0,
      labelOverride: rating.confidence.level === 'medium' ? 'Medium' : 'Thin',
    });
  }
  return { total: rating.score, components };
}

// ---------------------------------------------------------------------------
// Stream pills
//
// Now driven by the new normalized sub-scores. Strong ≥ 0.72, Weak ≤
// 0.35 — same thresholds as before since `normalized` lives on the same
// 0-1 scale as the old `subScore`.
// ---------------------------------------------------------------------------

export function getStreamPills(input: PillInput): StreamPill[] {
  const pills: StreamPill[] = [];
  // Confidence gate replaces the old credibility-multiplier gate. We
  // suppress pills only on truly low-confidence ratings — the talent
  // layer already protected against thin-sample inflation.
  const rating = scorePitcher({ ...input, focusMap: {}, scoredCategories: undefined });
  if (rating.confidence.level === 'low') return pills;

  const byGoal = new Map<StreamGoal, PitcherCategoryContribution>();
  for (const c of rating.categories) byGoal.set(c.goal, c);

  for (const goal of STREAM_PILL_GOALS) {
    const cat = byGoal.get(goal);
    if (!cat) continue;

    // Hard depth gate on QS — even a great rating can't QS a 4.6-IP arm.
    if (goal === 'QS' && input.pp.inningsPerStart !== null && input.pp.inningsPerStart < 5.0) {
      pills.push({ goal, verdict: 'weak' });
      continue;
    }

    if (cat.subScore >= 0.72) {
      pills.push({ goal, verdict: 'strong' });
    } else if (cat.subScore <= 0.35) {
      pills.push({ goal, verdict: 'weak' });
    }
  }

  return pills;
}
