/**
 * Points week-moves engine — the CLIENT-side unified moves board for the
 * points /streaming page (docs/points-leagues.md#week-moves).
 *
 * One ranked list of net-positive roster moves for the remainder of the
 * window: batters and pitchers on the same board, each move priced as the
 * joint expected-points delta of "add X, drop Y" against the current
 * roster's optimal lineups. Facts/preferences boundary, same as
 * rosterStrategy.ts: the server (`analyzePointsStreaming`) ships per-player
 * day values and priced starts; this module re-solves lineups over those
 * facts, so the session plan can conditionally re-price every remaining
 * move with zero refetch.
 *
 * Drop suggestions come ONLY from the churn pool — rostered players whose
 * rest-of-season VOR (points-team facts) sits near replacement. Week value
 * decides the cost of dropping a churn player; VOR decides who is churn at
 * all. A hot streamer with starts left prices as expensive; a star is never
 * volunteered. Players missing a VOR or facts row are never drop candidates.
 *
 * Deliberate simplifications (see doc section for rationale):
 *   - P-slot capacity is unmodeled — an arm's add value is his priced
 *     starts, gated only by roster cap space.
 *   - RP drop cost falls back to the points-team relief projection
 *     (`thisWeekPoints`); SPs use their priced remaining starts, never both.
 *   - The session plan is state passed in by the page — nothing persists.
 */

import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import { isPitcher } from '@/components/lineup/types';
import { computeOpenSlotCount, computeCapOpenCount } from '@/lib/roster/openSlots';
import {
  optimizePointsLineup,
  type RosterPositionSlot,
} from './lineupOptimizer';
import type { LineupCadence } from '@/lib/fantasy/scoringMode';
import type {
  PointsStreamingDay,
  PointsBatterDayFacts,
  PointsMyPitcherFacts,
  PointsPitcherStreamRow,
} from './streaming';
import type { PointsPlayerRow } from './analyzeTeam';

// Calibration — see docs/points-leagues.md#week-moves
/** Rostered players at/below this VOR (pts/wk over replacement) are churn. */
const CHURN_VOR_MAX = 2;
/** Churn players considered as drops, lowest VOR first. */
const CHURN_POOL_CAP = 6;
/** FA bats entering joint re-solves, by solo marginal. */
const BAT_ADD_CAND_CAP = 15;
/** FA arms considered, by priced start total. */
const ARM_ADD_CAND_CAP = 10;
/** Moves netting below this over the window aren't worth a move slot. */
const MIN_MOVE_NET = 1;
/** Rows returned. */
const BOARD_CAP = 15;

const RESERVE_RE = /^(IL\+?|NA)$/i;
const round1 = (n: number) => Number(n.toFixed(1));
const ident = (name: string, team: string) => `${name.toLowerCase()}|${team.toLowerCase()}`;

export interface WeekMoveSide {
  playerKey: string;
  name: string;
  team: string;
  positions: string[];
  kind: 'B' | 'P';
  percentOwned?: number;
  ownershipType?: 'freeagent' | 'waivers';
  imageUrl?: string;
  /** Drop side: rest-of-season VOR context for the override UI. */
  vor?: number;
}

export interface WeekMoveDayChip {
  date: string;
  /** Short weekday, e.g. "Thu". */
  dayName: string;
  kind: 'game' | 'start';
}

export interface WeekMoveDropOption {
  /** null = pure add into cap space. */
  drop: WeekMoveSide | null;
  net: number;
  dropCost: number;
}

export interface WeekMove {
  /** `${addKey}|${dropKey ?? 'open'}` — stable row/plan identity. */
  id: string;
  kind: 'B' | 'P';
  add: WeekMoveSide;
  drop: WeekMoveSide | null;
  /** Joint rest-of-window delta of the chosen option. */
  net: number;
  addPoints: number;
  dropCost: number;
  dayChips: WeekMoveDayChip[];
  /** First day the add produces — when the move needs to happen by. */
  goLiveDate: string;
  /** Every priced drop alternative (churn pool + open slot), net desc. */
  dropOptions: WeekMoveDropOption[];
}

/** A board move staged in the session plan. Snapshot — `netAtAdd` keeps the
 *  plan total stable while the rest of the board re-prices around it. */
export interface PlannedMove {
  id: string;
  addKey: string;
  dropKey: string | null;
  netAtAdd: number;
  addName: string;
  dropName: string | null;
  dayChips: WeekMoveDayChip[];
}

export interface WeekMovesBoard {
  moves: WeekMove[];
  /** Optimal window points of the (plan-adjusted) roster — the baseline
   *  every move's net is measured against. */
  baselineWindowPoints: number;
}

export interface WeekMovesInput {
  cadence: LineupCadence;
  days: PointsStreamingDay[];
  batterFacts: PointsBatterDayFacts[];
  myPitcherFacts: PointsMyPitcherFacts[];
  pitcherStreams: PointsPitcherStreamRow[];
  /** Points-team rows (batters + pitchers, owned + FA) — VOR and relief
   *  projections. */
  teamRows: PointsPlayerRow[];
  roster: RosterEntry[];
  leaguePositions: RosterPositionSlot[];
  plan?: PlannedMove[];
}

/** Stage a board move into the session plan. */
export function plannedMoveFromWeekMove(m: WeekMove): PlannedMove {
  return {
    id: m.id,
    addKey: m.add.playerKey,
    dropKey: m.drop?.playerKey ?? null,
    netAtAdd: m.net,
    addName: m.add.name,
    dropName: m.drop?.name ?? null,
    dayChips: m.dayChips,
  };
}

export function buildPointsWeekMoves(input: WeekMovesInput): WeekMovesBoard {
  const {
    cadence, days, batterFacts, myPitcherFacts, pitcherStreams,
    teamRows, roster, leaguePositions, plan = [],
  } = input;
  if (days.length === 0 || roster.length === 0 || leaguePositions.length === 0) {
    return { moves: [], baselineWindowPoints: 0 };
  }

  // ---- Fact indices (playerKey primary, name|team fallback) --------------

  const factsByKey = new Map<string, PointsBatterDayFacts>();
  const factsByIdent = new Map<string, PointsBatterDayFacts>();
  for (const f of batterFacts) {
    factsByKey.set(f.playerKey, f);
    factsByIdent.set(ident(f.name, f.team), f);
  }
  const armFactsByKey = new Map(myPitcherFacts.map(f => [f.playerKey, f]));

  const teamRowByKey = new Map<string, PointsPlayerRow>();
  const teamRowByIdent = new Map<string, PointsPlayerRow>();
  for (const r of teamRows) {
    teamRowByKey.set(r.playerKey, r);
    teamRowByIdent.set(ident(r.name, r.team), r);
  }
  const teamRowFor = (playerKey: string, name: string, team: string) =>
    teamRowByKey.get(playerKey) ?? teamRowByIdent.get(ident(name, team));

  const factsFor = (p: RosterEntry) =>
    factsByKey.get(p.player_key) ?? factsByIdent.get(ident(p.name, p.editorial_team_abbr));

  // ---- Hypothetical roster: live roster ± the session plan ---------------

  const plannedDropKeys = new Set(plan.map(m => m.dropKey).filter((k): k is string => k !== null));
  const plannedAddKeys = new Set(plan.map(m => m.addKey));

  const syntheticAdd = (f: { playerKey: string; name: string; team: string; positions: string[] }): RosterEntry => ({
    player_key: f.playerKey,
    player_id: '',
    name: f.name,
    editorial_team_abbr: f.team,
    display_position: f.positions[0] ?? '',
    eligible_positions: f.positions,
    selected_position: 'BN',
    on_disabled_list: false,
    is_editable: true,
    batting_order: null,
  });

  // Today's Yahoo flags (locked, not-in-MLB-lineup) don't apply to future
  // days — neutralize like the server's futureRoster; injury status stays.
  const liveKeys = new Set(roster.map(p => p.player_key));
  const hypoRoster: RosterEntry[] = [
    ...roster
      .filter(p => !plannedDropKeys.has(p.player_key))
      .map(p => ({ ...p, is_editable: true, starting_status: undefined })),
    ...plan
      .filter(m => !liveKeys.has(m.addKey))
      .map(m => {
        const f = factsByKey.get(m.addKey);
        if (f) return syntheticAdd(f);
        const s = pitcherStreams.find(r => r.playerKey === m.addKey);
        return s ? syntheticAdd(s) : null;
      })
      .filter((p): p is RosterEntry => p !== null),
  ];
  const hypoKeys = new Set(hypoRoster.map(p => p.player_key));

  // ---- Cadence-aware solving over the day-value facts ---------------------

  const dayScore = (di: number) => (p: RosterEntry): number =>
    factsFor(p)?.dayPoints[di] ?? 0;
  const weekScore = (p: RosterEntry): number => {
    const f = factsFor(p);
    if (!f) return 0;
    let sum = 0;
    for (const v of f.dayPoints) sum += v;
    return sum;
  };

  const solveTotal = (players: RosterEntry[], touched?: ReadonlySet<number>, basePerDay?: number[]): number => {
    if (cadence === 'weekly') {
      return optimizePointsLineup(players, leaguePositions, weekScore).optimalPoints;
    }
    let total = 0;
    for (let di = 0; di < days.length; di++) {
      // A player who scores 0 on a day can't change that day's optimum, so
      // variants only re-solve the days their add/drop actually plays.
      if (touched && basePerDay && !touched.has(di)) total += basePerDay[di];
      else total += optimizePointsLineup(players, leaguePositions, dayScore(di)).optimalPoints;
    }
    return total;
  };

  const basePerDay: number[] = cadence === 'weekly'
    ? []
    : days.map((_, di) => optimizePointsLineup(hypoRoster, leaguePositions, dayScore(di)).optimalPoints);
  const baseTotal = cadence === 'weekly'
    ? solveTotal(hypoRoster)
    : basePerDay.reduce((s, v) => s + v, 0);

  const gameDaysOf = (f: PointsBatterDayFacts): Set<number> => {
    const out = new Set<number>();
    f.dayPoints.forEach((v, di) => { if (v > 0) out.add(di); });
    return out;
  };
  const without = (key: string) => hypoRoster.filter(p => p.player_key !== key);

  // ---- Churn pool: VOR-near-replacement rostered players ------------------

  interface ChurnPlayer { side: WeekMoveSide; weekCost: number; touched: Set<number> }

  const churn: ChurnPlayer[] = [];
  for (const p of hypoRoster) {
    if (plannedAddKeys.has(p.player_key)) continue;   // the plan doesn't cannibalize itself
    if (RESERVE_RE.test(p.selected_position)) continue;
    const row = teamRowFor(p.player_key, p.name, p.editorial_team_abbr);
    if (!row || row.vor === undefined || row.vor > CHURN_VOR_MAX) continue;

    const kind: 'B' | 'P' = isPitcher(p) ? 'P' : 'B';
    let weekCost: number;
    let touched = new Set<number>();
    if (kind === 'P') {
      const af = armFactsByKey.get(p.player_key);
      if (!af) continue;                              // no facts row — post-add skew, skip
      weekCost = af.starts.length > 0 ? af.totalPoints : (row.thisWeekPoints ?? 0);
    } else {
      const f = factsFor(p);
      if (!f) continue;
      touched = gameDaysOf(f);
      weekCost = touched.size === 0
        ? 0
        : baseTotal - solveTotal(without(p.player_key), touched, basePerDay);
    }
    churn.push({
      side: {
        playerKey: p.player_key,
        name: p.name,
        team: p.editorial_team_abbr,
        positions: p.eligible_positions,
        kind,
        percentOwned: p.percent_owned,
        imageUrl: p.image_url,
        vor: round1(row.vor),
      },
      weekCost,
      touched,
    });
  }
  churn.sort((a, b) => (a.side.vor ?? 0) - (b.side.vor ?? 0));
  const churnPool = churn.slice(0, CHURN_POOL_CAP);

  // ---- Add candidates ------------------------------------------------------

  const dateToDayName = new Map(days.map(d => [d.date, d.dayName]));

  interface BatCand { f: PointsBatterDayFacts; addOnly: number; touched: Set<number> }
  const batCands: BatCand[] = batterFacts
    .filter(f => !f.owned && !hypoKeys.has(f.playerKey) && f.dayPoints.some(v => v > 0))
    .map(f => {
      const touched = gameDaysOf(f);
      const addOnly = solveTotal([...hypoRoster, syntheticAdd(f)], touched, basePerDay) - baseTotal;
      return { f, addOnly, touched };
    })
    .sort((a, b) => b.addOnly - a.addOnly)
    .slice(0, BAT_ADD_CAND_CAP);

  const armCands = pitcherStreams
    .filter(s => !hypoKeys.has(s.playerKey))
    .slice(0, ARM_ADD_CAND_CAP);

  // ---- Pure-add capacity (plan adds already occupy the hypo roster) -------

  const batOpen = computeOpenSlotCount(hypoRoster, leaguePositions);
  const capOpen = computeCapOpenCount(hypoRoster, leaguePositions);

  // ---- Price every add × (open slot + churn drops) -------------------------

  const moves: WeekMove[] = [];

  const assemble = (
    add: WeekMoveSide,
    addPoints: number,
    dayChips: WeekMoveDayChip[],
    options: WeekMoveDropOption[],
  ) => {
    options.sort((a, b) => b.net - a.net);
    const best = options[0];
    if (!best || best.net < MIN_MOVE_NET || dayChips.length === 0) return;
    moves.push({
      id: `${add.playerKey}|${best.drop?.playerKey ?? 'open'}`,
      kind: add.kind,
      add,
      drop: best.drop,
      net: round1(best.net),
      addPoints: round1(addPoints),
      dropCost: round1(best.dropCost),
      dayChips,
      goLiveDate: dayChips[0].date,
      dropOptions: options.map(o => ({ ...o, net: round1(o.net), dropCost: round1(o.dropCost) })),
    });
  };

  for (const { f, addOnly, touched } of batCands) {
    const add: WeekMoveSide = {
      playerKey: f.playerKey,
      name: f.name,
      team: f.team,
      positions: f.positions,
      kind: 'B',
      percentOwned: f.percentOwned,
      ownershipType: f.ownershipType,
      imageUrl: f.imageUrl,
    };
    const chips: WeekMoveDayChip[] = days
      .filter((_, di) => touched.has(di))
      .map(d => ({ date: d.date, dayName: d.dayName, kind: 'game' as const }));

    const options: WeekMoveDropOption[] = [];
    if (batOpen > 0) options.push({ drop: null, net: addOnly, dropCost: 0 });
    for (const c of churnPool) {
      if (c.side.kind === 'B') {
        // Exact joint delta — displacement between add and drop included.
        const union = new Set([...touched, ...c.touched]);
        const variant = [...without(c.side.playerKey), syntheticAdd(f)];
        const net = solveTotal(variant, union, basePerDay) - baseTotal;
        options.push({ drop: c.side, net, dropCost: c.weekCost });
      } else {
        options.push({ drop: c.side, net: addOnly - c.weekCost, dropCost: c.weekCost });
      }
    }
    assemble(add, addOnly, chips, options);
  }

  for (const s of armCands) {
    const add: WeekMoveSide = {
      playerKey: s.playerKey,
      name: s.name,
      team: s.team,
      positions: s.positions,
      kind: 'P',
      percentOwned: s.percentOwned,
      ownershipType: s.ownershipType,
      imageUrl: s.imageUrl,
    };
    const chips: WeekMoveDayChip[] = s.starts.map(st => ({
      date: st.date,
      dayName: dateToDayName.get(st.date) ?? st.dayLabel,
      kind: 'start' as const,
    }));

    const options: WeekMoveDropOption[] = [];
    if (capOpen > 0) options.push({ drop: null, net: s.totalPoints, dropCost: 0 });
    for (const c of churnPool) {
      options.push({ drop: c.side, net: s.totalPoints - c.weekCost, dropCost: c.weekCost });
    }
    assemble(add, s.totalPoints, chips, options);
  }

  moves.sort((a, b) => b.net - a.net);
  return {
    moves: moves.slice(0, BOARD_CAP),
    baselineWindowPoints: round1(baseTotal),
  };
}
