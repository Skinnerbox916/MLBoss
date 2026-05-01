import type { AnalyzedMatchupRow, MatchupAnalysis } from '@/lib/matchup/analysis';
import type { LeagueLimits } from '@/lib/fantasy/limits';
import type { DayProbables } from '@/lib/hooks/useWeekProbables';

export interface BossBriefInput {
  /**
   * Decorated matchup analysis from `analyzeMatchup`. The single source of
   * truth for "which cats matter and by how much." Boss Brief never picks
   * categories with its own logic — it consumes the priorities the analysis
   * engine already computed so its narrative agrees with the focus bar and
   * the rail highlight.
   */
  analysis: MatchupAnalysis;
  myStarts: DayProbables[];
  oppStarts: DayProbables[];
  myRemaining: number;
  oppRemaining: number;
  limits?: LeagueLimits;
  myUsedIp?: string;
  myUsedGs?: string;
}

export interface BossBriefOutput {
  /** The full sentence shown to the user. */
  text: string;
  /** Optional CTA — when present, the trailing fragment is wrapped in a link. */
  cta?: { phrase: string; href: string };
}

const SPIKE_THRESHOLD = 3;

/**
 * Top winning categories — sorted by `|margin|` desc so the most-locked
 * wins surface first ("cruising in HR & TB"). Filters to live data only.
 */
function pickLockedWins(rows: AnalyzedMatchupRow[], n = 2): AnalyzedMatchupRow[] {
  return rows
    .filter(r => r.hasData && r.winning === true)
    .sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))
    .slice(0, n);
}

/**
 * Top losing categories — sorted by `priority` desc so the closest losses
 * (most worth chasing) come first. This mirrors the rail's highlight pick
 * and the focus bar's `chase` defaults so all three surfaces agree.
 */
function pickContestedLosses(rows: AnalyzedMatchupRow[], n = 2): AnalyzedMatchupRow[] {
  return rows
    .filter(r => r.hasData && r.winning === false)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, n);
}

function joinLabels(rows: AnalyzedMatchupRow[]): string {
  const labels = rows.map(r => r.label);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return labels.slice(0, -1).join(', ') + ', & ' + labels[labels.length - 1];
}

/**
 * Generate a one-line tactical brief for the matchup.
 *
 * v1 is rule-based and pure — same signature works for an LLM swap later.
 * Picks the strongest signal from the available context in priority order:
 *
 *   1. Opponent has a multi-probable spike day (3+ SP) → defend ratios.
 *   2. You're approaching an IP / GS cap with starts left → be selective.
 *   3. Bleeding ratios with starts left → stream a safe arm.
 *   4. Strong winning + reachable losing cats → push the lineup.
 *   5. Tied / close → tip on the most contested losses.
 *   6. Holding the line / generic fallback.
 *
 * Category picking (`cruising in X` / `chase Y`) always reads from the
 * `MatchupAnalysis` row priorities. Boss Brief does NOT roll its own
 * scoring — that fragmentation produced the SB chase / neutral disagreement
 * that motivated the consolidation. See `docs/recommendation-system.md`.
 *
 * Returns `null` only when there is genuinely nothing to say (no matchup
 * yet, all data missing). Callers should hide the slot when null.
 */
export function getBossBrief(input: BossBriefInput): BossBriefOutput | null {
  const allRows = input.analysis.rows;
  if (allRows.length === 0) return null;

  // ---- 1. Opponent weekend pitcher spike --------------------------------
  const oppSpikes = input.oppStarts
    .filter(d => d.day.isRemaining && d.starts.length >= SPIKE_THRESHOLD)
    .sort((a, b) => b.starts.length - a.starts.length);

  if (oppSpikes.length > 0) {
    const spike = oppSpikes[0];
    return {
      text: `${spike.day.dayName} alert — ${spike.starts.length} probable starts for the opponent. Stack a counter or defend ratios.`,
      cta: { phrase: 'Plan your streamers →', href: '/streaming' },
    };
  }

  // ---- 2. Cap pressure --------------------------------------------------
  if (input.limits) {
    const ipCap = input.limits.maxInningsPitched;
    const gsCap = input.limits.maxGamesStarted;
    const ipUsed = input.myUsedIp ? parseFloat(input.myUsedIp) : NaN;
    const gsUsed = input.myUsedGs ? parseFloat(input.myUsedGs) : NaN;

    if (gsCap && Number.isFinite(gsUsed)) {
      const gsLeft = Math.max(0, gsCap - gsUsed);
      if (gsLeft <= 1 && input.myRemaining > 0) {
        return {
          text: `You're capped at GS — ${gsLeft} start${gsLeft === 1 ? '' : 's'} left and ${input.myRemaining} probable${input.myRemaining === 1 ? '' : 's'} on deck. Pick the matchups carefully.`,
          cta: { phrase: 'Set your lineup →', href: '/lineup' },
        };
      }
    }
    if (ipCap && Number.isFinite(ipUsed)) {
      const ipLeft = Math.max(0, ipCap - ipUsed);
      if (ipLeft / ipCap <= 0.15) {
        return {
          text: `Innings cap is tight — only ${ipLeft.toFixed(1)} IP left. Squeeze every out you can from your starters.`,
          cta: { phrase: 'Review today →', href: '/lineup' },
        };
      }
    }
  }

  // ---- 3. Bleeding ratios with starts left → stream ---------------------
  // ERA / WHIP are domain-special: a bad ratio with innings still being
  // logged is a structural problem, not just "you're losing this cat." Keep
  // the dedicated rule even though it bypasses the priority sort.
  const pitchingRows = allRows.filter(r => r.isPitcherStat);
  const battingRows = allRows.filter(r => r.isBatterStat);
  const lockedWinsBat = pickLockedWins(battingRows, 2);
  const lockedWinsPit = pickLockedWins(pitchingRows, 2);
  const losingPit = pitchingRows.filter(r => r.hasData && r.winning === false);

  const bleedingRatios = losingPit.filter(r => r.name === 'ERA' || r.name === 'WHIP');
  if (bleedingRatios.length > 0 && input.myRemaining > 0) {
    const winners = lockedWinsBat.length > 0 ? lockedWinsBat : lockedWinsPit;
    const winLine = winners.length > 0 ? `Big edge in ${joinLabels(winners)} — ` : '';
    return {
      text: `${winLine}but ${joinLabels(bleedingRatios)} ${bleedingRatios.length === 1 ? 'is' : 'are'} bleeding. Stream a safe arm.`,
      cta: { phrase: 'Find a streamer →', href: '/streaming' },
    };
  }

  // ---- 4. Strong winning + reachable losing → push the lineup ----------
  // Replaces the old hardcoded "if losing HR/SB/R/RBI" rule with a
  // priority-driven pick. Suggestion only fires when the analysis engine
  // identifies at least one losing cat as `chase` (most contested);
  // otherwise the focus bar would already be telling the user to ignore
  // every losing cat and we shouldn't contradict it.
  const chaseTargets = pickContestedLosses(battingRows, 1).filter(r => r.suggestedFocus === 'chase');
  if (lockedWinsBat.length >= 2 && chaseTargets.length > 0) {
    return {
      text: `Cruising in ${joinLabels(lockedWinsBat)}. Chase ${joinLabels(chaseTargets)} — every AB matters.`,
      cta: { phrase: 'Open today →', href: '/lineup' },
    };
  }

  // ---- 5. Tied / close --------------------------------------------------
  const live = allRows.filter(r => r.hasData);
  const wins = live.filter(r => r.winning === true).length;
  const losses = live.filter(r => r.winning === false).length;

  if (Math.abs(wins - losses) <= 1) {
    const flips = pickContestedLosses(allRows, 2);
    if (flips.length > 0) {
      return {
        text: `Coin-flip week — ${joinLabels(flips)} ${flips.length === 1 ? 'is' : 'are'} within reach. Squeeze every plate appearance.`,
        cta: { phrase: 'Open today →', href: '/lineup' },
      };
    }
  }

  // ---- 6. Holding / generic fallback -----------------------------------
  if (lockedWinsBat.length + lockedWinsPit.length > 0) {
    const top = [...lockedWinsBat, ...lockedWinsPit].slice(0, 2);
    return {
      text: `Holding the line in ${joinLabels(top)}. Don't let the bench cost you tomorrow's points.`,
      cta: { phrase: 'Plan ahead →', href: '/streaming' },
    };
  }

  return {
    text: 'Tough start to the week — pivot on tomorrow\'s probables and hunt waivers for upside.',
    cta: { phrase: 'Find a streamer →', href: '/streaming' },
  };
}
