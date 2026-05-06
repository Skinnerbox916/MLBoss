/**
 * Smoke harness for the pitcher evaluation pipeline (`PitcherTalent` →
 * `GameForecast` → `PitcherRating`).
 *
 * This is the canonical regression check for the pitcher engine.
 * Auth-gated through the `/api/admin` prefix in `middleware.ts`. Keep
 * the synthetic profiles in sync with `docs/pitcher-evaluation.md`'s
 * "Calibration anchors" section so that drift between the two surfaces
 * is loud rather than silent.
 *
 *   GET /api/admin/test-pitcher-eval
 *
 * Returns a JSON array with one entry per profile, each containing the
 * Layer-1 talent vector, Layer-2 forecast, and Layer-3 rating. Use this
 * after touching anything in `src/lib/pitching/` to confirm the
 * distribution still lands at the expected score / tier across the
 * archetype range:
 *
 *   - `ace`     → score ≥ 78, tier 'ace'
 *   - `mid`     → score ≈ 50-60, tier 'average'
 *   - `montero` → score ≈ 40-50, tier 'average'  (NOT 'ace' — the
 *                  hot-start-vs-weak-teams false positive that drove
 *                  the rebuild)
 *   - `bad`     → score ≤ 35, tier 'weak' or 'bad'
 *   - `houser`  → score ≈ 30-45, tier 'weak'  (split-decline: K% and
 *                  barrel% co-decline vs prior, whiff% flat. The
 *                  regime probe must fire negative; if it doesn't,
 *                  the model anchors to the much-better prior season)
 *   - `abbott`  → score ≈ 28-42, tier 'weak'  (multi-skill collapse:
 *                  K%, BB%, whiff% all worse vs prior. Strong regime
 *                  signal — most aggressive prior shrink expected)
 *   - `lopezJ`  → score ≈ 38-50, tier 'average' or 'weak'  (BB
 *                  explosion + paradoxically weak contact. Regime
 *                  probe fires; BB compounding penalty in forecast.ts
 *                  bumps expectedERA above what xwOBA→xERA alone
 *                  would produce. If this profile lands ≥ 55, the
 *                  BB compounding term has regressed.)
 *
 * If any of these change materially, either the calibration shifted
 * intentionally (update this file) or you broke something (don't ship).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { computePitcherTalent } from '@/lib/pitching/talent';
import { buildGameForecast } from '@/lib/pitching/forecast';
import { getPitcherRating } from '@/lib/pitching/rating';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { EnrichedGame, StatcastPitcher } from '@/lib/mlb/types';
import type { PitcherSeasonLine } from '@/lib/mlb/model';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

interface Profile {
  name: string;
  desc: string;
  expectedTier: string;
  expectedScoreRange: [number, number];
  currentLine: PitcherSeasonLine;
  priorLine: PitcherSeasonLine;
  currentSavant: StatcastPitcher;
  priorSavant: StatcastPitcher;
}

const STD_LINE = (era: number, k9: number, ip: number, gs: number): PitcherSeasonLine => ({
  ip, gamesStarted: gs, era, whip: 1.0 + (era - 3.0) * 0.08,
  strikeoutsPer9: k9, bb9: 2.5, hr9: era * 0.18,
  battingAvgAgainst: 0.220 + (era - 3.0) * 0.012,
  strikeOuts: Math.round((k9 / 9) * ip),
  pitchesPerInning: 16, gbRate: 0.45,
  inningsPerStart: ip / Math.max(1, gs),
  wins: Math.round(gs * 0.5), losses: Math.round(gs * 0.4),
});

const STD_SAVANT = (
  pa: number, bip: number, kr: number, bbr: number,
  xwoCon: number, hh: number, velo: number, rv100: number,
): StatcastPitcher => ({
  mlbId: 12345, xera: null, era: null, woba: null,
  xwoba: bbr * 0.69 + (1 - kr - bbr) * xwoCon,
  pa, bip, kRate: kr, bbRate: bbr, xwobacon: xwoCon, hardHitRate: hh,
  whiffPct: kr * 100 + 4, barrelPct: hh * 18,
  avgFastballVelo: velo, runValuePer100: rv100,
});

// Variant for paradoxical profiles where whiff% / barrel% don't track
// the standard relationships with K% / HH% (e.g. Houser's whiff stayed
// flat while K% collapsed; Lopez's barrel% dropped despite BB% explosion).
// The regime probe reads whiff% and barrel% directly, so misreporting
// them as derivatives would mask the very disagreement we're testing for.
const SAVANT = (
  pa: number, bip: number, kr: number, bbr: number,
  xwoCon: number, hh: number, whf: number, brl: number,
  velo: number | null, rv100: number,
): StatcastPitcher => ({
  mlbId: 12345, xera: null, era: null, woba: null,
  xwoba: bbr * 0.69 + (1 - kr - bbr) * xwoCon,
  pa, bip, kRate: kr, bbRate: bbr, xwobacon: xwoCon, hardHitRate: hh,
  whiffPct: whf, barrelPct: brl,
  avgFastballVelo: velo, runValuePer100: rv100,
});

const PROFILES: Profile[] = [
  {
    name: 'montero',
    desc: 'Hot 27 IP start vs weak teams over rough 130 IP prior (false-ace bait)',
    expectedTier: 'average',
    expectedScoreRange: [38, 52],
    currentLine: STD_LINE(2.36, 7.5, 27, 5),
    priorLine:   STD_LINE(4.85, 7.2, 130, 24),
    currentSavant: STD_SAVANT(110, 70, 0.205, 0.073, 0.330, 0.36, 93.4, -0.5),
    priorSavant:   STD_SAVANT(580, 380, 0.198, 0.085, 0.380, 0.42, 93.6, 1.2),
  },
  {
    name: 'ace',
    desc: 'Skubal-shaped: elite K, low BB, suppressed contact, 192 IP prior',
    expectedTier: 'ace',
    expectedScoreRange: [78, 95],
    currentLine: STD_LINE(2.65, 11.0, 35, 6),
    priorLine:   STD_LINE(2.80, 11.3, 192, 31),
    currentSavant: STD_SAVANT(140, 90, 0.310, 0.055, 0.300, 0.32, 96.5, -2.5),
    priorSavant:   STD_SAVANT(770, 500, 0.305, 0.060, 0.310, 0.34, 96.6, -2.0),
  },
  {
    name: 'mid',
    desc: 'League-average innings eater',
    expectedTier: 'average',
    expectedScoreRange: [48, 62],
    currentLine: STD_LINE(4.20, 8.4, 35, 6),
    priorLine:   STD_LINE(4.10, 8.5, 180, 30),
    currentSavant: STD_SAVANT(150, 100, 0.220, 0.080, 0.370, 0.40, 93.5, 0.5),
    priorSavant:   STD_SAVANT(750, 480, 0.222, 0.082, 0.368, 0.40, 93.7, 0.3),
  },
  {
    name: 'bad',
    desc: 'Back-end starter — high contact quality allowed, low K',
    expectedTier: 'weak',
    expectedScoreRange: [22, 38],
    currentLine: STD_LINE(5.40, 6.8, 30, 6),
    priorLine:   STD_LINE(5.20, 7.0, 165, 28),
    currentSavant: STD_SAVANT(140, 100, 0.165, 0.090, 0.420, 0.46, 91.8, 2.0),
    priorSavant:   STD_SAVANT(700, 480, 0.170, 0.088, 0.410, 0.45, 92.0, 1.8),
  },
  {
    name: 'houser',
    desc: 'Split-signal decline: K% crashed and barrel% spiked vs ' +
          'a solid prior, but whiff% stayed flat. The regime probe must ' +
          'still fire negative on the K%+barrel% co-decline; if whiff% ' +
          'flatness cancels the signal, the talent estimate stays anchored ' +
          'to the much-better prior season and this score will be too high.',
    expectedTier: 'weak',
    expectedScoreRange: [30, 45],
    currentLine: STD_LINE(7.12, 4.75, 30, 6),
    priorLine:   STD_LINE(3.31, 6.62, 125, 21),
    currentSavant: SAVANT(143, 116, 0.112, 0.070, 0.398, 0.474, 0.191, 0.103, null, -2.24),
    priorSavant:   SAVANT(518, 380, 0.178, 0.073, 0.341, 0.476, 0.181, 0.061, null, 0.22),
  },
  {
    name: 'abbott',
    desc: 'Multi-skill collapse: K%, BB%, and whiff% all worse vs prior. ' +
          'Strongest regime signal in the test set (3+ co-directional ' +
          'declines). Prior cap should shrink hardest here. Talent estimate ' +
          'must lean current-season; if it splits the difference we have a ' +
          'regression-too-conservative bug.',
    expectedTier: 'weak',
    expectedScoreRange: [28, 42],
    currentLine: STD_LINE(5.97, 6.30, 30, 6),
    priorLine:   STD_LINE(2.87, 9.20, 156, 27),
    currentSavant: SAVANT(158, 119, 0.152, 0.095, 0.385, 0.370, 0.206, 0.082, null, -0.72),
    priorSavant:   SAVANT(684, 489, 0.218, 0.063, 0.347, 0.337, 0.240, 0.080, null, 0.65),
  },
  {
    name: 'lopezJ',
    desc: 'BB explosion paradox: K% down, BB% way up, but xwOBACON also ' +
          'way down (weak contact when ball is in play). Pure xwOBA → xERA ' +
          'undersells him because linear weights treat each walk independently. ' +
          'The forecast-layer BB compounding penalty must add ~0.4-0.7 ERA ' +
          'on top of base xERA. If this profile lands ≥ 55, BB compounding ' +
          'has regressed.',
    expectedTier: 'average',
    expectedScoreRange: [38, 52],
    currentLine: STD_LINE(6.52, 6.83, 29, 6),
    priorLine:   STD_LINE(4.08, 11.30, 110, 18),
    currentSavant: SAVANT(146, 101, 0.158, 0.151, 0.273, 0.297, 0.211, 0.040, null, -1.23),
    priorSavant:   SAVANT(399, 241, 0.283, 0.093, 0.362, 0.332, 0.283, 0.066, null, 0.06),
  },
];

const SCORED_CATS: EnrichedLeagueStatCategory[] = [
  { stat_id: 26, name: 'ERA', display_name: 'ERA',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false,
    sort_order: '0', betterIs: 'lower' },
  { stat_id: 27, name: 'WHIP', display_name: 'WHIP',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false,
    sort_order: '0', betterIs: 'lower' },
  { stat_id: 42, name: 'K', display_name: 'K',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false,
    sort_order: '1', betterIs: 'higher' },
  { stat_id: 28, name: 'W', display_name: 'W',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false,
    sort_order: '1', betterIs: 'higher' },
  { stat_id: 83, name: 'QS', display_name: 'QS',
    position_types: ['P'], is_pitcher_stat: true, is_batter_stat: false,
    sort_order: '1', betterIs: 'higher' },
];
const FOCUS_MAP: Record<number, 'chase' | 'punt' | 'neutral'> = {
  26: 'neutral', 27: 'neutral', 42: 'neutral', 28: 'neutral', 83: 'neutral',
};

const WEAK_OFFENSE: TeamOffense = {
  mlbId: 100, name: 'Weak', gamesPlayed: 30,
  avg: 0.235, ops: 0.660, strikeOutRate: 0.260,
  runsPerGame: 3.5, homeRunsPerGame: 0.8,
  vsLeft: { avg: 0.230, ops: 0.665, strikeOutRate: 0.265 },
  vsRight: { avg: 0.235, ops: 0.660, strikeOutRate: 0.260 },
};
const AVG_OFFENSE: TeamOffense = {
  mlbId: 101, name: 'Avg', gamesPlayed: 30,
  avg: 0.252, ops: 0.710, strikeOutRate: 0.223,
  runsPerGame: 4.4, homeRunsPerGame: 1.1,
  vsLeft: { avg: 0.255, ops: 0.725, strikeOutRate: 0.220 },
  vsRight: { avg: 0.250, ops: 0.713, strikeOutRate: 0.225 },
};

function evaluateProfile(p: Profile) {
  // SoS sample-shrinking removed (2026-05); regime-shift probe inside
  // computePitcherTalent now handles the Montero hot-start case via
  // leading-indicator agreement rather than opponent-quality scaling.
  const talent = computePitcherTalent({
    mlbId: 12345, throws: 'R',
    currentLine: p.currentLine, priorLine: p.priorLine,
    currentSavant: p.currentSavant, priorSavant: p.priorSavant,
  });

  const game: EnrichedGame = {
    gamePk: 999, gameDate: '2026-05-02T19:10:00Z', status: 'Scheduled',
    homeTeam: { mlbId: 1, name: 'Tigers', abbreviation: 'DET', staffEra: 4.20 },
    awayTeam: { mlbId: 2, name: 'Royals', abbreviation: 'KC', staffEra: 4.30 },
    venue: { mlbId: 100, name: 'Comerica Park' },
    weather: {
      temperature: 65, condition: 'Clear',
      wind: '5 mph, In from CF', windSpeed: 5, windDirection: 'In from CF',
    },
    homeProbablePitcher: null, awayProbablePitcher: null,
    homeLineup: [], awayLineup: [],
    park: null,
  };

  const forecast = buildGameForecast({
    pitcher: talent, game, isHome: true,
    opposingOffense: AVG_OFFENSE, opposingPitcher: null,
  });

  const rating = getPitcherRating({
    forecast, scoredCategories: SCORED_CATS, focusMap: FOCUS_MAP,
  });

  const [lo, hi] = p.expectedScoreRange;
  const tierMatches = rating.tier === p.expectedTier;
  const scoreMatches = rating.score >= lo && rating.score <= hi;
  const passed = tierMatches && scoreMatches;

  return {
    name: p.name, desc: p.desc, passed,
    expected: { tier: p.expectedTier, scoreRange: p.expectedScoreRange },
    actual: {
      score: rating.score, tier: rating.tier,
      netVsNeutral: rating.netVsNeutral,
    },
    talent: {
      kPerPA: Number(talent.kPerPA.toFixed(3)),
      bbPerPA: Number(talent.bbPerPA.toFixed(3)),
      contactXwoba: Number(talent.contactXwoba.toFixed(3)),
      effectivePA: Math.round(talent.effectivePA),
      confidence: talent.confidence,
      veloTrend: talent.veloTrend != null ? Number(talent.veloTrend.toFixed(2)) : null,
      source: talent.source,
    },
    forecast: {
      xwobaAllowed: Number(forecast.xwobaAllowed.toFixed(3)),
      expectedERA: Number(forecast.expectedERA.toFixed(2)),
      ip: Number(forecast.expectedPerGame.ip.toFixed(2)),
      k: Number(forecast.expectedPerGame.k.toFixed(2)),
      er: Number(forecast.expectedPerGame.er.toFixed(2)),
      pQS: Number(forecast.probabilities.qs.toFixed(2)),
      pW: Number(forecast.probabilities.w.toFixed(2)),
    },
  };
}

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const results = PROFILES.map(evaluateProfile);
  const allPassed = results.every(r => r.passed);

  return NextResponse.json(
    { allPassed, results },
    { status: allPassed ? 200 : 500 },
  );
}
