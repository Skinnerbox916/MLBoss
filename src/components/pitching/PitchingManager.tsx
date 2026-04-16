'use client';

import { useState, useMemo } from 'react';
import { FiWind, FiSun, FiCloud, FiCloudRain, FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useRoster } from '@/lib/hooks/useRoster';
import { useGameDay, type EnrichedGame } from '@/lib/hooks/useGameDay';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useAvailablePitchers } from '@/lib/hooks/useAvailablePitchers';
import { useTeamOffense } from '@/lib/hooks/useTeamOffense';
import { getWeatherScore } from '@/lib/mlb/analysis';
import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { ProbablePitcher, ParkData, PitcherTier, GameWeather, MLBGame } from '@/lib/mlb/types';
import type { TeamOffense } from '@/lib/mlb/teams';

// ---------------------------------------------------------------------------
// Stream-for category pills — per-pitcher indicators
// ---------------------------------------------------------------------------

type StreamGoal = 'QS' | 'K' | 'W' | 'ERA' | 'WHIP';

interface StreamPill {
  goal: StreamGoal;
  verdict: 'strong' | 'weak';
}

// ---------------------------------------------------------------------------
// Score breakdown — how overallScore was computed
// ---------------------------------------------------------------------------

interface ScoreComponent {
  label: string;
  detail: string;
  val: number;    // 0–1 sub-score (higher = better for streaming)
  weight: number; // contribution weight (sum = 1.0)
}

interface ScoredBreakdown {
  total: number;
  components: ScoreComponent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isPitcher(p: RosterEntry): boolean {
  return (
    p.eligible_positions.includes('P') ||
    p.eligible_positions.includes('SP') ||
    p.eligible_positions.includes('RP') ||
    p.display_position === 'SP' ||
    p.display_position === 'RP' ||
    p.display_position === 'P'
  );
}

function tierColor(tier: PitcherTier): string {
  switch (tier) {
    case 'ace': return 'text-success font-bold';
    case 'tough': return 'text-success';
    case 'average': return 'text-foreground';
    case 'weak': return 'text-accent';
    case 'bad': return 'text-error';
    default: return 'text-muted-foreground';
  }
}

function tierLabel(tier: PitcherTier): string {
  switch (tier) {
    case 'ace': return 'ACE';
    case 'tough': return 'Tough';
    case 'average': return 'Avg';
    case 'weak': return 'Weak';
    case 'bad': return 'Bad';
    default: return '?';
  }
}

function formatVal(value: string, name: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (['ERA', 'WHIP'].includes(name)) return num.toFixed(2);
  if (name === 'IP') return num.toFixed(1);
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
}

function weatherIcon(condition: string | null) {
  if (!condition) return null;
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle')) return FiCloudRain;
  if (c.includes('sun') || c.includes('clear')) return FiSun;
  return FiCloud;
}

function hasWeatherData(w: GameWeather): boolean {
  return w.condition !== null || w.temperature !== null || w.windSpeed !== null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Resolve the "effective" ERA used for scoring. xERA (Savant, bip≥10 upstream
 * gate) is preferred — it strips defence and BABIP luck and stabilises roughly
 * 4× faster than raw ERA. Raw ERA is only trusted when the pitcher has IP ≥ 25
 * (roughly 4–5 full starts). Below that, we fall through to quality.tier which
 * has its own prior-year fallback, or neutral.
 */
function effectiveEra(pp: ProbablePitcher): number | null {
  if (pp.xera !== null) return pp.xera;
  if (pp.era !== null && pp.inningsPitched >= 25) return pp.era;
  return null;
}

/**
 * A pitcher we have no meaningful sample for *as a starter* — tier classifier
 * couldn't place them (no 25 IP current or 60 IP prior starter sample) and
 * current-season starter IP is below 20. Rookie callups, spot starters, and
 * relievers-turned-starters land here. Savant xERA is intentionally NOT a
 * disqualifier: relief-role xERA doesn't translate to starting, so a low
 * xERA on a reliever making their first start is misleading.
 */
function isUnprovenPitcher(pp: ProbablePitcher): boolean {
  return (
    (pp.quality?.tier === 'unknown' || !pp.quality)
    && pp.inningsPitched < 20
  );
}

/** Replacement-level talent sub-score (~xERA 4.9) applied to unproven pitchers. */
const UNPROVEN_TALENT_VAL = 0.20;

/**
 * Pessimistic defaults for pitcher-ability sub-scores when the pitcher is
 * unproven. Tiny samples produce garbage highs (e.g., 0 ER in 4 IP → elite
 * K/9, BB/9, GB); neutralizing prevents that noise from pulling the overall
 * score up. Environment factors (matchup, park, weather, home/away, opp
 * power) remain untouched since they don't depend on pitcher talent.
 */
const UNPROVEN_K_VAL = 0.30;
const UNPROVEN_BB9_VAL = 0.30;
const UNPROVEN_GB_VAL = 0.50;
const UNPROVEN_GB_PARK_VAL = 0.50;
const UNPROVEN_IPGS_VAL = 0.30;
const UNPROVEN_PLATOON_VAL = 0.50;
const UNPROVEN_RECENT_VAL = 0.30;

/** Overall score multiplier for unproven pitchers — reflects "we don't know". */
const UNPROVEN_SCORE_MULTIPLIER = 0.80;

/**
 * Translate a quality tier to an xERA-equivalent so talent scoring remains
 * on a consistent scale when we fall back from Statcast/raw ERA.
 */
function tierToEra(tier: PitcherTier | undefined): number | null {
  switch (tier) {
    case 'ace': return 2.90;
    case 'tough': return 3.50;
    case 'average': return 4.10;
    case 'weak': return 4.70;
    case 'bad': return 5.30;
    default: return null;
  }
}

/**
 * Get opponent OPS against this pitcher's throwing hand. A LHP sees the
 * opposing team's vs-LHP line; RHP sees vs-RHP. Falls back to overall OPS
 * when a handedness split isn't available (early season / low data).
 */
function oppOpsVsHand(pp: ProbablePitcher, opp: TeamOffense | null): number | null {
  if (!opp) return null;
  if (pp.throws === 'L') return opp.vsLeft?.ops ?? opp.ops ?? null;
  return opp.vsRight?.ops ?? opp.ops ?? null;
}

function oppKRateVsHand(pp: ProbablePitcher, opp: TeamOffense | null): number | null {
  if (!opp) return null;
  if (pp.throws === 'L') return opp.vsLeft?.strikeOutRate ?? opp.strikeOutRate ?? null;
  return opp.vsRight?.strikeOutRate ?? opp.strikeOutRate ?? null;
}

// ---------------------------------------------------------------------------
// Per-pitcher pill evaluation
// ---------------------------------------------------------------------------

interface PillInput {
  pp: ProbablePitcher;
  oppOffense: TeamOffense | null;
  park: ParkData | null;
  weather: GameWeather;
  isHome: boolean;
  game: MLBGame;
}

/**
 * Evaluate a streaming pitcher and produce category pills showing what
 * they'd likely help (strong) or hurt (weak) in your matchup.
 *
 * Pill thresholds are calibrated to fire only when a signal is genuinely
 * actionable — not every "slightly above average" candidate gets a pill,
 * because noise would swamp the signal. Magnitude is shown in the label
 * when the underlying metric is extreme (e.g. `11.2 K/9`, `2.85 xERA`).
 */
function getStreamPills(input: PillInput): StreamPill[] {
  const { pp, oppOffense, park, isHome, game } = input;
  const pills: StreamPill[] = [];

  // Every pill condition below leans on the pitcher's own ability signals
  // (ERA/xERA, K/9, BB/9, WHIP, IPGS). For unproven starters those signals
  // are either missing or contaminated (relief-role xERA, tiny samples), so
  // we suppress all pills rather than fire misleading strong verdicts.
  if (isUnprovenPitcher(pp)) return pills;

  const era = effectiveEra(pp) ?? tierToEra(pp.quality?.tier);
  const oppOps = oppOpsVsHand(pp, oppOffense);
  const oppK = oppKRateVsHand(pp, oppOffense);

  const parkFactor = park?.parkFactor ?? 100;
  const parkHR = park?.parkFactorHR ?? parkFactor;
  // Continuous weather score: 0.5 neutral, higher = hitter-favouring.
  const wxScore = getWeatherScore(game, park);

  // --- QS: workhorse + quality + decent matchup + command ---
  //
  // QS requires 6 IP and ≤3 ER. Walk rate is critical — high BB/9 pitchers
  // burn pitches and rarely reach 6 IP even with decent stuff.
  const ipgs = pp.inningsPerStart;
  const bb9 = pp.bb9;
  const lowWalks = bb9 === null || bb9 < 3.5;
  const highWalks = bb9 !== null && bb9 >= 4.5;
  if (ipgs !== null && ipgs >= 5.8 && era !== null && era <= 3.75 && lowWalks && (oppOps === null || oppOps <= 0.770)) {
    pills.push({ goal: 'QS', verdict: 'strong' });
  } else if (ipgs !== null && ipgs >= 6.2 && era !== null && era <= 4.20 && lowWalks) {
    pills.push({ goal: 'QS', verdict: 'strong' });
  } else if (ipgs !== null && ipgs < 5.0) {
    pills.push({ goal: 'QS', verdict: 'weak' });
  } else if (highWalks && ipgs !== null && ipgs < 5.8) {
    pills.push({ goal: 'QS', verdict: 'weak' });
  } else if (era !== null && era >= 4.75 && ipgs !== null && ipgs < 5.7) {
    pills.push({ goal: 'QS', verdict: 'weak' });
  }

  // --- K: K/9 magnitude + opponent K-prone synergy ---
  //
  // Elite K/9 (≥ 10.5) fires strong regardless of opponent — Sale/Skubal/Glasnow
  // will miss bats against anyone. Mid-tier K/9 needs a K-prone opponent to
  // fire strong. Low K/9 fires weak only when the matchup is also contact-heavy.
  const k9 = pp.strikeoutsPer9;
  if (k9 !== null && k9 >= 10.5) {
    pills.push({ goal: 'K', verdict: 'strong' });
  } else if (k9 !== null && k9 >= 9.0 && (oppK === null || oppK >= 0.205)) {
    pills.push({ goal: 'K', verdict: 'strong' });
  } else if (k9 !== null && k9 >= 7.8 && oppK !== null && oppK >= 0.235) {
    // Matchup-driven K boost — mid-tier arm vs a team that strikes out a lot
    pills.push({ goal: 'K', verdict: 'strong' });
  } else if (k9 !== null && k9 <= 6.0) {
    pills.push({ goal: 'K', verdict: 'weak' });
  } else if (k9 !== null && k9 <= 7.5 && oppK !== null && oppK <= 0.195) {
    pills.push({ goal: 'K', verdict: 'weak' });
  }

  // --- W: good pitcher + weak opponent + home edge ---
  //
  // Wins are the least predictable category but clearly correlate with
  // run differential. Good xERA + weak opp OPS + home is the textbook
  // setup; elite talent fires strong even without home split.
  if (era !== null && era <= 3.75 && oppOps !== null && oppOps <= 0.720 && isHome) {
    pills.push({ goal: 'W', verdict: 'strong' });
  } else if (era !== null && era <= 3.25 && (oppOps === null || oppOps <= 0.750)) {
    pills.push({ goal: 'W', verdict: 'strong' });
  } else if (era !== null && era >= 5.00 && oppOps !== null && oppOps >= 0.770) {
    pills.push({ goal: 'W', verdict: 'weak' });
  }

  // --- ERA: run suppression with env factors + GB×park ---
  //
  // GB pitchers mitigate HR-park risk — don't fire weak ERA for a groundballer
  // in a bandbox. Fly-ball pitchers in HR parks get weak even with decent xERA.
  const isGB = pp.gbRate !== null && pp.gbRate >= 0.50;
  if (era !== null && era <= 3.25) {
    pills.push({ goal: 'ERA', verdict: 'strong' });
  } else if (era !== null && era <= 3.75 && (oppOps === null || oppOps <= 0.730) && parkHR <= 102 && wxScore <= 0.55) {
    pills.push({ goal: 'ERA', verdict: 'strong' });
  } else if (era !== null && era >= 5.00) {
    pills.push({ goal: 'ERA', verdict: 'weak' });
  } else if (era !== null && era >= 4.20 && parkHR >= 108 && wxScore >= 0.65 && !isGB) {
    pills.push({ goal: 'ERA', verdict: 'weak' });
  }

  // --- WHIP: baserunner prevention ---
  //
  // BB/9 is half the WHIP equation. Good WHIP + high walks = unsustainable.
  // High BB/9 fires weak WHIP even when current WHIP looks OK.
  if (pp.whip !== null && pp.whip <= 1.08 && !highWalks) {
    pills.push({ goal: 'WHIP', verdict: 'strong' });
  } else if (pp.whip !== null && pp.whip <= 1.20 && !highWalks && oppOps !== null && oppOps <= 0.730) {
    pills.push({ goal: 'WHIP', verdict: 'strong' });
  } else if (pp.whip !== null && pp.whip >= 1.42) {
    pills.push({ goal: 'WHIP', verdict: 'weak' });
  } else if (highWalks && (pp.whip === null || pp.whip >= 1.25)) {
    pills.push({ goal: 'WHIP', verdict: 'weak' });
  }

  return pills;
}

/**
 * Magnitude-aware composite streaming score for sorting candidates.
 *
 * All sub-scores are continuous 0–1 values (higher = better for streaming).
 * The weights reflect predictive power rather than Yahoo category importance —
 * the category-specific pills surface category fit, while this score answers
 * "is this a good pitcher to start tomorrow at all?"
 *
 *   **Talent (xERA/ERA):    0.22**   xERA strips defence and BABIP luck from
 *                                    ERA; it stabilises in ~50 BIP vs ~200 IP
 *                                    for actual ERA. Falls back to ERA when
 *                                    IP ≥ 25, then quality tier. Single most
 *                                    predictive signal for one-game outcomes.
 *   **Opp offense vs hand:  0.14**   Opposing team OPS on this pitcher's side
 *                                    of the platoon.
 *   **K potential:          0.10**   K/9 × opponent K-rate synergy.
 *   **BB/9 (walk rate):     0.08**   High BB/9 = short outings, high WHIP,
 *                                    jams. Stabilises in ~100 BF.
 *   **Park:                 0.06**   Overall + HR factor blended.
 *   **GB rate:              0.05**   Ground-ball pitchers suppress HR.
 *   **GB × Park:            0.05**   Critical interaction — a GB arm at Coors
 *                                    is plausible, a FB arm is a disaster.
 *   **Workload (IPGS):      0.05**   IP per start gates QS + W eligibility.
 *   **Weather:              0.05**   Inverted batter weather score.
 *   **Platoon vulnerability: 0.04**  Pitcher's OPS allowed on their weak side.
 *   **Opp power (HR):       0.03**   Opponent HR/game — power beyond OPS.
 *   **Home/away:            0.03**   ~0.25 ERA historical edge.
 *   **Recent form:          0.03**   Last 3 starts ERA.
 */
function overallScore(input: PillInput): number {
  const { pp, oppOffense, park, isHome, game } = input;
  const unproven = isUnprovenPitcher(pp);

  // ── Talent (xERA > ERA@IP≥25 > tier fallback) ──
  const era = effectiveEra(pp) ?? tierToEra(pp.quality?.tier);
  const talentVal = unproven
    ? UNPROVEN_TALENT_VAL
    : era !== null ? clamp01(1 - (era - 2.5) / 3.0) : 0.5;

  // ── Opp offense vs this pitcher's throwing hand ──
  const oppOps = oppOpsVsHand(pp, oppOffense);
  const matchupVal = oppOps !== null ? clamp01(1 - (oppOps - 0.650) / 0.200) : 0.5;

  // ── K potential: K/9 magnitude, boosted by K-prone opponent ──
  const k9 = pp.strikeoutsPer9;
  const kBase = k9 !== null ? clamp01((k9 - 6.0) / 6.0) : 0.5;
  const oppK = oppKRateVsHand(pp, oppOffense);
  const kSynergy = oppK !== null ? clamp01(0.5 + (oppK - 0.215) / 0.090) : 0.5;
  const kVal = unproven ? UNPROVEN_K_VAL : clamp01(kBase * 0.75 + kSynergy * 0.25);

  // ── BB/9 (walk rate) ──
  // 1.5 BB/9 → 1.0 (elite command), 5.0 BB/9 → 0.0 (walk machine)
  const bb9Val = unproven
    ? UNPROVEN_BB9_VAL
    : pp.bb9 !== null ? clamp01(1 - (pp.bb9 - 1.5) / 3.5) : 0.5;

  // ── Park (overall + HR factor blended) ──
  let parkVal = 0.5;
  if (park) {
    const pfVal = clamp01(1 - (park.parkFactor - 85) / 30);
    const hrParkVal = clamp01(1 - (park.parkFactorHR - 85) / 30);
    parkVal = pfVal * 0.6 + hrParkVal * 0.4;
  }

  // ── GB rate ──
  // 0.55 → 1.0 (elite GB), 0.35 → 0.0 (fly-ball pitcher)
  const gbVal = unproven
    ? UNPROVEN_GB_VAL
    : pp.gbRate !== null ? clamp01((pp.gbRate - 0.35) / 0.20) : 0.5;

  // ── GB × Park interaction ──
  // High GB mitigates HR-park risk; low GB amplifies it.
  let gbParkVal = 0.5;
  if (unproven) {
    gbParkVal = UNPROVEN_GB_PARK_VAL;
  } else if (pp.gbRate !== null && park) {
    const hrRisk = (park.parkFactorHR - 100) / 25;
    const gbMitigation = (pp.gbRate - 0.40) / 0.15;
    gbParkVal = clamp01(0.5 + gbMitigation * 0.3 - hrRisk * 0.3);
  }

  // ── Workload (IPGS) ──
  const ipgsVal = unproven
    ? UNPROVEN_IPGS_VAL
    : pp.inningsPerStart !== null ? clamp01((pp.inningsPerStart - 4.5) / 2.0) : 0.5;

  // ── Weather (inverted — pitcher wants the opposite of the batter) ──
  const wxVal = 1 - getWeatherScore(game, park);

  // ── Platoon vulnerability ──
  // Pitcher's OPS allowed on their weak side (opposite hand)
  const weakSideOps = pp.throws === 'L' ? pp.platoonOpsVsRight : pp.platoonOpsVsLeft;
  const platoonVal = unproven
    ? UNPROVEN_PLATOON_VAL
    : weakSideOps !== null ? clamp01(1 - (weakSideOps - 0.650) / 0.250) : 0.5;

  // ── Opp power: HR-per-game ──
  const oppHR = oppOffense?.homeRunsPerGame ?? null;
  const hrVal = oppHR !== null ? clamp01(1 - (oppHR - 0.8) / 0.7) : 0.5;

  // ── Home/away ──
  const homeVal = isHome ? 0.65 : 0.35;

  // ── Recent form (last 3 starts) ──
  // 2.0 ERA → 1.0, 6.0 ERA → 0.0
  const recentVal = unproven
    ? UNPROVEN_RECENT_VAL
    : pp.recentFormEra !== null ? clamp01(1 - (pp.recentFormEra - 2.0) / 4.0) : 0.5;

  const raw = (
    talentVal   * 0.22 +
    matchupVal  * 0.14 +
    kVal        * 0.10 +
    bb9Val      * 0.08 +
    parkVal     * 0.06 +
    gbVal       * 0.05 +
    gbParkVal   * 0.05 +
    ipgsVal     * 0.05 +
    wxVal       * 0.05 +
    platoonVal  * 0.04 +
    hrVal       * 0.03 +
    homeVal     * 0.03 +
    recentVal   * 0.03
  );
  return unproven ? raw * UNPROVEN_SCORE_MULTIPLIER : raw;
}

/**
 * Same logic as overallScore but returns each component with its label,
 * detail string, and sub-score so the UI can render a breakdown panel.
 */
function computeBreakdown(input: PillInput): ScoredBreakdown {
  const { pp, oppOffense, park, isHome, game } = input;
  const components: ScoreComponent[] = [];
  const unproven = isUnprovenPitcher(pp);

  // Talent
  const era = effectiveEra(pp) ?? tierToEra(pp.quality?.tier);
  const talentVal = unproven
    ? UNPROVEN_TALENT_VAL
    : era !== null ? clamp01(1 - (era - 2.5) / 3.0) : 0.5;
  let talentDetail: string;
  if (unproven) talentDetail = 'Unproven — no MLB sample';
  else if (pp.xera !== null) talentDetail = `xERA ${pp.xera.toFixed(2)}`;
  else if (pp.era !== null && pp.inningsPitched >= 25) talentDetail = `ERA ${pp.era.toFixed(2)} (${pp.inningsPitched.toFixed(0)} IP)`;
  else if (pp.quality?.tier) talentDetail = `${tierLabel(pp.quality.tier)} tier (low IP)`;
  else talentDetail = 'No data';
  components.push({ label: 'Talent', detail: talentDetail, val: talentVal, weight: 0.22 });

  // Matchup
  const oppOps = oppOpsVsHand(pp, oppOffense);
  const matchupVal = oppOps !== null ? clamp01(1 - (oppOps - 0.650) / 0.200) : 0.5;
  const matchupDetail = oppOps !== null
    ? `Opp ${oppOps.toFixed(3).replace(/^0\./, '.')} OPS vs ${pp.throws}HP`
    : 'No offense data';
  components.push({ label: 'Matchup', detail: matchupDetail, val: matchupVal, weight: 0.14 });

  // K potential
  const k9 = pp.strikeoutsPer9;
  const kBase = k9 !== null ? clamp01((k9 - 6.0) / 6.0) : 0.5;
  const oppK = oppKRateVsHand(pp, oppOffense);
  const kSynergy = oppK !== null ? clamp01(0.5 + (oppK - 0.215) / 0.090) : 0.5;
  const kVal = unproven ? UNPROVEN_K_VAL : clamp01(kBase * 0.75 + kSynergy * 0.25);
  let kDetail: string;
  if (unproven) {
    kDetail = 'Unproven — small sample suppressed';
  } else {
    kDetail = k9 !== null ? `K/9 ${k9.toFixed(1)}` : 'No K/9';
    if (oppK !== null) kDetail += ` · Opp ${(oppK * 100).toFixed(1)}% K`;
  }
  components.push({ label: 'K Potential', detail: kDetail, val: kVal, weight: 0.10 });

  // BB/9
  const bb9Val = unproven
    ? UNPROVEN_BB9_VAL
    : pp.bb9 !== null ? clamp01(1 - (pp.bb9 - 1.5) / 3.5) : 0.5;
  const bb9Detail = unproven
    ? 'Unproven — small sample suppressed'
    : pp.bb9 !== null ? `${pp.bb9.toFixed(1)} BB/9` : 'No BB data';
  components.push({ label: 'Walk Rate', detail: bb9Detail, val: bb9Val, weight: 0.08 });

  // Park
  let parkVal = 0.5;
  let parkDetail = 'No park data';
  if (park) {
    const pfVal = clamp01(1 - (park.parkFactor - 85) / 30);
    const hrParkVal = clamp01(1 - (park.parkFactorHR - 85) / 30);
    parkVal = pfVal * 0.6 + hrParkVal * 0.4;
    parkDetail = `PF ${park.parkFactor} · HR PF ${park.parkFactorHR}`;
  }
  components.push({ label: 'Park', detail: parkDetail, val: parkVal, weight: 0.06 });

  // GB rate
  const gbVal = unproven
    ? UNPROVEN_GB_VAL
    : pp.gbRate !== null ? clamp01((pp.gbRate - 0.35) / 0.20) : 0.5;
  const gbDetail = unproven
    ? 'Unproven — small sample suppressed'
    : pp.gbRate !== null ? `${(pp.gbRate * 100).toFixed(0)}% GB` : 'No GB data';
  components.push({ label: 'GB Rate', detail: gbDetail, val: gbVal, weight: 0.05 });

  // GB × Park interaction
  let gbParkVal = 0.5;
  let gbParkDetail = 'N/A';
  if (unproven) {
    gbParkVal = UNPROVEN_GB_PARK_VAL;
    gbParkDetail = 'Unproven — small sample suppressed';
  } else if (pp.gbRate !== null && park) {
    const hrRisk = (park.parkFactorHR - 100) / 25;
    const gbMitigation = (pp.gbRate - 0.40) / 0.15;
    gbParkVal = clamp01(0.5 + gbMitigation * 0.3 - hrRisk * 0.3);
    gbParkDetail = `${(pp.gbRate * 100).toFixed(0)}% GB @ HR PF ${park.parkFactorHR}`;
  }
  components.push({ label: 'GB × Park', detail: gbParkDetail, val: gbParkVal, weight: 0.05 });

  // Workload
  const ipgsVal = unproven
    ? UNPROVEN_IPGS_VAL
    : pp.inningsPerStart !== null ? clamp01((pp.inningsPerStart - 4.5) / 2.0) : 0.5;
  const ipgsDetail = unproven
    ? 'Unproven — small sample suppressed'
    : pp.inningsPerStart !== null ? `${pp.inningsPerStart.toFixed(1)} IP/GS` : 'No IP/GS';
  components.push({ label: 'Workload', detail: ipgsDetail, val: ipgsVal, weight: 0.05 });

  // Weather
  const wxVal = 1 - getWeatherScore(game, park);
  let wxDetail = 'No weather data';
  const wx = game.weather;
  if (wx.condition || wx.temperature !== null || wx.windSpeed !== null) {
    const parts: string[] = [];
    if (wx.temperature !== null) parts.push(`${wx.temperature}°`);
    if (wx.condition) parts.push(wx.condition);
    if (wx.windSpeed !== null && wx.windSpeed > 0) {
      parts.push(`${wx.windSpeed} mph${wx.windDirection ? ' ' + wx.windDirection : ''}`);
    }
    wxDetail = parts.join(' · ') || 'No weather data';
  }
  components.push({ label: 'Weather', detail: wxDetail, val: wxVal, weight: 0.05 });

  // Platoon vulnerability
  const weakSideOps = pp.throws === 'L' ? pp.platoonOpsVsRight : pp.platoonOpsVsLeft;
  const platoonVal = unproven
    ? UNPROVEN_PLATOON_VAL
    : weakSideOps !== null ? clamp01(1 - (weakSideOps - 0.650) / 0.250) : 0.5;
  const platoonDetail = unproven
    ? 'Unproven — small sample suppressed'
    : weakSideOps !== null
      ? `${weakSideOps.toFixed(3).replace(/^0\./, '.')} OPS allowed vs ${pp.throws === 'L' ? 'RHH' : 'LHH'}`
      : 'No platoon data';
  components.push({ label: 'Platoon', detail: platoonDetail, val: platoonVal, weight: 0.04 });

  // Opp power
  const oppHR = oppOffense?.homeRunsPerGame ?? null;
  const hrVal = oppHR !== null ? clamp01(1 - (oppHR - 0.8) / 0.7) : 0.5;
  const hrDetail = oppHR !== null ? `${oppHR.toFixed(2)} HR/G` : 'No HR data';
  components.push({ label: 'Opp Power', detail: hrDetail, val: hrVal, weight: 0.03 });

  // Home/away
  const homeVal = isHome ? 0.65 : 0.35;
  components.push({ label: 'Home/Away', detail: isHome ? 'Home' : 'Away', val: homeVal, weight: 0.03 });

  // Recent form
  const recentVal = unproven
    ? UNPROVEN_RECENT_VAL
    : pp.recentFormEra !== null ? clamp01(1 - (pp.recentFormEra - 2.0) / 4.0) : 0.5;
  const recentDetail = unproven
    ? 'Unproven — small sample suppressed'
    : pp.recentFormEra !== null ? `${pp.recentFormEra.toFixed(2)} ERA last 3 GS` : 'No recent data';
  components.push({ label: 'Recent Form', detail: recentDetail, val: recentVal, weight: 0.03 });

  const raw = components.reduce((sum, c) => sum + c.val * c.weight, 0);
  const total = unproven ? raw * UNPROVEN_SCORE_MULTIPLIER : raw;
  return { total, components };
}

// ---------------------------------------------------------------------------
// Matchup Pulse — pitching category scores vs opponent
// ---------------------------------------------------------------------------

interface PulseProps {
  leagueKey: string | undefined;
  teamKey: string | undefined;
}

function MatchupPulse({ leagueKey, teamKey }: PulseProps) {
  const { matchups, week, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);

  const isLoading = scoreLoading || catsLoading;

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const pitchingCats = categories.filter(c => c.is_pitcher_stat);

  const rows = useMemo(() => {
    if (!userTeam?.stats || !opponent?.stats) return [];
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    return pitchingCats.flatMap(cat => {
      const myRaw = myMap.get(cat.stat_id);
      const oppRaw = oppMap.get(cat.stat_id);
      if (myRaw === undefined || oppRaw === undefined) return [];
      const myNum = parseFloat(myRaw);
      const oppNum = parseFloat(oppRaw);
      if (isNaN(myNum) || isNaN(oppNum)) return [];
      const delta = myNum - oppNum;
      const winning = cat.betterIs === 'higher' ? delta > 0 : delta < 0;
      return [{
        label: cat.display_name,
        name: cat.name,
        myVal: myRaw,
        oppVal: oppRaw,
        winning: delta === 0 ? null : winning,
      }];
    });
  }, [userTeam, opponent, pitchingCats]);

  if (isLoading) {
    return (
      <div className="bg-surface rounded-lg shadow p-4 animate-pulse">
        <div className="h-4 bg-border-muted rounded w-48 mb-3" />
        <div className="flex gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 w-20 bg-border-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!userMatchup) {
    return (
      <div className="bg-surface rounded-lg shadow p-4">
        <p className="text-sm text-muted-foreground">No active matchup this week</p>
      </div>
    );
  }

  const wins = rows.filter(r => r.winning === true).length;
  const losses = rows.filter(r => r.winning === false).length;
  const ties = rows.filter(r => r.winning === null).length;

  return (
    <div className="bg-surface rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">
          Pitching Categories {week ? `— Week ${week}` : ''}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">vs {opponent?.name ?? 'Opp'}</span>
          <span className={`px-2 py-0.5 rounded-full font-medium ${
            wins > losses ? 'bg-success/15 text-success' :
            losses > wins ? 'bg-error/15 text-error' :
            'bg-primary/15 text-muted-foreground'
          }`}>
            {wins}W–{losses}L–{ties}T
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map(row => (
          <div
            key={row.label}
            className={`flex flex-col items-center px-3 py-2 rounded-lg border ${
              row.winning === true ? 'border-success/30 bg-success/5' :
              row.winning === false ? 'border-error/30 bg-error/5' :
              'border-border bg-background'
            }`}
          >
            <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
            <span className="text-sm font-bold text-foreground">{formatVal(row.myVal, row.name)}</span>
            <span className="text-xs text-muted-foreground">{formatVal(row.oppVal, row.name)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today's Starters — rostered pitchers confirmed as today's probable starters
// ---------------------------------------------------------------------------

interface TodayStarter extends ScoredPitcherCtx {
  rosterPlayer: RosterEntry;
  opponent: string;
  pills: StreamPill[];
  sortScore: number;
}

interface TodayStartersProps {
  roster: RosterEntry[];
  games: EnrichedGame[];
  isLoading: boolean;
  teamOffense: Record<number, TeamOffense>;
  offenseLoading: boolean;
}

function TodayStarters({ roster, games, isLoading, teamOffense, offenseLoading }: TodayStartersProps) {
  const starters = useMemo(() => {
    if (games.length === 0) return [];
    const results: TodayStarter[] = [];
    const pitchers = roster.filter(isPitcher);

    for (const pitcher of pitchers) {
      const abbr = normalizeTeamAbbr(pitcher.editorial_team_abbr);
      for (const g of games) {
        const homeAbbr = normalizeTeamAbbr(g.homeTeam.abbreviation);
        const awayAbbr = normalizeTeamAbbr(g.awayTeam.abbreviation);
        const isHome = homeAbbr === abbr;
        const isAway = awayAbbr === abbr;
        if (!isHome && !isAway) continue;

        const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
        if (!pp) continue;

        const ppLast = lastNameKey(pp.name);
        const rosterLast = lastNameKey(pitcher.name);
        if (!ppLast || ppLast !== rosterLast) continue;

        const opponentTeam = isHome ? g.awayTeam : g.homeTeam;
        const oppOffense = teamOffense[opponentTeam.mlbId] ?? null;

        const pillInput: PillInput = {
          pp,
          oppOffense,
          park: g.park ?? null,
          weather: g.weather,
          isHome,
          game: g,
        };

        results.push({
          rosterPlayer: pitcher,
          pp,
          opponent: opponentTeam.abbreviation,
          opponentMlbId: opponentTeam.mlbId,
          isHome,
          park: g.park ?? null,
          weather: g.weather,
          game: g,
          pills: getStreamPills(pillInput),
          sortScore: overallScore(pillInput),
        });
        break;
      }
    }

    results.sort((a, b) => b.sortScore - a.sortScore);
    return results;
  }, [roster, games, teamOffense]);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="bg-surface rounded-lg shadow p-4">
        <div className="h-4 bg-border-muted rounded w-48 mb-3 animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 px-3 py-2 mb-1">
            <div className="flex-1 space-y-1">
              <div className="h-3.5 bg-border-muted rounded w-40" />
              <div className="h-2.5 bg-border-muted rounded w-56" />
            </div>
            <div className="h-5 w-12 bg-border-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg shadow p-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">My Starters — Today</h2>
        <span className="text-xs text-muted-foreground">
          {starters.length} starter{starters.length !== 1 ? 's' : ''}
        </span>
      </div>

      {offenseLoading && (
        <p className="text-xs text-muted-foreground mb-2 animate-pulse">Loading team offense data...</p>
      )}

      {starters.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {roster.filter(isPitcher).length === 0
            ? 'No pitchers on roster'
            : 'None of your pitchers are confirmed starters today'}
        </p>
      ) : (
        <div className="space-y-1">
          {starters.map((s, i) => {
            const c = s;
            const isExpanded = expandedKey === s.rosterPlayer.player_key;
            const bgClass = c.sortScore >= 0.7 ? 'bg-success/5'
              : c.sortScore >= 0.5 ? ''
              : 'bg-error/5';

            const initial = s.rosterPlayer.name.charAt(0).toUpperCase();
            const opp = teamOffense[c.opponentMlbId];
            const oppSplit = c.pp.throws === 'L' ? opp?.vsLeft : opp?.vsRight;
            const oppOps = oppSplit?.ops ?? opp?.ops ?? null;
            const oppKRate = oppSplit?.strikeOutRate ?? opp?.strikeOutRate ?? null;
            const oppOpsColor =
              oppOps === null ? 'text-foreground' :
              oppOps <= 0.680 ? 'text-success font-semibold' :
              oppOps <= 0.720 ? 'text-success' :
              oppOps >= 0.800 ? 'text-error font-semibold' :
              oppOps >= 0.770 ? 'text-error' :
              'text-foreground';
            const parkFactor = c.park?.parkFactor ?? null;
            const parkHR = c.park?.parkFactorHR ?? null;
            const displayPf = parkHR !== null && parkFactor !== null
              ? (Math.abs(parkHR - 100) > Math.abs(parkFactor - 100) ? parkHR : parkFactor)
              : (parkFactor ?? parkHR);
            const pfIsHR = displayPf !== null && parkHR !== null && displayPf === parkHR && parkHR !== parkFactor;
            const pfColor =
              displayPf === null ? 'bg-surface-muted text-muted-foreground' :
              displayPf >= 110 ? 'bg-error/15 text-error font-semibold' :
              displayPf >= 104 ? 'bg-error/10 text-error' :
              displayPf <= 90 ? 'bg-success/15 text-success font-semibold' :
              displayPf <= 96 ? 'bg-success/10 text-success' :
              'bg-surface-muted text-muted-foreground';

            const slot = s.rosterPlayer.selected_position;
            const isBenched = slot === 'BN';
            const windOut = c.weather.windDirection?.toLowerCase().includes('out') ?? false;
            const windBad = windOut && (c.weather.windSpeed ?? 0) >= 10;

            return (
              <div key={s.rosterPlayer.player_key} className={`rounded-lg overflow-hidden ${bgClass}`}>
                <button
                  onClick={() => setExpandedKey(isExpanded ? null : s.rosterPlayer.player_key)}
                  className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-surface-muted/40 transition-colors"
                >
                  {/* Rank */}
                  <div className="w-5 text-center text-xs font-bold text-muted-foreground mt-2.5 shrink-0">
                    {i + 1}
                  </div>

                  {/* Avatar */}
                  {s.rosterPlayer.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.rosterPlayer.image_url}
                      alt={s.rosterPlayer.name}
                      className="w-9 h-9 rounded-full border border-border object-cover shrink-0 mt-0.5"
                      onError={e => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <div className={`w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${s.rosterPlayer.image_url ? 'hidden' : ''}`}>
                    {initial}
                  </div>

                  {/* Main info column */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {/* Line 1: Name + throws + tier + slot */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-foreground truncate">{s.rosterPlayer.name}</span>
                      <span className={`text-[11px] font-bold ${c.pp.throws === 'L' ? 'text-accent' : 'text-primary'}`}>
                        ({c.pp.throws}HP)
                      </span>
                      <span className={`text-[10px] font-bold ${tierColor(c.pp.quality?.tier ?? 'unknown')}`}>
                        {tierLabel(c.pp.quality?.tier ?? 'unknown')}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {s.rosterPlayer.editorial_team_abbr} · {s.rosterPlayer.display_position}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        isBenched ? 'bg-accent/10 text-accent' : 'bg-success/15 text-success'
                      }`}>
                        {isBenched ? 'BN' : slot}
                      </span>
                    </div>

                    {/* Line 2: Matchup context */}
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="text-muted-foreground">
                        {c.isHome ? 'vs' : '@'}{' '}
                        <span className="font-semibold text-foreground">{c.opponent}</span>
                      </span>
                      {oppOps !== null && (
                        <>
                          <span className="text-border">|</span>
                          <span className="text-muted-foreground">
                            Opp (vs{c.pp.throws}) <span className={oppOpsColor}>{oppOps.toFixed(3).replace(/^0\./, '.')}</span>
                            {oppKRate !== null && (oppKRate >= 0.240 || oppKRate <= 0.185) && (
                              <span className={`ml-1 ${oppKRate >= 0.240 ? 'text-success' : 'text-error'}`}>
                                {(oppKRate * 100).toFixed(1)}% K
                              </span>
                            )}
                          </span>
                        </>
                      )}
                      <span className="text-border">|</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${pfColor}`}
                        title={parkFactor !== null && parkHR !== null ? `Overall PF ${parkFactor} · HR PF ${parkHR}` : undefined}
                      >
                        {pfIsHR ? 'HR' : 'PF'} {displayPf ?? '—'}
                      </span>
                      {hasWeatherData(c.weather) && (
                        <div className="flex items-center gap-1">
                          {(() => {
                            const Wx = weatherIcon(c.weather.condition);
                            return Wx ? <Icon icon={Wx} size={12} className="text-muted-foreground" /> : null;
                          })()}
                          {c.weather.temperature != null && (
                            <span className="text-muted-foreground">{c.weather.temperature}°</span>
                          )}
                          {c.weather.windSpeed != null && c.weather.windSpeed > 0 && (
                            <span className={`flex items-center gap-0.5 ${windBad ? 'text-error' : 'text-muted-foreground'}`}>
                              <Icon icon={FiWind} size={10} />
                              {c.weather.windSpeed}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Line 3: Stat line */}
                    <div className="text-[11px] text-muted-foreground">
                      {renderPitcherStatLine(c.pp)}
                    </div>

                    {/* Line 4: Stream-for pills */}
                    {c.pills.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        {c.pills.map(pill => (
                          <span
                            key={pill.goal}
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              pill.verdict === 'strong'
                                ? 'bg-success/15 text-success'
                                : 'bg-error/15 text-error'
                            }`}
                          >
                            {pill.goal}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Expand chevron */}
                  <Icon
                    icon={FiChevronDown}
                    size={16}
                    className={`shrink-0 text-muted-foreground transition-transform mt-3 ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {isExpanded && (
                  <ScoreBreakdownPanel c={c} teamOffense={teamOffense} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Streaming Board — enriched with scoring, team offense, weather, park
// ---------------------------------------------------------------------------

interface StreamCandidate {
  player: FreeAgentPlayer;
  pp: ProbablePitcher;
  opponent: string;
  opponentMlbId: number;
  isHome: boolean;
  park: ParkData | null;
  weather: GameWeather;
  game: MLBGame;
  pills: StreamPill[];
  sortScore: number;
}

interface StreamingBoardProps {
  date: string;
  games: EnrichedGame[];
  freeAgents: FreeAgentPlayer[];
  gamesLoading: boolean;
  faLoading: boolean;
  faError: boolean;
  teamOffense: Record<number, TeamOffense>;
  offenseLoading: boolean;
}

// Yahoo ↔ MLB team abbreviation aliases (both directions resolve to a canonical key)
const TEAM_ABBR_ALIASES: Record<string, string> = {
  AZ: 'ARI', ARI: 'ARI',
  CHW: 'CWS', CWS: 'CWS',
  WAS: 'WSH', WSH: 'WSH',
  KCR: 'KC', KC: 'KC',
  SDP: 'SD', SD: 'SD',
  SFG: 'SF', SF: 'SF',
  TBR: 'TB', TB: 'TB',
};

function normalizeTeamAbbr(abbr: string): string {
  const upper = (abbr ?? '').toUpperCase();
  return TEAM_ABBR_ALIASES[upper] ?? upper;
}

/** Normalize a name for fuzzy matching: strip diacritics, suffixes, punctuation, lowercase. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, '')
    .trim();
}

/** Extract a normalized last name token for matching. */
function lastNameKey(name: string): string {
  const parts = normalizeName(name).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function matchFreeAgentToGame(
  fa: FreeAgentPlayer,
  games: EnrichedGame[],
): { game: EnrichedGame; pp: ProbablePitcher; isHome: boolean } | null {
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

    // Match on last name, OR on full name containment (handles e.g. "JT Brubaker" vs "J.T. Brubaker")
    if (faLast && ppLast && (faLast === ppLast || faFull === ppFull || faFull.includes(ppLast) || ppFull.includes(faLast))) {
      return { game: g, pp, isHome };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared rendering helpers
// ---------------------------------------------------------------------------

interface ScoredPitcherCtx {
  pp: ProbablePitcher;
  opponentMlbId: number;
  isHome: boolean;
  park: ParkData | null;
  weather: GameWeather;
  game: MLBGame;
}

function renderPitcherStatLine(pp: ProbablePitcher): React.ReactNode {
  const parts: React.ReactNode[] = [];
  if (pp.era !== null) parts.push(<span key="era">ERA {pp.era.toFixed(2)}</span>);
  if (pp.xera !== null) {
    const xeraColor =
      pp.xera <= 3.25 ? 'text-success' :
      pp.xera >= 4.75 ? 'text-error' :
      'text-foreground';
    parts.push(
      <span key="xera" className={xeraColor}>
        xERA {pp.xera.toFixed(2)}
      </span>,
    );
  }
  if (pp.whip !== null) parts.push(<span key="whip">WHIP {pp.whip.toFixed(2)}</span>);
  if (pp.strikeoutsPer9 !== null) parts.push(<span key="k9">K/9 {pp.strikeoutsPer9.toFixed(1)}</span>);
  if (pp.bb9 !== null) {
    const bb9Color = pp.bb9 <= 2.5 ? 'text-success' : pp.bb9 >= 4.0 ? 'text-error' : '';
    parts.push(<span key="bb9" className={bb9Color}>BB/9 {pp.bb9.toFixed(1)}</span>);
  }
  if (pp.gbRate !== null) {
    const gbColor = pp.gbRate >= 0.50 ? 'text-success' : pp.gbRate <= 0.38 ? 'text-error' : '';
    parts.push(<span key="gb" className={gbColor}>GB {(pp.gbRate * 100).toFixed(0)}%</span>);
  }
  if (pp.inningsPerStart !== null) parts.push(<span key="ipgs">IP/GS {pp.inningsPerStart.toFixed(1)}</span>);
  return parts.reduce<React.ReactNode[]>((acc, part, i) => {
    if (i > 0) acc.push(<span key={`sep-${i}`} className="text-border mx-1.5">·</span>);
    acc.push(part);
    return acc;
  }, []);
}

// ---------------------------------------------------------------------------
// Score breakdown panel — shown when a candidate row is expanded
// ---------------------------------------------------------------------------

function ScoreBreakdownPanel({
  c,
  teamOffense,
}: {
  c: ScoredPitcherCtx;
  teamOffense: Record<number, TeamOffense>;
}) {
  const oppOffense = teamOffense[c.opponentMlbId] ?? null;
  const pillInput: PillInput = {
    pp: c.pp,
    oppOffense,
    park: c.park,
    weather: c.weather,
    isHome: c.isHome,
    game: c.game,
  };
  const breakdown = computeBreakdown(pillInput);

  return (
    <div className="px-4 pb-3 pt-2 border-t border-border-muted bg-surface-muted/20">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Score Breakdown — {(breakdown.total * 100).toFixed(0)}/100
      </p>
      <div className="space-y-1.5">
        {breakdown.components.map(comp => {
          const barColor =
            comp.val >= 0.65 ? 'bg-success' :
            comp.val <= 0.40 ? 'bg-error' :
            'bg-primary/40';
          return (
            <div key={comp.label} className="grid items-center gap-2" style={{ gridTemplateColumns: '76px 28px 1fr auto' }}>
              <span className="text-[10px] text-muted-foreground">{comp.label}</span>
              <span className="text-[10px] text-muted-foreground text-right">{(comp.weight * 100).toFixed(0)}%</span>
              <div className="h-1.5 bg-border-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${barColor}`}
                  style={{ width: `${comp.val * 100}%` }}
                />
              </div>
              <span
                className="text-[10px] text-foreground text-right truncate max-w-[180px]"
                title={comp.detail}
              >
                {comp.detail}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StreamingBoard({
  date, games, freeAgents, gamesLoading, faLoading, faError,
  teamOffense, offenseLoading,
}: StreamingBoardProps) {
  const candidates = useMemo(() => {
    if (games.length === 0 || freeAgents.length === 0) return [];
    const results: StreamCandidate[] = [];

    for (const fa of freeAgents) {
      const match = matchFreeAgentToGame(fa, games);
      if (!match) continue;

      const { game, pp, isHome } = match;
      const opponentTeam = isHome ? game.awayTeam : game.homeTeam;
      const oppOffense = teamOffense[opponentTeam.mlbId] ?? null;

      const pillInput: PillInput = {
        pp,
        oppOffense,
        park: game.park ?? null,
        weather: game.weather,
        isHome,
        game,
      };

      results.push({
        player: fa,
        pp,
        opponent: opponentTeam.abbreviation,
        opponentMlbId: opponentTeam.mlbId,
        isHome,
        park: game.park ?? null,
        weather: game.weather,
        game,
        pills: getStreamPills(pillInput),
        sortScore: overallScore(pillInput),
      });
    }

    results.sort((a, b) => b.sortScore - a.sortScore);
    return results;
  }, [games, freeAgents, teamOffense]);

  const isLoading = gamesLoading || faLoading;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="bg-surface rounded-lg shadow p-4">
        <div className="h-4 bg-border-muted rounded w-48 mb-3 animate-pulse" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 px-3 py-2 mb-1">
            <div className="flex-1 space-y-1">
              <div className="h-3.5 bg-border-muted rounded w-40" />
              <div className="h-2.5 bg-border-muted rounded w-56" />
            </div>
            <div className="h-5 w-12 bg-border-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg shadow p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">
          Streaming Board — {date}
        </h2>
        <span className="text-xs text-muted-foreground">
          {candidates.length} starter{candidates.length !== 1 ? 's' : ''}
        </span>
      </div>

      {offenseLoading && (
        <p className="text-xs text-muted-foreground mb-2 animate-pulse">Loading team offense data...</p>
      )}

      {faError ? (
        <p className="text-sm text-error text-center py-4">Failed to load free agents</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {freeAgents.length === 0
            ? 'No free agent data available'
            : 'No free agent pitchers with probable starts found'}
        </p>
      ) : (
        <div className="space-y-1">
          {candidates.map((c, i) => {
            const windOut = c.weather.windDirection?.toLowerCase().includes('out') ?? false;
            const windBad = windOut && (c.weather.windSpeed ?? 0) >= 10;

            const bgClass = c.sortScore >= 0.7 ? 'bg-success/5'
              : c.sortScore >= 0.5 ? ''
              : 'bg-error/5';

            const initial = c.player.name.charAt(0).toUpperCase();
            const opp = teamOffense[c.opponentMlbId];
            const oppSplit = c.pp.throws === 'L' ? opp?.vsLeft : opp?.vsRight;
            const oppOps = oppSplit?.ops ?? opp?.ops ?? null;
            const oppKRate = oppSplit?.strikeOutRate ?? opp?.strikeOutRate ?? null;
            // Magnitude-aware colour from the pitcher's point of view:
            // weak offence = green (good matchup), strong offence = red.
            const oppOpsColor =
              oppOps === null ? 'text-foreground' :
              oppOps <= 0.680 ? 'text-success font-semibold' :
              oppOps <= 0.720 ? 'text-success' :
              oppOps >= 0.800 ? 'text-error font-semibold' :
              oppOps >= 0.770 ? 'text-error' :
              'text-foreground';
            const parkFactor = c.park?.parkFactor ?? null;
            const parkHR = c.park?.parkFactorHR ?? null;
            // Show the more alarming of overall/HR factor so Coors (115/125)
            // and Great American (106/118) surface their HR risk distinctly.
            const displayPf = parkHR !== null && parkFactor !== null
              ? (Math.abs(parkHR - 100) > Math.abs(parkFactor - 100) ? parkHR : parkFactor)
              : (parkFactor ?? parkHR);
            const pfIsHR = displayPf !== null && parkHR !== null && displayPf === parkHR && parkHR !== parkFactor;
            const pfColor =
              displayPf === null ? 'bg-surface-muted text-muted-foreground' :
              displayPf >= 110 ? 'bg-error/15 text-error font-semibold' :
              displayPf >= 104 ? 'bg-error/10 text-error' :
              displayPf <= 90 ? 'bg-success/15 text-success font-semibold' :
              displayPf <= 96 ? 'bg-success/10 text-success' :
              'bg-surface-muted text-muted-foreground';

            const isExpanded = expandedKey === c.player.player_key;

            return (
              <div
                key={c.player.player_key}
                className={`rounded-lg overflow-hidden ${bgClass}`}
              >
                <button
                  onClick={() => setExpandedKey(isExpanded ? null : c.player.player_key)}
                  className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-surface-muted/40 transition-colors"
                >
                  {/* Rank */}
                  <div className="w-5 text-center text-xs font-bold text-muted-foreground mt-2.5 shrink-0">
                    {i + 1}
                  </div>

                  {/* Avatar */}
                  {c.player.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.player.image_url}
                      alt={c.player.name}
                      className="w-9 h-9 rounded-full border border-border object-cover shrink-0 mt-0.5"
                      onError={e => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <div className={`w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${c.player.image_url ? 'hidden' : ''}`}>
                    {initial}
                  </div>

                  {/* Main info column */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {/* Line 1: Name + throws + tier + team · position */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-foreground truncate">{c.player.name}</span>
                      <span className={`text-[11px] font-bold ${c.pp.throws === 'L' ? 'text-accent' : 'text-primary'}`}>
                        ({c.pp.throws}HP)
                      </span>
                      <span className={`text-[10px] font-bold ${tierColor(c.pp.quality?.tier ?? 'unknown')}`}>
                        {tierLabel(c.pp.quality?.tier ?? 'unknown')}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {c.player.editorial_team_abbr} · {c.player.display_position}
                      </span>
                      {c.player.ownership_type === 'waivers' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-semibold">
                          WW
                        </span>
                      )}
                    </div>

                    {/* Line 2: Matchup context (opponent + park + weather) */}
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="text-muted-foreground">
                        {c.isHome ? 'vs' : '@'}{' '}
                        <span className="font-semibold text-foreground">{c.opponent}</span>
                      </span>
                      {oppOps !== null && (
                        <>
                          <span className="text-border">|</span>
                          <span className="text-muted-foreground">
                            Opp (vs{c.pp.throws}) <span className={oppOpsColor}>{oppOps.toFixed(3).replace(/^0\./, '.')}</span>
                            {oppKRate !== null && (oppKRate >= 0.240 || oppKRate <= 0.185) && (
                              <span className={`ml-1 ${oppKRate >= 0.240 ? 'text-success' : 'text-error'}`}>
                                {(oppKRate * 100).toFixed(1)}% K
                              </span>
                            )}
                          </span>
                        </>
                      )}
                      <span className="text-border">|</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${pfColor}`}
                        title={parkFactor !== null && parkHR !== null ? `Overall PF ${parkFactor} · HR PF ${parkHR}` : undefined}
                      >
                        {pfIsHR ? 'HR' : 'PF'} {displayPf ?? '—'}
                      </span>
                      {hasWeatherData(c.weather) && (
                        <div className="flex items-center gap-1">
                          {(() => {
                            const Wx = weatherIcon(c.weather.condition);
                            return Wx ? <Icon icon={Wx} size={12} className="text-muted-foreground" /> : null;
                          })()}
                          {c.weather.temperature != null && (
                            <span className="text-muted-foreground">{c.weather.temperature}°</span>
                          )}
                          {c.weather.windSpeed != null && c.weather.windSpeed > 0 && (
                            <span className={`flex items-center gap-0.5 ${windBad ? 'text-error' : 'text-muted-foreground'}`}>
                              <Icon icon={FiWind} size={10} />
                              {c.weather.windSpeed}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Line 3: Stat line */}
                    <div className="text-[11px] text-muted-foreground">
                      {renderPitcherStatLine(c.pp)}
                    </div>

                    {/* Line 4: Stream-for pills */}
                    {c.pills.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        {c.pills.map(pill => (
                          <span
                            key={pill.goal}
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              pill.verdict === 'strong'
                                ? 'bg-success/15 text-success'
                                : 'bg-error/15 text-error'
                            }`}
                          >
                            {pill.goal}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Expand chevron */}
                  <Icon
                    icon={FiChevronDown}
                    size={16}
                    className={`shrink-0 text-muted-foreground transition-transform mt-3 ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Score breakdown panel */}
                {isExpanded && (
                  <ScoreBreakdownPanel c={c} teamOffense={teamOffense} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PitchingManager() {
  const { teamKey, leagueKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const [tab, setTab] = useState<'today' | 'tomorrow'>('tomorrow');

  const today = todayStr();
  const tomorrow = tomorrowStr();

  // Today's data
  const { roster, isLoading: rosterLoading } = useRoster(teamKey, today);
  const { games: todayGames, isLoading: todayGamesLoading } = useGameDay(today);

  // Tomorrow's data
  const { games: tomorrowGames, isLoading: tomorrowGamesLoading } = useGameDay(tomorrow);
  const { players: freeAgents, isLoading: faLoading, isError: faError } = useAvailablePitchers(leagueKey);

  // Collect all opposing team MLB IDs from today's and tomorrow's games for team offense fetch
  const opposingTeamIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of todayGames) {
      ids.add(g.homeTeam.mlbId);
      ids.add(g.awayTeam.mlbId);
    }
    for (const g of tomorrowGames) {
      ids.add(g.homeTeam.mlbId);
      ids.add(g.awayTeam.mlbId);
    }
    return Array.from(ids);
  }, [todayGames, tomorrowGames]);

  const { teams: teamOffense, isLoading: offenseLoading } = useTeamOffense(opposingTeamIds);

  if (ctxError) {
    return (
      <div className="p-6">
        <div className="bg-surface rounded-lg shadow p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Pitching</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tab === 'today'
              ? 'Sit/start decisions for your active pitchers'
              : 'Find streamers for tomorrow\'s games'}
          </p>
        </div>

        {/* Today / Tomorrow toggle */}
        <div className="flex space-x-1 bg-secondary rounded-lg p-1">
          <button
            onClick={() => setTab('today')}
            className={`py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              tab === 'today'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setTab('tomorrow')}
            className={`py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              tab === 'tomorrow'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Tomorrow
          </button>
        </div>
      </div>

      {/* Matchup pulse — always visible */}
      <MatchupPulse leagueKey={leagueKey} teamKey={teamKey} />

      {tab === 'today' ? (
        <TodayStarters
          roster={roster}
          games={todayGames}
          isLoading={ctxLoading || rosterLoading || todayGamesLoading}
          teamOffense={teamOffense}
          offenseLoading={offenseLoading}
        />
      ) : (
        <StreamingBoard
          date={tomorrow}
          games={tomorrowGames}
          freeAgents={freeAgents}
          gamesLoading={tomorrowGamesLoading}
          faLoading={ctxLoading || faLoading}
          faError={faError}
          teamOffense={teamOffense}
          offenseLoading={offenseLoading}
        />
      )}
    </div>
  );
}
