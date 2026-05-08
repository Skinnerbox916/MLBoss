/**
 * Day-by-day slot-aware streaming value.
 *
 * The team-projection engine answers "what should my team total be?"; the
 * FA week aggregator answers "what's each FA's week-long talent shape?".
 * Neither answers the streaming-decision question: "given my rostered bats
 * and their per-day game schedules, how many starter-points does this FA
 * actually add to my week?"
 *
 * On a heavy day where 9 of my batters all play, an FA in my line-up means
 * benching one of mine — his contribution is the upgrade margin over my
 * worst current starter that day, or zero if he can't beat any of them.
 * On a light day where only 4 of mine have games, 5 starting slots sit
 * open and any FA fills one for free at full daily score. Multi-position
 * eligibility is honoured automatically because `assignStarters` already
 * handles it via backtracking.
 *
 * Mechanism: per remaining day, run `assignStarters` once on my active
 * roster (baseline) and once per FA-with-game (with-FA), take the delta,
 * and sum across days. The streaming value is the resulting total. Per-
 * day breakdowns are returned alongside so the UI can show "starts at 2B"
 * vs "benched" cells.
 */

import {
  assignStarters,
  type BatterPosition,
  type ScoredPlayer,
  type StartingSlots,
} from '@/lib/roster/depth';
import type { WeekDay } from '@/lib/dashboard/weekRange';

export interface SlotAwarePerDay {
  date: string;
  dayLabel: string;
  /** Starter-score delta: 0 when the FA had no game OR couldn't displace anyone. */
  delta: number;
  /** The slot the FA was assigned to in the with-FA optimal lineup, or
   *  null when they were left on the bench. */
  assignedSlot: BatterPosition | 'UTIL' | null;
  /** True when the FA had a game scheduled this day. False = off-day —
   *  visually distinct from "had a game but benched". */
  hasGame: boolean;
}

export interface FAStreamingValue {
  streamingValue: number;
  perDay: SlotAwarePerDay[];
}

export interface DailyBaseline {
  date: string;
  dayLabel: string;
  /** How many of my active batters had a game this day. */
  activeBatterCount: number;
  /** Total batter starting slots in the league. */
  rosterStartersTotal: number;
  /** How many positional + UTIL slots my baseline assignment filled. */
  rosterStartersFilled: number;
  /** Weakest baseline starter (lowest score), if any. Drives the
   *  GamePlanPanel "weakest starter" footer. */
  weakestStarter?: { position: BatterPosition | 'UTIL'; score: number; name: string };
  /** Sum of starter scores in the baseline. Useful for debug/inspection. */
  baselineTotal: number;
}

export interface SlotAwareInput {
  /** Days to project, typically remaining days in the matchup week. */
  days: WeekDay[];
  /** My active rostered batters. Each entry must include eligible
   *  positions — caller filters out pitchers / IL. */
  myRoster: Array<{
    player_key: string;
    name: string;
    eligibleBatterPositions: BatterPosition[];
    /** Map<date, score> for this player. Days with no game are absent
     *  or have score 0. */
    perDayScore: Map<string, number>;
  }>;
  /** FAs to evaluate. Same shape as myRoster — eligible positions must
   *  be pre-computed by the caller. */
  faPool: Array<{
    player_key: string;
    name: string;
    eligibleBatterPositions: BatterPosition[];
    perDayScore: Map<string, number>;
  }>;
  /** League batter slots. */
  slots: StartingSlots;
}

export interface SlotAwareResult {
  /** Per-FA streaming value + per-day breakdown. */
  byPlayerKey: Map<string, FAStreamingValue>;
  /** Per-day baseline metadata for the GamePlanPanel "light days" footer. */
  dailyBaselines: DailyBaseline[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ScoredEntry {
  scored: ScoredPlayer;
  hasGame: boolean;
}

function buildDailyRoster(
  myRoster: SlotAwareInput['myRoster'],
  date: string,
): ScoredPlayer[] {
  const list: ScoredPlayer[] = [];
  for (const p of myRoster) {
    const score = p.perDayScore.get(date);
    if (score === undefined || score <= 0) continue;
    list.push({
      player_key: p.player_key,
      name: p.name,
      eligibleBatterPositions: p.eligibleBatterPositions,
      score,
      // `raw` is unused by assignStarters; pass a minimal shape that
      // satisfies the type. The caller never reads it back from us.
      raw: { player_key: p.player_key } as ScoredPlayer['raw'],
    });
  }
  return list;
}

function buildFAEntry(
  fa: SlotAwareInput['faPool'][number],
  date: string,
): ScoredEntry | null {
  const score = fa.perDayScore.get(date);
  if (score === undefined) return { scored: emptyScored(fa), hasGame: false };
  if (score <= 0) return { scored: emptyScored(fa), hasGame: false };
  return {
    scored: {
      player_key: fa.player_key,
      name: fa.name,
      eligibleBatterPositions: fa.eligibleBatterPositions,
      score,
      raw: { player_key: fa.player_key } as ScoredPlayer['raw'],
    },
    hasGame: true,
  };
}

function emptyScored(fa: SlotAwareInput['faPool'][number]): ScoredPlayer {
  return {
    player_key: fa.player_key,
    name: fa.name,
    eligibleBatterPositions: fa.eligibleBatterPositions,
    score: 0,
    raw: { player_key: fa.player_key } as ScoredPlayer['raw'],
  };
}

/** Total positional + UTIL slot count from a `StartingSlots`. */
function totalStartingSlots(slots: StartingSlots): number {
  let n = 0;
  for (const v of slots.byPosition.values()) n += v;
  return n + slots.utilSlots;
}

/** Find the lowest-scoring starter in an assignment result. Returns
 *  undefined if no positional / UTIL starter was assigned. */
function findWeakestStarter(
  baselineRoster: ScoredPlayer[],
  slots: StartingSlots,
): DailyBaseline['weakestStarter'] {
  const result = assignStarters(baselineRoster, slots);
  let weakest: { position: BatterPosition | 'UTIL'; score: number; name: string } | undefined;
  for (const [pos, list] of result.startersByPosition) {
    for (const p of list) {
      if (!weakest || p.score < weakest.score) {
        weakest = { position: pos, score: p.score, name: p.name };
      }
    }
  }
  for (const p of result.utilStarters) {
    if (!weakest || p.score < weakest.score) {
      weakest = { position: 'UTIL', score: p.score, name: p.name };
    }
  }
  return weakest;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute slot-aware streaming value for every FA across the supplied days.
 *
 * Pure function. Caller is responsible for:
 *   - Filtering `myRoster` to active batters (no pitchers, no IL/IL+/NA)
 *   - Pre-computing eligible-batter-positions for each player
 *   - Pre-computing per-day scores for each player (0 / missing on off-days)
 *   - Filtering the FA pool to a reasonable candidate set (ownership floor,
 *     IL exclusions, etc.)
 *
 * Returns per-FA streaming value plus per-day baseline metadata for the
 * strategy summary.
 */
export function computeSlotAwareStreaming(input: SlotAwareInput): SlotAwareResult {
  const { days, myRoster, faPool, slots } = input;

  const dailyBaselines: DailyBaseline[] = [];
  // Cache the daily baseline rosters + totals so the per-FA loop reuses them.
  const baselineByDate = new Map<string, { roster: ScoredPlayer[]; total: number }>();

  const totalSlots = totalStartingSlots(slots);

  for (const day of days) {
    const baselineRoster = buildDailyRoster(myRoster, day.date);
    const baselineResult = assignStarters(baselineRoster, slots);
    const baselineTotal = baselineResult.totalStarterScore;
    baselineByDate.set(day.date, { roster: baselineRoster, total: baselineTotal });

    // Count how many slots the baseline filled (positional + UTIL).
    let filled = 0;
    for (const list of baselineResult.startersByPosition.values()) filled += list.length;
    filled += baselineResult.utilStarters.length;

    dailyBaselines.push({
      date: day.date,
      dayLabel: day.dayLabel,
      activeBatterCount: baselineRoster.length,
      rosterStartersTotal: totalSlots,
      rosterStartersFilled: filled,
      baselineTotal,
      weakestStarter: findWeakestStarter(baselineRoster, slots),
    });
  }

  const byPlayerKey = new Map<string, FAStreamingValue>();

  for (const fa of faPool) {
    const perDay: SlotAwarePerDay[] = [];
    let total = 0;

    for (const day of days) {
      const baseline = baselineByDate.get(day.date)!;
      const faEntry = buildFAEntry(fa, day.date);
      if (!faEntry || !faEntry.hasGame) {
        perDay.push({
          date: day.date,
          dayLabel: day.dayLabel,
          delta: 0,
          assignedSlot: null,
          hasGame: false,
        });
        continue;
      }

      const withFA = assignStarters([...baseline.roster, faEntry.scored], slots);
      const delta = withFA.totalStarterScore - baseline.total;

      // Look up where the FA was actually assigned.
      let assignedSlot: BatterPosition | 'UTIL' | null = null;
      for (const [pos, list] of withFA.startersByPosition) {
        if (list.some(p => p.player_key === fa.player_key)) {
          assignedSlot = pos;
          break;
        }
      }
      if (!assignedSlot) {
        if (withFA.utilStarters.some(p => p.player_key === fa.player_key)) {
          assignedSlot = 'UTIL';
        }
      }

      perDay.push({
        date: day.date,
        dayLabel: day.dayLabel,
        // Floor at zero — assignStarters' optimum is monotonic in the
        // candidate pool (adding a player can never reduce the total),
        // so a negative delta would only come from numerical drift.
        delta: Math.max(0, delta),
        assignedSlot,
        hasGame: true,
      });
      total += Math.max(0, delta);
    }

    byPlayerKey.set(fa.player_key, { streamingValue: total, perDay });
  }

  return { byPlayerKey, dailyBaselines };
}
