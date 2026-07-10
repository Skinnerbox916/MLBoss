/**
 * Points-league streaming analysis — the engine behind the points view of
 * /streaming. In a points league the streaming game is pure volume: every
 * pitcher start is found points, and every starting batter slot that sits
 * empty on a light schedule day is foregone points. This module answers the
 * page's three questions over the pickup-playable window (floored at the
 * league's earliest playable date — today for immediate leagues, tomorrow for
 * next-day — and Sunday-pivoted like the categories board):
 *
 *   1. Coverage — per day, how many starting batter slots can my roster
 *      actually fill with a bat that plays? (Reuses the Phase 3 Hungarian
 *      lineup optimizer; a max-points assignment with per-player scores is
 *      also a max-coverage assignment.)
 *   2. Pitcher streams — FA/waiver arms with probable starts in the window,
 *      ranked by expected points per start (Phase 1 rate × Phase 2 volume).
 *   3. Batter plugs — FA/waiver bats ranked by the EXACT marginal points they
 *      add to each day's optimal lineup (re-solve with the bat added), so
 *      position eligibility and displacement chains are handled by the
 *      optimizer, not heuristics.
 *
 * Day/start values are matchup-adjusted via matchupAdjust (park / platoon /
 * opposing staff or offense) — these are lineup-decision scorers, distinct
 * from the talent-neutral roster-construction values in analyzeTeam.
 *
 * The analysis also ships per-player projection FACTS (batterFacts,
 * myPitcherFacts) so the client-side week-moves engine (weekMoves.ts) can
 * re-solve lineups and price add/drop moves without server round-trips —
 * the same facts/preferences boundary as the points roster page.
 *
 * WEEKLY cadence (leagues whose lineups lock for the week): the window
 * becomes the full NEXT Mon–Sun (a pickup can't play sooner), and the three
 * questions invert from "what can I still change" to "what am I about to
 * lock in": coverage = idle slot-days of the optimal week lineup (a starter
 * with no game that day is a baked-in zero); the lineup is optimized ONCE
 * over week-sum points, so schedule density is part of every bat's value;
 * batter value = one week-sum marginal re-solve instead of per-day plugs.
 * Pitcher streams are unchanged math — two-start weeks dominate naturally
 * because totalPoints sums the starts in the window.
 */

import {
  getTeamRosterByDate,
  getAvailableBatters,
  getAvailablePitchers,
  getLeagueRosterPositions,
} from '@/lib/fantasy';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import type { LineupCadence } from '@/lib/fantasy/scoringMode';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import { getGameDay } from '@/lib/mlb/schedule';
import { getObservedLineupSpots } from '@/lib/mlb/lineupSpots';
import { getPickupPlayableDays, getWeekDays, type WeekDay } from '@/lib/dashboard/weekRange';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import { normalizeTeamAbbr } from '@/lib/mlb/teamAbbr';
import { isLikelySamePlayer } from '@/lib/pitching/display';
import { resolveMatchup } from '@/lib/mlb/analysis';
import { getTeamOffense } from '@/lib/mlb/teams';
import type { EnrichedGame } from '@/lib/mlb/types';
import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import { getPointsPitcherInputs } from './pitcherInputs';
import { batterPointsValue } from './pointsValue';
import { resolveBatterVolume } from './schedule';
import { forecastPitcherPoints } from './forecast';
import {
  adjustedBatterPointsPerPA,
  adjustedPitcherStartPoints,
  meanTeamOffense,
  type AdjustedPointsRate,
} from './matchupAdjust';
import {
  optimizePointsLineup,
  buildBattingSlots,
  type PointsLineupResult,
  type RosterPositionSlot,
} from './lineupOptimizer';

/** FA pitchers with a probable start we bother scoring (talent fetch is the cost). */
const FA_PITCHER_SCORE_CAP = 40;
/** FA bats we evaluate for plug value (stats fetch + per-day re-solve). */
const FA_BATTER_EVAL_CAP = 60;
/** Rows returned per board. */
const BOARD_ROW_CAP = 25;
/** Plug-day gains below this are Hungarian rounding noise, not signal. */
const MIN_PLUG_DAY_GAIN = 0.2;
/** Bats whose week total is below this aren't worth a move slot. */
const MIN_PLUG_WEEK_GAIN = 1;

export interface PointsStreamingDay {
  date: string;
  dayLabel: string;
  dayName: string;
  /** Total starting batter slots in the league template. */
  battingSlots: number;
  /** Slots filled with a bat that plays that day. Daily: best per-day fill;
   *  weekly: how many of the locked week-lineup's starters play. */
  covered: number;
  /** battingSlots − covered. Daily: slots you can still plug; weekly: idle
   *  slot-days you're locking in. */
  open: number;
  /** Slot labels left open/idle that day (e.g. ['OF', 'Util']). */
  openPositions: string[];
  /** My rostered starters' probable starts that day. */
  myStarts: number;
  /** Expected points of my (per-day or locked-week) batting lineup that day. */
  optimalPoints: number;
}

export interface PointsStreamStart {
  date: string;
  /** Short weekday, e.g. "Thu". */
  dayLabel: string;
  /** "vs ARI" / "@ DET". */
  opp: string;
  /** Matchup-adjusted expected points for this start. */
  expectedPoints: number;
  /** Strongest game-context driver behind the adjustment, e.g. "Coors +9%". */
  hint?: string;
}

export interface PointsPitcherStreamRow {
  /** Yahoo player_key — identity for joins and plan state. */
  playerKey: string;
  name: string;
  team: string;
  positions: string[];
  percentOwned?: number;
  ownershipType: 'freeagent' | 'waivers';
  imageUrl?: string;
  pointsPerIP: number;
  starts: PointsStreamStart[];
  totalPoints: number;
}

export interface PointsPlugDay {
  date: string;
  /** Short weekday, e.g. "Thu". */
  dayLabel: string;
  gain: number;
  /** Strongest matchup driver behind that day's value, when notable. */
  hint?: string;
}

export interface PointsBatterPlugRow {
  /** Yahoo player_key — identity for joins and plan state. */
  playerKey: string;
  name: string;
  team: string;
  positions: string[];
  percentOwned?: number;
  ownershipType: 'freeagent' | 'waivers';
  imageUrl?: string;
  /** Talent-neutral points per game (context for the row). */
  perGame: number;
  /** Daily cadence: days where adding this bat increases the optimal
   *  lineup's points (gain = that day's marginal). Empty in weekly mode. */
  plugDays: PointsPlugDay[];
  /** Weekly cadence: the bat's game days next week (gain = HIS expected
   *  points that day, not a marginal — the marginal is week-level). */
  gameDays?: PointsPlugDay[];
  /** Net gain across the window: sum of plug-day marginals (daily) or the
   *  week-sum lineup marginal from one re-solve (weekly). */
  totalGain: number;
}

/** Per-player projection facts for the client-side week-moves engine
 *  (weekMoves.ts). dayPoints[i] aligns positionally to analysis.days[i];
 *  0 = idle / no value that day. */
export interface PointsBatterDayFacts {
  /** Yahoo player_key — identity for joins and plan state. */
  playerKey: string;
  name: string;
  team: string;
  /** eligible_positions — drives client-side lineup re-solves. */
  positions: string[];
  owned: boolean;
  injured: boolean;
  percentOwned?: number;
  /** FA rows only. */
  ownershipType?: 'freeagent' | 'waivers';
  imageUrl?: string;
  /** Matchup-adjusted expected points per window day. */
  dayPoints: number[];
}

/** My rostered arms with remaining probable starts priced like FA streams.
 *  RPs: starts [] and totalPoints 0 — the client prices their drop cost from
 *  the points-team relief projection instead. */
export interface PointsMyPitcherFacts {
  playerKey: string;
  name: string;
  team: string;
  positions: string[];
  imageUrl?: string;
  starts: PointsStreamStart[];
  totalPoints: number;
}

export interface PointsStreamingAnalysis {
  /** Lineup cadence the analysis was computed for (drives UI semantics). */
  cadence: LineupCadence;
  week: { start?: string; end?: string; days: number };
  days: PointsStreamingDay[];
  /** Sum of `open` across the window — total forfeited slot-days. */
  openSlotDays: number;
  /** Sum of `myStarts` across the window. */
  myStartsRemaining: number;
  pitcherStreams: PointsPitcherStreamRow[];
  batterPlugs: PointsBatterPlugRow[];
  /** Rostered bats + the FA eval pool — day-value facts for weekMoves.ts. */
  batterFacts: PointsBatterDayFacts[];
  /** Rostered (healthy) arms with priced remaining starts. */
  myPitcherFacts: PointsMyPitcherFacts[];
}

const round1 = (n: number) => Number(n.toFixed(1));
const key = (name: string, team: string) => `${name.toLowerCase()}|${team.toLowerCase()}`;

function isPitcherPos(eligible: string[], display: string): boolean {
  return [...(eligible ?? []), display].some(x => x === 'P' || x === 'SP' || x === 'RP');
}

type MatchedStart = { day: WeekDay; opp: string; game: EnrichedGame; isHome: boolean; oppMlbId: number };

/** Find a team's game + probable-pitcher match for one arm on one day. */
function findProbableStart(
  name: string,
  teamAbbr: string,
  games: EnrichedGame[],
): { opp: string; game: EnrichedGame; isHome: boolean; oppMlbId: number } | null {
  const t = normalizeTeamAbbr(teamAbbr);
  for (const g of games) {
    const isHome = normalizeTeamAbbr(g.homeTeam.abbreviation) === t;
    const isAway = normalizeTeamAbbr(g.awayTeam.abbreviation) === t;
    if (!isHome && !isAway) continue;
    const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
    if (pp && isLikelySamePlayer(name, pp.name)) {
      const oppTeam = isHome ? g.awayTeam : g.homeTeam;
      return {
        opp: `${isHome ? 'vs' : '@'} ${oppTeam.abbreviation}`,
        game: g,
        isHome,
        oppMlbId: oppTeam.mlbId,
      };
    }
  }
  return null;
}

export async function analyzePointsStreaming(
  userId: string,
  leagueKey: string,
  teamKey: string,
  profile: ScoringProfile,
  opts: { cadence?: LineupCadence; earliestPlayableDate?: string } = {},
): Promise<PointsStreamingAnalysis> {
  const cadence = opts.cadence ?? 'daily';
  // Weekly lineups lock Monday: the only week a pickup can affect is the full
  // next Mon–Sun. Daily uses the pickup-playable window floored at the
  // league's earliest playable date — today for immediate (Daily-Today)
  // leagues, tomorrow for next-day, Sunday-pivoted at week's end.
  const days = cadence === 'weekly'
    ? getWeekDays(new Date(), 'next')
    : getPickupPlayableDays(new Date(), opts.earliestPlayableDate);
  const today = new Date().toISOString().slice(0, 10);
  const rosterDate = cadence === 'weekly' ? days[0].date : today;

  const [roster, rosterPositions, faBatPool, faPitchPool, gameDayResults] = await Promise.all([
    getTeamRosterByDate(userId, teamKey, rosterDate),
    getLeagueRosterPositions(userId, leagueKey),
    getAvailableBatters(userId, leagueKey),
    getAvailablePitchers(userId, leagueKey),
    Promise.all(days.map(d => getGameDay(d.date))),
  ]);
  const gamesByDate = new Map<string, EnrichedGame[]>();
  days.forEach((d, i) => gamesByDate.set(d.date, (gameDayResults[i] ?? []) as EnrichedGame[]));

  // ---------------------------------------------------------------------
  // Coverage: my roster's optimal batting lineup per playable day.
  // ---------------------------------------------------------------------

  // Today's roster stands in for every future day. Today's Yahoo flags
  // (locked, not-in-MLB-lineup) don't apply to future days, so neutralize
  // them; injury status stays (an IL bat can't plug a future slot).
  const futureRoster: RosterEntry[] = roster.map(p => ({
    ...p,
    is_editable: true,
    starting_status: undefined,
  }));
  const rosterBatters = roster.filter(p => !isPitcher(p));
  const rosterPitchers = roster.filter(
    p => isPitcher(p) && getRowStatus(p) !== 'injured',
  );

  const faBatters = faBatPool
    .filter(p => !isPitcherPos(p.eligible_positions, p.display_position) && !p.on_disabled_list)
    .sort((a, b) => (b.percent_owned ?? 0) - (a.percent_owned ?? 0))
    .slice(0, FA_BATTER_EVAL_CAP);

  const batterStats = await getRosterSeasonStats(
    [...rosterBatters, ...faBatters].map(p => ({ name: p.name, team: p.editorial_team_abbr })),
  );
  const rosterMlbIds = rosterBatters
    .map(p => batterStats[key(p.name, p.editorial_team_abbr)]?.mlbId)
    .filter((id): id is number => typeof id === 'number' && id > 0);
  const lineupSpots = await getObservedLineupSpots(rosterMlbIds);

  // Matchup-adjusted per-PA rate (park / platoon / opposing staff via the
  // canonical L2 forecast), memoized per (player, day) — the batter-plug
  // Hungarian re-solves call the scorer O(FA pool × roster size) times.
  const adjRateMemo = new Map<string, AdjustedPointsRate | null>();
  const adjRateFor = (pl: RosterEntry, day: WeekDay): AdjustedPointsRate | null => {
    const k = `${key(pl.name, pl.editorial_team_abbr)}|${day.date}`;
    const hit = adjRateMemo.get(k);
    if (hit !== undefined) return hit;
    const stats = batterStats[key(pl.name, pl.editorial_team_abbr)];
    if (!stats) {
      adjRateMemo.set(k, null);
      return null;
    }
    const spot = lineupSpots.get(stats.mlbId) ?? null;
    const ctx = resolveMatchup(gamesByDate.get(day.date) ?? [], null, pl.editorial_team_abbr, {
      hand: stats.bats ?? null,
      battingOrder: spot,
    });
    const r = adjustedBatterPointsPerPA(stats, profile, ctx, spot);
    adjRateMemo.set(k, r);
    return r;
  };

  const dayPointsFor = (day: WeekDay) => (pl: RosterEntry): number => {
    const r = adjRateFor(pl, day);
    const stats = batterStats[key(pl.name, pl.editorial_team_abbr)];
    if (!r || !stats) return 0;
    const spot = lineupSpots.get(stats.mlbId) ?? null;
    const vol = resolveBatterVolume(pl.editorial_team_abbr, spot, gamesByDate, [day]);
    return r.pointsPerPA * vol.expectedPA;
  };

  const battingSlotDefs = buildBattingSlots(rosterPositions as RosterPositionSlot[])
    .filter(s => s.group === 'batting');
  const battingSlots = battingSlotDefs.length;

  // Slot multiset minus the filled rows' assigned positions = what's open.
  const openPositionsAfter = (filled: Array<{ toPosition: string }>): string[] => {
    const openCounts = new Map<string, number>();
    for (const s of battingSlotDefs) openCounts.set(s.position, (openCounts.get(s.position) ?? 0) + 1);
    for (const r of filled) {
      const c = openCounts.get(r.toPosition);
      if (c !== undefined && c > 0) openCounts.set(r.toPosition, c - 1);
    }
    const out: string[] = [];
    for (const [pos, c] of openCounts) for (let i = 0; i < c; i++) out.push(pos);
    return out;
  };

  // My healthy arms matched to probable starts across the window — feeds the
  // per-day start counts here and the priced myPitcherFacts below.
  const myArmMatches = rosterPitchers.map(arm => ({
    arm,
    starts: days.flatMap((day): MatchedStart[] => {
      const hit = findProbableStart(arm.name, arm.editorial_team_abbr, gamesByDate.get(day.date) ?? []);
      return hit ? [{ day, ...hit }] : [];
    }),
  }));
  const myStartsByDate = new Map<string, number>();
  for (const m of myArmMatches) {
    for (const s of m.starts) {
      myStartsByDate.set(s.day.date, (myStartsByDate.get(s.day.date) ?? 0) + 1);
    }
  }

  // Week-sum scorer (weekly cadence): a bat's value for the locked week is
  // the sum of his matchup-adjusted day values — schedule density AND the
  // series contexts (a 3-game Coors set) are part of the player.
  const weekPointsFor = (pl: RosterEntry): number => {
    let sum = 0;
    for (const day of days) sum += dayPointsFor(day)(pl);
    return sum;
  };

  const rosterByKey = new Map(futureRoster.map(p => [key(p.name, p.editorial_team_abbr), p]));

  // Per-day coverage + the base lineup(s) the batter marginals compare against.
  let summaries: PointsStreamingDay[];
  let dayAnalyses: Array<{ day: WeekDay; base: PointsLineupResult }> = [];
  let baseWeek: PointsLineupResult | null = null;

  if (cadence === 'weekly') {
    // One solve for the whole locked week, then read each day off it.
    baseWeek = optimizePointsLineup(futureRoster, rosterPositions as RosterPositionSlot[], weekPointsFor);
    const startedRows = baseWeek.lineup.filter(r => r.started && r.dayPoints > 0);
    summaries = days.map(day => {
      const playing = startedRows.filter(r => {
        const entry = rosterByKey.get(key(r.name, r.team));
        return entry ? dayPointsFor(day)(entry) > 0 : false;
      });
      const optimalPoints = playing.reduce((s, r) => {
        const entry = rosterByKey.get(key(r.name, r.team));
        return s + (entry ? dayPointsFor(day)(entry) : 0);
      }, 0);
      return {
        date: day.date,
        dayLabel: day.dayLabel,
        dayName: day.dayName,
        battingSlots,
        covered: playing.length,
        open: battingSlots - playing.length,
        openPositions: openPositionsAfter(playing),
        myStarts: myStartsByDate.get(day.date) ?? 0,
        optimalPoints: round1(optimalPoints),
      } satisfies PointsStreamingDay;
    });
  } else {
    dayAnalyses = days.map(day => ({
      day,
      base: optimizePointsLineup(futureRoster, rosterPositions as RosterPositionSlot[], dayPointsFor(day)),
    }));
    summaries = dayAnalyses.map(({ day, base }) => {
      const coveredRows = base.lineup.filter(r => r.started && r.dayPoints > 0);
      return {
        date: day.date,
        dayLabel: day.dayLabel,
        dayName: day.dayName,
        battingSlots,
        covered: coveredRows.length,
        open: battingSlots - coveredRows.length,
        openPositions: openPositionsAfter(coveredRows),
        myStarts: myStartsByDate.get(day.date) ?? 0,
        optimalPoints: base.optimalPoints,
      } satisfies PointsStreamingDay;
    });
  }

  // ---------------------------------------------------------------------
  // Pitcher streams: FA arms with probable starts in the window.
  // ---------------------------------------------------------------------

  const faPitchers = faPitchPool.filter(p =>
    isPitcherPos(p.eligible_positions, p.display_position),
  );
  type Matched = { fa: FreeAgentPlayer; starts: MatchedStart[] };
  const matched: Matched[] = [];
  for (const fa of faPitchers) {
    const starts: MatchedStart[] = [];
    for (const day of days) {
      const hit = findProbableStart(fa.name, fa.editorial_team_abbr, gamesByDate.get(day.date) ?? []);
      if (hit) starts.push({ day, ...hit });
    }
    if (starts.length > 0) matched.push({ fa, starts });
  }
  matched.sort(
    (a, b) =>
      b.starts.length - a.starts.length ||
      (b.fa.percent_owned ?? 0) - (a.fa.percent_owned ?? 0),
  );
  const toScore = matched.slice(0, FA_PITCHER_SCORE_CAP);

  // Talent inputs for FA arms with starts AND my own starting arms — the
  // latter feed myPitcherFacts so the client can price them as drop costs.
  const startingArms = myArmMatches.filter(m => m.starts.length > 0);
  const pitcherInputs = await getPointsPitcherInputs([
    ...toScore.map(m => ({ name: m.fa.name, team: m.fa.editorial_team_abbr })),
    ...startingArms.map(m => ({ name: m.arm.name, team: m.arm.editorial_team_abbr })),
  ]);

  // Opposing-offense context for matchup-adjusted per-start points. One
  // fetch per distinct opposing team (1h-cached upstream); null entries fall
  // back to a neutral-offense forecast inside the adjuster.
  const oppIds = [...new Set([
    ...toScore.flatMap(m => m.starts.map(s => s.oppMlbId)),
    ...startingArms.flatMap(m => m.starts.map(s => s.oppMlbId)),
  ])];
  const offenseByTeam = new Map(
    await Promise.all(oppIds.map(async id => [id, await getTeamOffense(id)] as const)),
  );
  // Empirical league-average opponent — the anchor the per-start matchup
  // ratio is measured against (see matchupAdjust.meanTeamOffense). My own
  // arms' opponents joining this set nudges the anchor, so FA stream totals
  // can drift a rounding digit vs the pre-facts payload.
  const slateMeanOffense = meanTeamOffense([...offenseByTeam.values()]);

  // Price one arm's matched probable starts: neutral per-start baseline
  // (rate × ipPerStart) for pts/IP context and fallback, then a per-start
  // matchup adjustment. A probable start is authoritative — score
  // relievers-by-history and ghosts (call-ups) as starters too; the talent
  // model regresses them.
  const priceArmStarts = (
    name: string,
    team: string,
    matchedStarts: MatchedStart[],
  ): { pointsPerIP: number; starts: PointsStreamStart[]; totalPoints: number } | null => {
    const input = pitcherInputs[key(name, team)];
    if (!input) return null;
    const startInput = input.role === 'starter' ? input : { ...input, role: 'starter' as const };
    const perStart = forecastPitcherPoints(
      startInput,
      profile,
      { starts: 1, expectedIP: input.talent.ipPerStart },
      { appearances: 0, expectedIP: 0 },
    );
    const starts = matchedStarts.map(({ day, opp, game, isHome, oppMlbId }) => {
      let pts = perStart.expectedPoints;
      let hint: string | undefined;
      try {
        const adj = adjustedPitcherStartPoints(startInput, profile, game, isHome, offenseByTeam.get(oppMlbId) ?? null, slateMeanOffense);
        pts = adj.points;
        hint = adj.hint || undefined;
      } catch {
        // Degenerate talent inputs — keep the neutral per-start estimate.
      }
      return { date: day.date, dayLabel: day.dayName, opp, expectedPoints: round1(pts), hint };
    });
    return {
      pointsPerIP: Number(perStart.pointsPerIP.toFixed(2)),
      starts,
      totalPoints: round1(starts.reduce((s, x) => s + x.expectedPoints, 0)),
    };
  };

  const pitcherStreams: PointsPitcherStreamRow[] = toScore
    .map((m): PointsPitcherStreamRow | null => {
      const priced = priceArmStarts(m.fa.name, m.fa.editorial_team_abbr, m.starts);
      if (!priced) return null;
      return {
        playerKey: m.fa.player_key,
        name: m.fa.name,
        team: m.fa.editorial_team_abbr,
        positions: m.fa.eligible_positions,
        percentOwned: m.fa.percent_owned,
        ownershipType: m.fa.ownership_type,
        imageUrl: m.fa.image_url,
        pointsPerIP: priced.pointsPerIP,
        starts: priced.starts,
        totalPoints: priced.totalPoints,
      };
    })
    .filter((x): x is PointsPitcherStreamRow => x !== null)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, BOARD_ROW_CAP);

  // Rostered arms priced the same way — drop costs for the client-side
  // week-moves engine and start markers for the week plan card. RPs (no
  // probables) carry zero; the client falls back to the points-team relief
  // projection for their drop cost.
  const myPitcherFacts: PointsMyPitcherFacts[] = myArmMatches.map(({ arm, starts }) => {
    const priced = starts.length > 0
      ? priceArmStarts(arm.name, arm.editorial_team_abbr, starts)
      : null;
    return {
      playerKey: arm.player_key,
      name: arm.name,
      team: arm.editorial_team_abbr,
      positions: arm.eligible_positions,
      imageUrl: arm.image_url,
      starts: priced?.starts ?? [],
      totalPoints: priced?.totalPoints ?? 0,
    };
  });

  // ---------------------------------------------------------------------
  // Batter plugs: exact marginal lineup gain per FA per day.
  // ---------------------------------------------------------------------

  // A minimal RosterEntry stand-in so an FA can enter lineup solves and the
  // day scorer (same pattern the client-side weekMoves engine replicates).
  const syntheticFA = (fa: FreeAgentPlayer): RosterEntry => ({
    player_key: `fa:${fa.player_key}`,
    player_id: fa.player_id,
    name: fa.name,
    editorial_team_abbr: fa.editorial_team_abbr,
    display_position: fa.display_position,
    eligible_positions: fa.eligible_positions,
    selected_position: 'BN',
    on_disabled_list: false,
    is_editable: true,
    batting_order: null,
  });

  const batterPlugs: PointsBatterPlugRow[] = faBatters
    .map((fa): PointsBatterPlugRow | null => {
      const stats = batterStats[key(fa.name, fa.editorial_team_abbr)];
      if (!stats) return null;
      const synthetic = syntheticFA(fa);

      const common = {
        playerKey: fa.player_key,
        name: fa.name,
        team: fa.editorial_team_abbr,
        positions: fa.eligible_positions,
        percentOwned: fa.percent_owned,
        ownershipType: fa.ownership_type,
        imageUrl: fa.image_url,
        perGame: Number(batterPointsValue(stats, profile).pointsPerGame.toFixed(1)),
      };

      if (cadence === 'weekly' && baseWeek) {
        // One week-sum re-solve: the bat's net value for the locked week,
        // displacement and eligibility included.
        if (weekPointsFor(synthetic) <= 0) return null;
        const withFA = optimizePointsLineup(
          [...futureRoster, synthetic],
          rosterPositions as RosterPositionSlot[],
          weekPointsFor,
        );
        const totalGain = round1(withFA.optimalPoints - baseWeek.optimalPoints);
        if (totalGain < MIN_PLUG_WEEK_GAIN) return null;
        const gameDays: PointsPlugDay[] = [];
        for (const day of days) {
          const pts = dayPointsFor(day)(synthetic);
          if (pts <= 0) continue;
          const r = adjRateFor(synthetic, day);
          const hint = r && Math.abs(r.multiplier - 1) >= 0.03 && r.hint ? r.hint : undefined;
          gameDays.push({ date: day.date, dayLabel: day.dayName, gain: round1(pts), hint });
        }
        return { ...common, plugDays: [], gameDays, totalGain };
      }

      const plugDays: PointsPlugDay[] = [];
      for (const { day, base } of dayAnalyses) {
        // Re-solve only when the FA actually plays that day.
        if (dayPointsFor(day)(synthetic) <= 0) continue;
        const withFA = optimizePointsLineup(
          [...futureRoster, synthetic],
          rosterPositions as RosterPositionSlot[],
          dayPointsFor(day),
        );
        const gain = round1(withFA.optimalPoints - base.optimalPoints);
        if (gain >= MIN_PLUG_DAY_GAIN) {
          const r = adjRateFor(synthetic, day);
          const hint = r && Math.abs(r.multiplier - 1) >= 0.03 && r.hint ? r.hint : undefined;
          plugDays.push({ date: day.date, dayLabel: day.dayName, gain, hint });
        }
      }
      const totalGain = round1(plugDays.reduce((s, d) => s + d.gain, 0));
      if (totalGain < MIN_PLUG_WEEK_GAIN) return null;

      return { ...common, plugDays, totalGain };
    })
    .filter((x): x is PointsBatterPlugRow => x !== null)
    .sort((a, b) => b.totalGain - a.totalGain)
    .slice(0, BOARD_ROW_CAP);

  // ---------------------------------------------------------------------
  // Per-player day-value facts for the client-side week-moves engine:
  // every rostered bat plus the FA eval pool, read off the same memoized
  // scorer the solves above already warmed.
  // ---------------------------------------------------------------------

  const batterFacts: PointsBatterDayFacts[] = [
    ...rosterBatters
      .filter(p => batterStats[key(p.name, p.editorial_team_abbr)])
      .map(p => ({
        playerKey: p.player_key,
        name: p.name,
        team: p.editorial_team_abbr,
        positions: p.eligible_positions,
        owned: true,
        injured: getRowStatus(p) === 'injured',
        percentOwned: p.percent_owned,
        imageUrl: p.image_url,
        dayPoints: days.map(day => round1(dayPointsFor(day)(p))),
      })),
    ...faBatters
      .filter(fa => batterStats[key(fa.name, fa.editorial_team_abbr)])
      .map(fa => {
        const synthetic = syntheticFA(fa);
        return {
          playerKey: fa.player_key,
          name: fa.name,
          team: fa.editorial_team_abbr,
          positions: fa.eligible_positions,
          owned: false,
          injured: false,
          percentOwned: fa.percent_owned,
          ownershipType: fa.ownership_type,
          imageUrl: fa.image_url,
          dayPoints: days.map(day => round1(dayPointsFor(day)(synthetic))),
        };
      }),
  ];

  return {
    cadence,
    week: { start: days[0]?.date, end: days[days.length - 1]?.date, days: days.length },
    days: summaries,
    openSlotDays: summaries.reduce((s, d) => s + d.open, 0),
    myStartsRemaining: summaries.reduce((s, d) => s + d.myStarts, 0),
    pitcherStreams,
    batterPlugs,
    batterFacts,
    myPitcherFacts,
  };
}
