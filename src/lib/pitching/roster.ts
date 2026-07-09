/**
 * Pitcher Roster Logic — Neutral Evaluations.
 *
 * Provides a "Neutral Forecast" (matchup context stripped) so pitchers
 * can be scored and ranked for long-term roster construction,
 * independent of their next probable start.
 */

import type { PitcherTalent } from './talent';
import { buildGameForecast } from './forecast';
import { getPitcherRating, type PitcherRating } from './rating';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/rating/focus';
import type { EnrichedGame } from '@/lib/mlb/types';

/**
 * Build a synthetic "Neutral Game" for roster construction purposes.
 * Park, weather, and opponent staff are all pinned to league-average
 * (1.0 multipliers).
 */
export function buildNeutralGame(): EnrichedGame {
  return {
    gamePk: 0,
    gameDate: new Date().toISOString(),
    status: 'Scheduled',
    homeTeam: { mlbId: 0, name: 'Neutral', abbreviation: 'NEU', staffEra: 4.20 },
    awayTeam: { mlbId: 0, name: 'Neutral', abbreviation: 'NEU', staffEra: 4.20 },
    venue: { mlbId: 0, name: 'Neutral Park' },
    weather: { temperature: 72, condition: 'Clear', wind: '0 mph', windSpeed: 0, windDirection: 'None' },
    homeProbablePitcher: null,
    awayProbablePitcher: null,
    homeLineup: [],
    awayLineup: [],
    park: {
      mlbVenueId: 0, name: 'Neutral Park', teamAbbr: 'NEU', city: 'Neutral', lat: 0, lng: 0,
      surface: 'grass', roof: 'open',
      parkFactor: 100, parkFactorHR: 100, parkFactorL: 100, parkFactorR: 100,
      parkFactorHrL: 100, parkFactorHrR: 100, parkFactorBACON: 100,
      parkFactor2B: 100, parkFactor3B: 100, parkFactorBB: 100,
      parkFactorBBL: 100, parkFactorBBR: 100, parkFactorSO: 100,
      parkFactorSOL: 100, parkFactorSOR: 100,
      parkFactorHardHit: 100, parkFactorXBACON: 100,
      windSensitivity: 'normal', tendency: 'neutral', notes: 'Neutral baseline',
    },
  };
}

/**
 * Score a pitcher's talent for the roster page.
 * Uses a neutral forecast (no park/opp/weather adjustments).
 */
export function getPitcherSeasonRating(args: {
  talent: PitcherTalent;
  scoredCategories: EnrichedLeagueStatCategory[];
  focusMap?: Record<number, Focus>;
  /** Numeric per-cat weights (0 = conceded). Preferred over `focusMap` —
   *  the roster page passes leverage weights from `useRosterCategoryWeights`. */
  categoryWeights?: Record<number, number>;
  metadata?: { role: 'starter' | 'reliever' | 'inactive'; isGhost: boolean };
  status?: string | null;
  ownershipPercent?: number;
  isRostered?: boolean;
}): PitcherRating {
  const { talent, scoredCategories, focusMap, categoryWeights, metadata, status, ownershipPercent, isRostered } = args;
  
  const neutralGame = buildNeutralGame();
  
  // Clone talent to avoid mutating the source if we need to adjust it
  const adjustedTalent = { ...talent };

  // Role Adjustment: If they are a Reliever (0 GS in window), 
  // pin their IP/start to 1.0. This prevents high-K relievers 
  // from faking starter-level volume in the roster ranking.
  if (metadata?.role === 'reliever') {
    adjustedTalent.ipPerStart = 1.0;
  }

  const forecast = buildGameForecast({
    pitcher: adjustedTalent,
    game: neutralGame,
    isHome: true,
    opposingOffense: null, // neutral
    opposingPitcher: null, // neutral
  });

  const rating = getPitcherRating({
    forecast,
    scoredCategories,
    focusMap: focusMap ?? {},
    categoryWeights,
  });

  // Liveness Gate (2026 Focus): 
  // If a pitcher has 0 IP in 2026 (isGhost), they have 0 roster value
  // UNLESS they are on the IL, have significant market ownership, OR are on your roster.
  if (metadata?.isGhost) {
    const isIL = status?.startsWith('IL') || status === 'DTD';
    const isStash = (ownershipPercent || 0) >= 15;
    
    if (!isIL && !isStash && !isRostered) {
      return {
        ...rating,
        score: 0,
        netVsNeutral: -50,
        tier: 'bad',
      };
    }
  }

  return rating;
}
