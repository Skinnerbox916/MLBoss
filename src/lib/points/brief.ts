/**
 * Points Boss Brief — one tactical line for the points matchup marquee,
 * the points twin of `lib/dashboard/bossBrief.ts` (categories, L7).
 * Rules-driven v1; same output shape (`text` + optional CTA) so the
 * marquee renders it through the shared `BossBrief` component.
 *
 * All thresholds are normalized against the projected remaining volume
 * (points scales vary league to league — a 10-pt lead means nothing at
 * 4000 pts/week and everything at 300).
 */

export interface PointsBriefInput {
  /** Live matchup totals from the scoreboard. */
  myLive: number;
  oppLive: number;
  /** Projected remaining points (rest of the matchup week). */
  myRemaining: number;
  oppRemaining: number;
  remainingDays: number;
  /** Points left on the bench today (optimal-lineup delta). */
  lineupDelta: number;
}

export interface PointsBriefOutput {
  text: string;
  cta?: { phrase: string; href: string };
}

/** Magnitude formatter — every caller phrases the sign in words ("up",
 *  "down", "short by"), so the number itself is always unsigned. */
const fmt = (n: number) => {
  const abs = Math.abs(n);
  return abs >= 100 ? Math.round(abs).toString() : abs.toFixed(1).replace(/\.0$/, '');
};

export function getPointsBrief(i: PointsBriefInput): PointsBriefOutput | null {
  const live = i.myLive - i.oppLive;
  const projectedFinal = live + (i.myRemaining - i.oppRemaining);
  // "Close" = within 6% of the combined remaining volume — the band where
  // ordinary variance (one bad start, one hot night) flips the result.
  const closeBand = Math.max(10, 0.06 * (i.myRemaining + i.oppRemaining));

  const lineupCta = i.lineupDelta > 0.5
    ? { phrase: `+${fmt(i.lineupDelta)} pts in lineup moves →`, href: '/lineup' }
    : undefined;

  if (i.remainingDays <= 0) {
    return {
      text: live >= 0
        ? `Week's in the books — up ${fmt(live)}.`
        : `Week's done — short by ${fmt(live)}. Reset for next week's matchup.`,
      cta: { phrase: 'Plan next week →', href: '/streaming' },
    };
  }

  if (projectedFinal > closeBand) {
    return {
      text: live < 0
        ? `Down ${fmt(live)} now, but your remaining schedule projects you ahead by ~${fmt(projectedFinal)}. Hold the line.`
        : `Cruising — projected to win by ~${fmt(projectedFinal)}.`,
      cta: lineupCta,
    };
  }

  if (projectedFinal < -closeBand) {
    return {
      text: `Projected short by ~${fmt(projectedFinal)} with ${i.remainingDays} day${i.remainingDays === 1 ? '' : 's'} left — volume is the lever.`,
      cta: { phrase: 'Find starts →', href: '/streaming' },
    };
  }

  return {
    text: `Coin-flip week — projected within ${fmt(closeBand)}. Every start matters.`,
    cta: lineupCta ?? { phrase: 'Find starts →', href: '/streaming' },
  };
}
