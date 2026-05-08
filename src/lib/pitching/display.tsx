import React from 'react';
import { FiSun, FiCloud, FiCloudRain } from 'react-icons/fi';
import type { IconType } from 'react-icons';
import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { ProbablePitcher, ParkData, GameWeather, EnrichedGame } from '@/lib/mlb/types';
import type { PitcherTier } from '@/lib/pitching/rating';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { PitcherStreamingRating } from '@/lib/pitching/scoring';
import { talentExpectedEra } from '@/lib/pitching/talent';
import { getParkAdjustment } from '@/lib/mlb/parkAdjustment';

// ---------------------------------------------------------------------------
// Shared context interface for scored pitcher rows
// ---------------------------------------------------------------------------

export interface ScoredPitcherCtx {
  pp: ProbablePitcher;
  opponentMlbId: number;
  isHome: boolean;
  park: ParkData | null;
  weather: GameWeather;
  game: EnrichedGame;
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
//
// `normalizeTeamAbbr` is the canonical Yahoo↔MLB↔ESPN normalizer; the
// alias table lives in `@/lib/mlb/teamAbbr` so every cross-source matcher
// (FA→probable, rostered pitcher→probable, MLB↔ESPN scoreboard splice)
// reads the same map. Re-exported here for back-compat — many callers
// already import from `pitching/display`.
// ---------------------------------------------------------------------------

export { normalizeTeamAbbr } from '@/lib/mlb/teamAbbr';
import { normalizeTeamAbbr } from '@/lib/mlb/teamAbbr';

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, '')
    .trim();
}

// `lastNameKey` and `firstInitial` are intentionally NOT exported —
// every name-comparison consumer must go through `isLikelySamePlayer`.
// Exposing the last-name key as a public helper is what enabled the
// pre-2026-05 last-name-only matchers (the Lopez / Ureña duplicate-
// streamer collision). Keep these private.
function lastNameKey(name: string): string {
  const parts = normalizeName(name).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function firstInitial(name: string): string {
  const parts = normalizeName(name).split(/\s+/).filter(Boolean);
  return parts[0]?.[0] ?? '';
}

/**
 * Decide whether two name strings plausibly identify the same player.
 *
 * Last-name-only matching used to be enough — the doc note in
 * streaming-page.md said "team + last name is essentially unique on any
 * given day." It isn't: the Athletics carrying both Jacob and Otto López
 * (and previously two Ureñas on the same team) caused us to attach the
 * probable starter's projection to BOTH players, so two streamers showed
 * up for one game.
 *
 * Tighter rule: require either an exact full-name match, or last-name
 * match + first-initial agreement. That handles "J. López" ↔ "Jacob
 * Lopez" without re-introducing the same-team-same-surname collision.
 *
 * Used both for free-agent → probable-starter matching (streaming page)
 * and for rostered-pitcher → probable-starter matching (today /
 * dashboard). If we ever start syncing Yahoo player_id ↔ MLB id, this
 * should switch to ID-based matching and become unnecessary.
 */
export function isLikelySamePlayer(faName: string, ppName: string): boolean {
  const faNorm = normalizeName(faName);
  const ppNorm = normalizeName(ppName);
  if (!faNorm || !ppNorm) return false;
  if (faNorm === ppNorm) return true;

  const faLast = lastNameKey(faName);
  const ppLast = lastNameKey(ppName);
  if (!faLast || !ppLast || faLast !== ppLast) return false;

  const faInitial = firstInitial(faName);
  const ppInitial = firstInitial(ppName);
  if (!faInitial || !ppInitial) return false;

  return faInitial === ppInitial;
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

  for (const g of games) {
    const homeAbbr = normalizeTeamAbbr(g.homeTeam.abbreviation);
    const awayAbbr = normalizeTeamAbbr(g.awayTeam.abbreviation);
    const isHome = homeAbbr === abbr;
    const isAway = awayAbbr === abbr;
    if (!isHome && !isAway) continue;

    const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
    if (!pp) continue;

    if (isLikelySamePlayer(fa.name, pp.name)) {
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
// Verbal cues — short labels for the collapsed row, with pitcher-perspective
// tone (so a hitter park reads as `error` because it hurts the pitcher).
// Both StreamingBoard and TodayPitchers consume these so the two pages
// tell the same matchup story in the same vocabulary.
// ---------------------------------------------------------------------------

export type CueTone = 'success' | 'error' | 'muted';
export interface VerbalCue {
  label: string;
  tone: CueTone;
}

/** Verbal cue for the park's lean from the pitcher's perspective. The
 *  per-stat detail (parkSO/parkBB/parkHR) lives expanded in the Context
 *  section; at-a-glance the user just wants "is this stadium going to
 *  bite my guy?". Thresholds align with parkAdjustment.ts's composite
 *  bands so the verbal label and the multiplier agree. */
export function parkCue(park: ParkData | null): VerbalCue {
  if (!park) return { label: '', tone: 'muted' };
  const pf = park.parkFactor;
  const pfHr = park.parkFactorHR;
  if (pf >= 108 || pfHr >= 115) return { label: 'hitter park', tone: 'error' };
  if (pf >= 104 || pfHr >= 108) return { label: 'lean hitter',  tone: 'error' };
  if (pf <= 92  || pfHr <= 85)  return { label: 'pitcher park', tone: 'success' };
  if (pf <= 96  || pfHr <= 92)  return { label: 'lean pitcher', tone: 'success' };
  return { label: 'neutral park', tone: 'muted' };
}

/** Verbal cue for the opposing lineup's strength against the pitcher's
 *  hand. Thresholds align with batterRating.ts's `oppOpsFactor` bands. */
export function lineupCue(oppOps: number | null): VerbalCue {
  if (oppOps === null) return { label: '', tone: 'muted' };
  if (oppOps >= 0.770) return { label: 'tough lineup', tone: 'error' };
  if (oppOps >= 0.745) return { label: 'lean tough',   tone: 'error' };
  if (oppOps <= 0.685) return { label: 'soft lineup',  tone: 'success' };
  if (oppOps <= 0.700) return { label: 'lean soft',    tone: 'success' };
  return { label: 'avg lineup', tone: 'muted' };
}

/** Tailwind text-color class for a CueTone. Single source so colors
 *  match wherever a verbal cue surfaces. */
export function cueToneClass(t: CueTone): string {
  return t === 'success' ? 'text-success'
    : t === 'error' ? 'text-error'
    : 'text-muted-foreground';
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
  rating: PitcherStreamingRating,
  pp: ProbablePitcher,
  opp: TeamOffense | null,
  park: ParkData | null,
  ctx?: { oppPp?: ProbablePitcher | null; ownStaffEra?: number | null },
): string[] {
  const risks: string[] = [];

  // Surface thin-sample ratings as a risk signal — these are the pitchers
  // where talent input is thin (rookies, returning IL stints) or the
  // available signals disagree (xERA says ace, RV/100 says weak). The
  // talent-layer regression already pulled the estimate toward the prior;
  // this just makes the user aware that the projection is leaning on it.
  if (rating.confidence.level === 'low') {
    risks.push(rating.confidence.reason);
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
  // an ace-tier arm. Talent-derived: a low expected ERA from the talent
  // vector means the opposing SP profiles as ace/tough independent of
  // the legacy classifier (which was the source of the Montero-style
  // false ACE-badge).
  //
  // xERA thresholds are chosen to align with `tierFromScore`'s ace/tough
  // boundaries (78 / 62 on the 0-100 score):
  //   - 2.85 xERA ≈ 0.264 xwOBA-allowed ≈ ace-tier talent (Sale/Skubal)
  //   - 3.60 xERA ≈ 0.294 xwOBA-allowed ≈ tough-tier talent (high-end SP)
  // Using the canonical `xwobaToXera` from forecast.ts here keeps the
  // opposing-SP descriptor and the SP's own self-tier on a single ruler.
  const oppPp = ctx?.oppPp ?? null;
  if (oppPp?.talent) {
    const expEra = talentExpectedEra(oppPp.talent);
    if (expEra <= 2.85) {
      risks.push(`vs ace ${oppPp.name.split(' ').slice(-1)[0]}`);
    } else if (expEra <= 3.60) {
      risks.push(`vs tough ${oppPp.name.split(' ').slice(-1)[0]}`);
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

  // Park risk via the canonical primitive — same source of truth the
  // rating engine uses, so the risk text and the rating multiplier
  // agree on what counts as a hitter park.
  const parkAdj = getParkAdjustment({ park });
  if (parkAdj.available && parkAdj.multiplier <= 0.95) {
    // Pitcher composite multiplier ≤ 0.95 means the offense side is
    // boosted ≥ 5%. Surface the primitive's own hint when present.
    risks.push(parkAdj.hint ? parkAdj.hint.toLowerCase() : 'hitter park');
  }

  if (rating.platoon.available && rating.platoon.deltaPct <= -3) {
    risks.push('platoon vuln');
  }

  return risks.slice(0, 2);
}
