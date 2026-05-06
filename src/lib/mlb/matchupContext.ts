/**
 * Unified MatchupContext shared between the batter and pitcher rating
 * engines. Replaces:
 *   - the old `MatchupContext` in `analysis.ts` (batter side, re-exported
 *     here for back-compat during migration)
 *   - the ad-hoc `BuildForecastArgs` shape inside `forecast.ts`
 *
 * The discriminator blocks `asBatter` / `asPitcher` carry engine-specific
 * inputs that don't make sense for the other side. Either is allowed to
 * be null when the consumer is only rating one direction (the streaming
 * board rates pitchers; the lineup optimizer rates batters; both pages
 * could in principle rate either if we ever build that surface).
 *
 * `game.park` is the single source of truth for park data — there is no
 * separate `park` field on this context. Readers go through `game.park`.
 */
import type { EnrichedGame, ProbablePitcher } from './types';
import type { TeamOffense } from './teams';
import type { PitcherTalent } from '@/lib/pitching/talent';

/** Inputs needed when the player being rated is a pitcher. */
export interface AsPitcherContext {
  talent: PitcherTalent;
  /** The pitcher's opposing offense, looked up from the team-offense
   *  cache by the orchestrator. */
  opposingOffense: TeamOffense | null;
}

/** Inputs needed when the player being rated is a batter. */
export interface AsBatterContext {
  hand: 'L' | 'R' | 'S' | null;
  /** 1-9 batting order; null when not posted yet (D+1+). */
  battingOrder: number | null;
}

export interface MatchupContext {
  game: EnrichedGame;
  isHome: boolean;
  /** The opposing SP for the player being rated. Always present in both
   *  directions: the batter side log5s against `opposingPitcher.talent`,
   *  and the pitcher side reads `opposingPitcher.talent` for the W
   *  probability vs the opposing ace. */
  opposingPitcher: ProbablePitcher | null;
  asPitcher: AsPitcherContext | null;
  asBatter: AsBatterContext | null;
}

/**
 * Shorthand accessor: the park for this matchup. Resolved from `game.park`
 * — feature code should NOT read `ctx.game.park` directly to keep the
 * door open for future "no park" handling (international games, etc.)
 * but for now this is just `ctx.game.park`.
 */
export function ctxPark(ctx: MatchupContext): EnrichedGame['park'] {
  return ctx.game.park;
}
