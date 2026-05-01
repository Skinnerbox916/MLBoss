import React from 'react';
import { FiSun, FiCloud, FiCloudRain } from 'react-icons/fi';
import type { IconType } from 'react-icons';
import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { ProbablePitcher, ParkData, GameWeather, PitcherTier, MLBGame } from '@/lib/mlb/types';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { PitcherRating } from '@/lib/pitching/scoring';

// ---------------------------------------------------------------------------
// Shared context interface for scored pitcher rows
// ---------------------------------------------------------------------------

export interface ScoredPitcherCtx {
  pp: ProbablePitcher;
  opponentMlbId: number;
  isHome: boolean;
  park: ParkData | null;
  weather: GameWeather;
  game: MLBGame;
}

// ---------------------------------------------------------------------------
// Tier display helpers
// ---------------------------------------------------------------------------

export function tierColor(tier: PitcherTier): string {
  switch (tier) {
    case 'ace': return 'text-success font-bold';
    case 'tough': return 'text-success';
    case 'average': return 'text-foreground';
    case 'weak': return 'text-accent';
    case 'bad': return 'text-error';
    default: return 'text-muted-foreground';
  }
}

// ---------------------------------------------------------------------------
// Weather helpers
// ---------------------------------------------------------------------------

export function weatherIcon(condition: string | null): IconType | null {
  if (!condition) return null;
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle')) return FiCloudRain;
  if (c.includes('sun') || c.includes('clear')) return FiSun;
  return FiCloud;
}

export function hasWeatherData(w: GameWeather): boolean {
  return w.condition !== null || w.temperature !== null || w.windSpeed !== null;
}

// ---------------------------------------------------------------------------
// Pitcher stat line
// ---------------------------------------------------------------------------

export function renderPitcherStatLine(pp: ProbablePitcher): React.ReactNode {
  const parts: React.ReactNode[] = [];
  if (pp.era !== null) parts.push(React.createElement('span', { key: 'era' }, `ERA ${pp.era.toFixed(2)}`));
  if (pp.xera !== null) {
    const xeraColor =
      pp.xera <= 3.25 ? 'text-success' :
      pp.xera >= 4.75 ? 'text-error' :
      'text-foreground';
    parts.push(React.createElement('span', { key: 'xera', className: xeraColor }, `xERA ${pp.xera.toFixed(2)}`));
  }
  if (pp.whip !== null) parts.push(React.createElement('span', { key: 'whip' }, `WHIP ${pp.whip.toFixed(2)}`));
  if (pp.strikeoutsPer9 !== null) parts.push(React.createElement('span', { key: 'k9' }, `K/9 ${pp.strikeoutsPer9.toFixed(1)}`));
  if (pp.bb9 !== null) {
    const bb9Color = pp.bb9 <= 2.5 ? 'text-success' : pp.bb9 >= 4.0 ? 'text-error' : '';
    parts.push(React.createElement('span', { key: 'bb9', className: bb9Color }, `BB/9 ${pp.bb9.toFixed(1)}`));
  }
  if (pp.gbRate !== null) {
    const gbColor = pp.gbRate >= 0.50 ? 'text-success' : pp.gbRate <= 0.38 ? 'text-error' : '';
    parts.push(React.createElement('span', { key: 'gb', className: gbColor }, `GB ${(pp.gbRate * 100).toFixed(0)}%`));
  }
  if (pp.inningsPerStart !== null) parts.push(React.createElement('span', { key: 'ipgs' }, `IP/GS ${pp.inningsPerStart.toFixed(1)}`));
  return parts.reduce<React.ReactNode[]>((acc, part, i) => {
    if (i > 0) acc.push(React.createElement('span', { key: `sep-${i}`, className: 'text-border mx-1.5' }, '·'));
    acc.push(part);
    return acc;
  }, []);
}

// ---------------------------------------------------------------------------
// Team abbreviation normalization & name matching
// ---------------------------------------------------------------------------

const TEAM_ABBR_ALIASES: Record<string, string> = {
  AZ: 'ARI', ARI: 'ARI',
  CHW: 'CWS', CWS: 'CWS',
  WAS: 'WSH', WSH: 'WSH',
  KCR: 'KC', KC: 'KC',
  SDP: 'SD', SD: 'SD',
  SFG: 'SF', SF: 'SF',
  TBR: 'TB', TB: 'TB',
};

export function normalizeTeamAbbr(abbr: string): string {
  const upper = (abbr ?? '').toUpperCase();
  return TEAM_ABBR_ALIASES[upper] ?? upper;
}

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, '')
    .trim();
}

export function lastNameKey(name: string): string {
  const parts = normalizeName(name).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

// Minimal shape expected from EnrichedGame — keeps this module decoupled
// from the hook while preserving the full input type via generics.
interface EnrichedGameLike {
  homeTeam: { abbreviation: string; mlbId: number };
  awayTeam: { abbreviation: string; mlbId: number };
  homeProbablePitcher: ProbablePitcher | null;
  awayProbablePitcher: ProbablePitcher | null;
  park?: ParkData | null;
  weather: GameWeather;
}

export function matchFreeAgentToGame<G extends EnrichedGameLike>(
  fa: FreeAgentPlayer,
  games: G[],
): { game: G; pp: ProbablePitcher; isHome: boolean } | null {
  const abbr = normalizeTeamAbbr(fa.editorial_team_abbr);
  const faLast = lastNameKey(fa.name);
  const faFull = normalizeName(fa.name);

  for (const g of games) {
    const homeAbbr = normalizeTeamAbbr(g.homeTeam.abbreviation);
    const awayAbbr = normalizeTeamAbbr(g.awayTeam.abbreviation);
    const isHome = homeAbbr === abbr;
    const isAway = awayAbbr === abbr;
    if (!isHome && !isAway) continue;

    const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
    if (!pp) continue;

    const ppLast = lastNameKey(pp.name);
    const ppFull = normalizeName(pp.name);

    if (faLast && ppLast && (faLast === ppLast || faFull === ppFull || faFull.includes(ppLast) || ppFull.includes(faLast))) {
      return { game: g, pp, isHome };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pitcher check
// ---------------------------------------------------------------------------

export function isPitcher(p: RosterEntry): boolean {
  return (
    p.eligible_positions.includes('P') ||
    p.eligible_positions.includes('SP') ||
    p.eligible_positions.includes('RP') ||
    p.display_position === 'SP' ||
    p.display_position === 'RP' ||
    p.display_position === 'P'
  );
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** N-day offset from today (positive = future, 0 = today). */
export function dayOffsetStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Pitcher rating display helpers
// ---------------------------------------------------------------------------

export type CategoryFit = 'strong' | 'weak' | 'neutral' | 'punted';

/** Classify a category sub-score into a visual bucket.
 *  Thresholds mirror `getStreamPills` so the board and pills stay aligned. */
export function categoryFit(subScore: number, weight: number): CategoryFit {
  if (weight === 0) return 'punted';
  if (subScore >= 0.65) return 'strong';
  if (subScore <= 0.40) return 'weak';
  return 'neutral';
}

export function categoryFitClasses(fit: CategoryFit): string {
  switch (fit) {
    case 'strong': return 'bg-success/15 text-success border-success/30';
    case 'weak': return 'bg-error/15 text-error border-error/30';
    case 'punted': return 'bg-surface-muted text-muted-foreground/60 border-border line-through';
    default: return 'bg-surface-muted text-muted-foreground border-border';
  }
}

export interface Verdict {
  label: string;
  color: 'success' | 'accent' | 'error';
}

/** Convert a composite pitcher rating score (0-1) to a verdict label.
 *  Thresholds match the existing row-tint ranges. */
export function verdictLabel(score: number): Verdict {
  if (score >= 0.70) return { label: 'Strong', color: 'success' };
  if (score >= 0.50) return { label: 'Fair', color: 'accent' };
  return { label: 'Avoid', color: 'error' };
}

/**
 * Compute a short list of the most important risk signals for a matchup.
 * Ordered roughly by impact, capped at two entries so the collapsed row
 * stays scannable. Returns `[]` when the pitcher has no notable red flags.
 */
export function buildRiskSummary(
  rating: PitcherRating,
  pp: ProbablePitcher,
  opp: TeamOffense | null,
  park: ParkData | null,
  ctx?: { oppPp?: ProbablePitcher | null; ownStaffEra?: number | null },
): string[] {
  const risks: string[] = [];

  if (rating.credibility.multiplier < 0.75) {
    risks.push(rating.credibility.reason);
  }

  if (pp.inningsPerStart !== null && pp.inningsPerStart < 5.0) {
    risks.push(`${pp.inningsPerStart.toFixed(1)} IP/GS`);
  }

  const oppOps = pp.throws === 'L'
    ? opp?.vsLeft?.ops ?? opp?.ops ?? null
    : opp?.vsRight?.ops ?? opp?.ops ?? null;
  if (oppOps !== null && oppOps !== undefined && oppOps >= 0.770) {
    const fmt = oppOps.toFixed(3).replace(/^0\./, '.');
    risks.push(`${fmt} OPS vs ${pp.throws}HP`);
  }

  // Opposing-starter pitching duel — flag when our guy is going against
  // an ace-tier arm. Uses the same xwOBA-a thresholds as the tier model.
  const oppPp = ctx?.oppPp ?? null;
  if (oppPp) {
    const tier = oppPp.quality?.tier;
    if (tier === 'ace' || tier === 'tough') {
      risks.push(`vs ${tier === 'ace' ? 'ace' : 'tough'} ${oppPp.name.split(' ').slice(-1)[0]}`);
    }
  }

  // Bullpen risk — staff ERA ≥ 4.50 is a red flag for lead-holding.
  const pen = ctx?.ownStaffEra ?? null;
  if (pen !== null && pen >= 4.50) {
    risks.push(`pen ${pen.toFixed(2)}`);
  }

  if (rating.velocity.available && rating.velocity.deltaPct <= -3) {
    risks.push(`velo ${rating.velocity.display}`);
  }

  const parkHR = park?.parkFactorHR ?? park?.parkFactor ?? null;
  if (parkHR !== null && parkHR >= 110) {
    risks.push(`hitter park ${parkHR}`);
  }

  if (rating.platoon.available && rating.platoon.deltaPct <= -3) {
    risks.push('platoon vuln');
  }

  return risks.slice(0, 2);
}
