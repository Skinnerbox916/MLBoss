/**
 * Smoke harness for the batter rating engine (`BatterSeasonStats` +
 * `MatchupContext` → `BatterRating`).
 *
 * Mirrors the pitcher-side `/api/admin/test-pitcher-eval` route. Used as
 * a regression check when refactoring the batter rating stack — same
 * inputs must produce the same outputs at the bit. Auth-gated through
 * the `/api/admin` prefix in `middleware.ts`.
 *
 *   GET /api/admin/test-batter-rating
 *
 * Returns a deterministic JSON array of profile evaluations. Two ways to
 * use it:
 *
 *   1. **Regression diff.** Capture the response before a refactor;
 *      replay after; `diff` must be empty. The profiles exercise every
 *      branch in `applyMatchupModifier` (each scored cat, SP present/
 *      absent, switch hitter, batting order edges, park boost, wind
 *      boost/suppress, thin sample) so a structural change anywhere in
 *      the L2 forecast will show up.
 *
 *   2. **Spot calibration.** The expected score ranges below codify
 *      "what a strong batter vs. an ace SP at a pitcher's park *should*
 *      land around." If these ranges drift, either calibration moved
 *      intentionally (update this file) or you broke something.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getBatterRating } from '@/lib/mlb/batterRating';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import type { MatchupContext } from '@/lib/mlb/matchupContext';
import type { ProbablePitcher, EnrichedGame, GameWeather, ParkData } from '@/lib/mlb/types';
import type { PitcherTalent } from '@/lib/pitching/talent';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/rating/focus';

// ---------------------------------------------------------------------------
// Synthetic data builders
// ---------------------------------------------------------------------------

/** Standard fantasy 9-cat config. */
const SCORED_CATS: EnrichedLeagueStatCategory[] = [
  { stat_id: 3,  name: 'AVG', display_name: 'AVG', position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '1', betterIs: 'higher' },
  { stat_id: 7,  name: 'R',   display_name: 'R',   position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '1', betterIs: 'higher' },
  { stat_id: 8,  name: 'H',   display_name: 'H',   position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '1', betterIs: 'higher' },
  { stat_id: 12, name: 'HR',  display_name: 'HR',  position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '1', betterIs: 'higher' },
  { stat_id: 13, name: 'RBI', display_name: 'RBI', position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '1', betterIs: 'higher' },
  { stat_id: 16, name: 'SB',  display_name: 'SB',  position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '1', betterIs: 'higher' },
  { stat_id: 18, name: 'BB',  display_name: 'BB',  position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '1', betterIs: 'higher' },
  { stat_id: 21, name: 'K',   display_name: 'K',   position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '0', betterIs: 'lower'  },
  { stat_id: 23, name: 'TB',  display_name: 'TB',  position_types: ['B'], is_batter_stat: true,  is_pitcher_stat: false, sort_order: '1', betterIs: 'higher' },
];

const NEUTRAL_FOCUS: Record<number, Focus> = {
  3: 'neutral', 7: 'neutral', 8: 'neutral', 12: 'neutral', 13: 'neutral',
  16: 'neutral', 18: 'neutral', 21: 'neutral', 23: 'neutral',
};

/** Helper: build a BatterSeasonStats with sensible defaults; override fields per case. */
function batter(overrides: Partial<BatterSeasonStats>): BatterSeasonStats {
  return {
    mlbId: 1001,
    ops: 0.780,
    avg: 0.275,
    hr: 22,
    sb: 8,
    pa: 500,
    gp: 130,
    runs: 70,
    hits: 130,
    rbi: 75,
    walks: 50,
    strikeouts: 100,
    totalBases: 230,
    season: 2026,
    xwoba: 0.340,
    woba: 0.345,
    xwobaEffectivePA: 500,
    xwobaCurrent: 0.345,
    xwobaCurrentBip: 320,
    xwobaTalentPrior: 0.335,
    kRate: 0.20,
    bbRate: 0.10,
    xba: 0.270,
    xslg: 0.460,
    bats: 'R',
    opsVsL: 0.790,
    paVsL: 150,
    opsVsR: 0.775,
    paVsR: 350,
    priorSeason: {
      season: 2025, pa: 600, gp: 150, hr: 25, sb: 10, runs: 85, rbi: 80,
      hits: 155, walks: 60, strikeouts: 120, totalBases: 275, avg: 0.260,
    },
    ...overrides,
  };
}

/** Helper: build a PitcherTalent with sensible defaults. Synthetic-only;
 *  the batter rating reads kPerPA / bbPerPA / contactXwoba / hrPerContact.
 *  Other fields are filled to satisfy the type but aren't load-bearing. */
function pitcherTalent(overrides: Partial<PitcherTalent>): PitcherTalent {
  return {
    mlbId: 2001,
    throws: 'R',
    kPerPA: 0.225,
    bbPerPA: 0.080,
    contactXwoba: 0.365,
    hrPerContact: 0.035,
    ipPerStart: 5.5,
    gbRate: 0.45,
    fastballVelo: 94.0,
    veloTrend: 0,
    effectivePA: 600,
    source: 'savant_full',
    confidence: 'high',
    confidenceReason: 'synthetic',
    confidenceBand: 5,
    whiffPct: null,
    chasePct: null,
    barrelPct: null,
    hardHitPct: null,
    runValuePer100: null,
    regimeShift: null,
    ...overrides,
  } as PitcherTalent;
}

/** Helper: build a ProbablePitcher with talent. */
function sp(overrides: Partial<ProbablePitcher> & { talent?: PitcherTalent | null }): ProbablePitcher {
  const talent = overrides.talent ?? pitcherTalent({});
  return {
    mlbId: 2001,
    name: 'Test SP',
    throws: 'R',
    era: 3.80,
    whip: 1.20,
    wins: 8,
    losses: 6,
    strikeoutsPer9: 8.5,
    strikeOuts: 100,
    gamesStarted: 20,
    pitchesPerInning: 16,
    inningsPerStart: 5.5,
    bb9: 3.0,
    hr9: 1.1,
    battingAvgAgainst: 0.240,
    gbRate: 0.45,
    eraLast30: 3.70,
    recentFormEra: 3.65,
    inningsPitched: 110,
    platoonOpsVsLeft: 0.700,
    platoonOpsVsRight: 0.690,
    xera: 3.75,
    talent,
    ...overrides,
  } as ProbablePitcher;
}

const NEUTRAL_WEATHER: GameWeather = {
  temperature: 70, condition: 'Clear',
  wind: '5 mph, In from CF', windSpeed: 5, windDirection: 'In from CF',
};

const WIND_OUT_WEATHER: GameWeather = {
  temperature: 80, condition: 'Clear',
  wind: '15 mph, Out to CF', windSpeed: 15, windDirection: 'Out to CF',
};

const WIND_IN_WEATHER: GameWeather = {
  temperature: 50, condition: 'Cloudy',
  wind: '18 mph, In from CF', windSpeed: 18, windDirection: 'In from CF',
};

function park(overrides: Partial<ParkData>): ParkData {
  return {
    mlbVenueId: 100, name: 'Neutral Park', teamAbbr: 'XXX', city: 'Anytown',
    lat: 40, lng: -90, surface: 'grass', roof: 'open',
    parkFactor: 100, parkFactorHR: 100, parkFactorL: 100, parkFactorR: 100,
    parkFactorHrL: 100, parkFactorHrR: 100, parkFactorBACON: 100,
    parkFactor2B: 100, parkFactor3B: 100,
    parkFactorBB: 100, parkFactorBBL: 100, parkFactorBBR: 100,
    parkFactorSO: 100, parkFactorSOL: 100, parkFactorSOR: 100,
    parkFactorHardHit: 100, parkFactorXBACON: 100,
    windSensitivity: 'normal', tendency: 'neutral', notes: '',
    ...overrides,
  };
}

const NEUTRAL_PARK: ParkData = park({});

const COORS_PARK: ParkData = park({
  mlbVenueId: 19, name: 'Coors Field', teamAbbr: 'COL', city: 'Denver',
  parkFactor: 112, parkFactorHR: 107, parkFactorL: 110, parkFactorR: 113,
  parkFactorHrL: 105, parkFactorHrR: 108, parkFactorBACON: 110,
  parkFactor2B: 115, parkFactor3B: 130,
  parkFactorBB: 102, parkFactorBBL: 102, parkFactorBBR: 102,
  parkFactorSO: 90, parkFactorSOL: 90, parkFactorSOR: 90,
  tendency: 'extreme-hitter',
});

const PITCHER_PARK: ParkData = park({
  mlbVenueId: 22, name: 'Pitcher Park', teamAbbr: 'SD', city: 'San Diego',
  parkFactor: 92, parkFactorHR: 88, parkFactorL: 90, parkFactorR: 92,
  parkFactorHrL: 86, parkFactorHrR: 88, parkFactorBACON: 92,
  parkFactor2B: 92, parkFactor3B: 90,
  parkFactorSO: 104, parkFactorSOL: 104, parkFactorSOR: 104,
  tendency: 'pitcher',
});

function game(opts: {
  park: ParkData | null;
  weather?: GameWeather;
  homeStaffEra?: number;
  awayStaffEra?: number;
}): EnrichedGame {
  return {
    gamePk: 999,
    gameDate: '2026-06-15T19:10:00Z',
    status: 'Scheduled',
    homeTeam: { mlbId: 1, name: 'Home', abbreviation: 'HOM', staffEra: opts.homeStaffEra ?? 4.20 },
    awayTeam: { mlbId: 2, name: 'Away', abbreviation: 'AWY', staffEra: opts.awayStaffEra ?? 4.30 },
    venue: { mlbId: opts.park?.mlbVenueId ?? 100, name: opts.park?.name ?? 'Test Venue' },
    weather: opts.weather ?? NEUTRAL_WEATHER,
    homeProbablePitcher: null,
    awayProbablePitcher: null,
    homeLineup: [],
    awayLineup: [],
    park: opts.park,
  };
}

function ctx(opts: {
  game: EnrichedGame;
  isHome: boolean;
  opposingPitcher: ProbablePitcher | null;
  hand?: 'L' | 'R' | 'S' | null;
  battingOrder?: number | null;
}): MatchupContext {
  return {
    game: opts.game,
    isHome: opts.isHome,
    opposingPitcher: opts.opposingPitcher,
    asPitcher: null,
    asBatter: {
      hand: opts.hand ?? null,
      battingOrder: opts.battingOrder ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Profiles — each one exercises a different branch / context combination
// ---------------------------------------------------------------------------

interface Profile {
  name: string;
  desc: string;
  stats: BatterSeasonStats;
  context: MatchupContext | null;
  battingOrder: number | null;
  focusMap: Record<number, Focus>;
  /** Expected score range for spot-calibration (the diff-check doesn't
   *  use this — it's a sanity floor for the calibration interpretation). */
  expectedScoreRange: [number, number];
}

const PROFILES: Profile[] = [
  {
    name: 'strong-vs-average',
    desc: 'Strong RHB (.275/22 HR) vs average RHP, neutral park, top of order',
    stats: batter({}),
    context: ctx({
      game: game({ park: NEUTRAL_PARK }),
      isHome: true,
      opposingPitcher: sp({ throws: 'R' }),
      hand: 'R',
      battingOrder: 2,
    }),
    battingOrder: 2,
    focusMap: NEUTRAL_FOCUS,
    expectedScoreRange: [45, 65],
  },
  {
    name: 'strong-vs-ace',
    desc: 'Strong RHB vs ace SP (low BAA + high K), neutral park, cleanup',
    stats: batter({}),
    context: ctx({
      game: game({ park: NEUTRAL_PARK }),
      isHome: false,
      opposingPitcher: sp({
        throws: 'R',
        battingAvgAgainst: 0.215,
        talent: pitcherTalent({ kPerPA: 0.30, contactXwoba: 0.310, hrPerContact: 0.025 }),
      }),
      hand: 'R',
      battingOrder: 4,
    }),
    battingOrder: 4,
    focusMap: NEUTRAL_FOCUS,
    expectedScoreRange: [30, 55],
  },
  {
    name: 'weak-vs-strong-coors',
    desc: 'Weak LHB (.230/8 HR) at Coors vs HR-prone SP, leadoff',
    stats: batter({
      bats: 'L', avg: 0.230, hr: 8, sb: 4, hits: 100, runs: 50, rbi: 40,
      walks: 35, strikeouts: 140, totalBases: 160, ops: 0.660,
      xwoba: 0.300, xba: 0.232, xslg: 0.385, xwobaCurrent: 0.305, xwobaTalentPrior: 0.298,
      kRate: 0.28, bbRate: 0.07,
      opsVsL: 0.620, opsVsR: 0.675,
    }),
    context: ctx({
      game: game({ park: COORS_PARK, weather: WIND_OUT_WEATHER }),
      isHome: true,
      opposingPitcher: sp({
        throws: 'R',
        battingAvgAgainst: 0.270,
        talent: pitcherTalent({ kPerPA: 0.18, hrPerContact: 0.060, contactXwoba: 0.395 }),
      }),
      hand: 'L',
      battingOrder: 1,
    }),
    battingOrder: 1,
    focusMap: NEUTRAL_FOCUS,
    expectedScoreRange: [30, 55],
  },
  {
    name: 'switch-hitter-pitchers-park',
    desc: 'Switch hitter at pitcher park vs LHP, wind in, middle of order',
    stats: batter({
      bats: 'S', avg: 0.265, hr: 18, sb: 12,
      opsVsL: 0.795, opsVsR: 0.770,
    }),
    context: ctx({
      game: game({ park: PITCHER_PARK, weather: WIND_IN_WEATHER }),
      isHome: false,
      opposingPitcher: sp({
        throws: 'L',
        battingAvgAgainst: 0.235,
        talent: pitcherTalent({ throws: 'L', kPerPA: 0.235, bbPerPA: 0.095 }),
      }),
      hand: 'S',
      battingOrder: 5,
    }),
    battingOrder: 5,
    focusMap: NEUTRAL_FOCUS,
    expectedScoreRange: [30, 55],
  },
  {
    name: 'sp-unknown',
    desc: 'Strong RHB facing unknown SP (null opposingPitcher), neutral park',
    stats: batter({}),
    context: ctx({
      game: game({ park: NEUTRAL_PARK }),
      isHome: true,
      opposingPitcher: null,
      hand: 'R',
      battingOrder: 3,
    }),
    battingOrder: 3,
    focusMap: NEUTRAL_FOCUS,
    expectedScoreRange: [45, 65],
  },
  {
    name: 'no-game',
    desc: 'No matchup context (off day) — degenerate path, neutral 50',
    stats: batter({}),
    context: null,
    battingOrder: null,
    focusMap: NEUTRAL_FOCUS,
    expectedScoreRange: [50, 50],
  },
  {
    name: 'bottom-of-order',
    desc: 'Average RHB vs average SP, neutral park, batting 9th',
    stats: batter({ avg: 0.245, hr: 12, sb: 5 }),
    context: ctx({
      game: game({ park: NEUTRAL_PARK }),
      isHome: false,
      opposingPitcher: sp({}),
      hand: 'R',
      battingOrder: 9,
    }),
    battingOrder: 9,
    focusMap: NEUTRAL_FOCUS,
    expectedScoreRange: [30, 55],
  },
  {
    name: 'chase-hr-punt-sb',
    desc: 'Power RHB chasing HR/R/RBI, punting SB, vs HR-prone SP, Coors',
    stats: batter({ avg: 0.260, hr: 35, sb: 2 }),
    context: ctx({
      game: game({ park: COORS_PARK, weather: WIND_OUT_WEATHER }),
      isHome: true,
      opposingPitcher: sp({
        talent: pitcherTalent({ hrPerContact: 0.055, contactXwoba: 0.380 }),
      }),
      hand: 'R',
      battingOrder: 3,
    }),
    battingOrder: 3,
    focusMap: {
      ...NEUTRAL_FOCUS,
      12: 'chase', 7: 'chase', 13: 'chase',
      16: 'punt', 21: 'punt',
    },
    expectedScoreRange: [40, 70],
  },
  {
    name: 'thin-sample',
    desc: 'Rookie with minimal current-year sample, no priors',
    stats: batter({
      pa: 30, gp: 10, hr: 2, sb: 1, hits: 8, runs: 4, rbi: 5,
      walks: 3, strikeouts: 9, totalBases: 14, avg: 0.270,
      xwobaEffectivePA: 30, xwobaCurrentBip: 18, xwobaCurrent: 0.330,
      xba: null, xslg: null, kRate: null, bbRate: null,
      priorSeason: null,
    }),
    context: ctx({
      game: game({ park: NEUTRAL_PARK }),
      isHome: false,
      opposingPitcher: sp({}),
      hand: 'R',
      battingOrder: 7,
    }),
    battingOrder: 7,
    focusMap: NEUTRAL_FOCUS,
    expectedScoreRange: [30, 55],
  },
  {
    name: 'all-punt',
    desc: 'Strong RHB but every cat is punted — composite degrades, multipliers off',
    stats: batter({}),
    context: ctx({
      game: game({ park: NEUTRAL_PARK }),
      isHome: true,
      opposingPitcher: sp({}),
      hand: 'R',
      battingOrder: 3,
    }),
    battingOrder: 3,
    focusMap: {
      3: 'punt', 7: 'punt', 8: 'punt', 12: 'punt', 13: 'punt',
      16: 'punt', 18: 'punt', 21: 'punt', 23: 'punt',
    },
    expectedScoreRange: [0, 100],
  },
];

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function evaluateProfile(p: Profile) {
  const rating = getBatterRating({
    context: p.context,
    stats: p.stats,
    scoredCategories: SCORED_CATS,
    focusMap: p.focusMap,
    battingOrder: p.battingOrder,
  });

  const [lo, hi] = p.expectedScoreRange;
  const inRange = rating.score >= lo && rating.score <= hi;

  return {
    name: p.name,
    desc: p.desc,
    inExpectedRange: inRange,
    expectedScoreRange: p.expectedScoreRange,
    rating: {
      score: rating.score,
      scoreBand: Number(rating.scoreBand.toFixed(2)),
      netVsNeutral: rating.netVsNeutral,
      tier: rating.tier,
      confidence: rating.confidence,
      platoon: {
        multiplier: Number(rating.platoon.multiplier.toFixed(4)),
        deltaPct: Number(rating.platoon.deltaPct.toFixed(2)),
        available: rating.platoon.available,
      },
      opportunity: {
        multiplier: Number(rating.opportunity.multiplier.toFixed(4)),
        deltaPct: Number(rating.opportunity.deltaPct.toFixed(2)),
        available: rating.opportunity.available,
      },
      weather: {
        multiplier: Number(rating.weather.multiplier.toFixed(4)),
        deltaPct: Number(rating.weather.deltaPct.toFixed(2)),
        available: rating.weather.available,
      },
      categories: rating.categories.map(c => ({
        statId: c.statId,
        label: c.label,
        baseline: Number(c.baseline.toFixed(5)),
        expected: Number(c.expected.toFixed(5)),
        normalized: Number(c.normalized.toFixed(4)),
        effectivePA: c.effectivePA,
        weight: Number(c.weight.toFixed(4)),
        contribution: Number(c.contribution.toFixed(4)),
        focus: c.focus,
        display: c.display,
        modifierHint: c.modifierHint,
      })),
    },
  };
}

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const results = PROFILES.map(evaluateProfile);
  const allInRange = results.every(r => r.inExpectedRange);

  return NextResponse.json(
    { allInRange, count: results.length, results },
    { status: 200 },
  );
}
