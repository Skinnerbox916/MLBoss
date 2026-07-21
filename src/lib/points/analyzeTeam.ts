/**
 * Points-league team analysis — the single domain entry point the UI and the
 * admin smoke route both consume. Given a resolved points `ScoringProfile`,
 * a team, and a week horizon, it runs the full points engine pipeline:
 *
 *   talent → per-event rates (Phase 1)
 *         → schedule-aware expected points + replacement/VOR (Phase 2)
 *         → suggested moves + optimal lineup (Phase 3)
 *
 * Pure data assembly + scoring; no auth / league resolution (the route does
 * that). Caller guarantees `profile.mode === 'points'`.
 */

import {
  getTeamRosterByDate,
  getAvailableBatters,
  getAvailablePitchers,
  getLeagueRosterPositions,
  getLineupCadence,
} from '@/lib/fantasy';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import { getGameDay } from '@/lib/mlb/schedule';
import { getObservedLineupSpots } from '@/lib/mlb/lineupSpots';
import { getWeekDays, type WeekBounds, type WeekTarget, type WeekDay } from '@/lib/dashboard/weekRange';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import { isStashableIL } from '@/lib/roster/playerPool';
import { normalizeTeamAbbr } from '@/lib/mlb/teamAbbr';
import type { EnrichedGame } from '@/lib/mlb/types';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import { resolveMatchup } from '@/lib/mlb/analysis';
import { getPointsPitcherInputs } from './pitcherInputs';
import { batterPointsValue, pitcherPointsValue } from './pointsValue';
import { adjustedBatterPointsPerPA } from './matchupAdjust';
import { resolveBatterVolume, resolvePitcherStartVolume, resolveReliefVolume } from './schedule';
import { forecastBatterPoints, forecastPitcherPoints } from './forecast';
import { replacementByPosition, valueOverReplacement, primaryPosition } from './replacement';
import {
  playingTimeFactor,
  estimateFullTimePaceRef,
  estimateFullTimeGpRef,
} from '@/lib/roster/playingTime';
import { recommendSwaps, type MoveCandidate, type SuggestedSwap } from './moves';
import { optimizePointsLineup, type PointsLineupResult } from './lineupOptimizer';
import { projectRosterWeek } from './rosterWeek';
import { batterPointsRateVector } from './rateVector';

// Batter cap sized for the upgrade board: the extended FA fetch returns
// ~100 bats; keep the most-owned 60 so the stats fan-out stays bounded
// while the swap engine sees a real shopping pool.
const FA_BATTER_CAP = 60;
const FA_PITCHER_CAP = 40;

export interface PointsPlayerRow {
  name: string;
  team: string;
  /** Yahoo player_key — identity for move actions and the swap engine. */
  playerKey: string;
  owned: boolean;
  injured: boolean;
  positions: string[];
  /** Yahoo percent_owned (FA rows; roster rows may lack it). */
  percentOwned?: number;
  kind: 'B' | 'P';
  role?: 'starter' | 'reliever' | 'inactive';
  seasonSaves?: number;
  /** Talent-neutral expected points per typical week. */
  weeklyPoints: number;
  /** Per-game (batters) or per-IP (pitchers) rate, for context. */
  perUnit: number;
  /** Schedule-aware expected points for the horizon (owned players only). */
  thisWeekPoints: number | null;
  thisWeekStarts?: number | null;
  /** Weekly points above the position's replacement level — set for every
   *  row (rostered and FA) once replacement levels are known. */
  vor?: number;
  /** Batters only: per-stat pts/wk contributions (rate × league weight ×
   *  role-share-adjusted weekly PA). A projection FACT — the client-side
   *  move builder diffs these for the impact strips. */
  statPoints?: Record<number, number>;
}

export interface PointsVORRow {
  name: string;
  pos: string;
  kind: 'B' | 'P';
  weeklyPoints: number;
  thisWeekPoints: number | null;
  vor: number;
}

export interface PointsTeamAnalysis {
  week: { target: WeekTarget; start?: string; end?: string; remainingDays: number };
  /** Sum of owned players' schedule-aware expected points for the horizon. */
  weekProjectedPoints: number;
  batters: PointsPlayerRow[];
  pitchers: PointsPlayerRow[];
  replacementByPosition: Record<string, number>;
  rosterVOR: PointsVORRow[];
  /** Greedy value swaps — pitchers only. Batter moves are a client-side
   *  strategy computation (shared swap engine over these rows + the
   *  user's depth targets) — see lib/points/rosterStrategy.ts and the
   *  facts/preferences boundary in docs/points-leagues.md. */
  pitcherMoves: SuggestedSwap[];
  lineup: (PointsLineupResult & { day?: string }) | null;
}

interface FAish {
  name: string;
  editorial_team_abbr: string;
  player_key: string;
  eligible_positions: string[];
  display_position: string;
  percent_owned?: number;
  status?: string;
  on_disabled_list?: boolean;
}

function isPitcherPos(eligible: string[], display: string): boolean {
  return [...(eligible ?? []), display].some(x => x === 'P' || x === 'SP' || x === 'RP');
}

const round1 = (n: number) => Number(n.toFixed(1));

/** Resolve a team's opponent + opposing probable SP from a day's slate. */
function resolveOpponent(teamAbbr: string, games: EnrichedGame[]): { oppLabel: string; oppArm: string | null } {
  const t = normalizeTeamAbbr(teamAbbr);
  for (const g of games) {
    const isHome = normalizeTeamAbbr(g.homeTeam.abbreviation) === t;
    const isAway = normalizeTeamAbbr(g.awayTeam.abbreviation) === t;
    if (!isHome && !isAway) continue;
    const opp = isHome ? g.awayTeam.abbreviation : g.homeTeam.abbreviation;
    const oppPP = isHome ? g.awayProbablePitcher : g.homeProbablePitcher;
    return { oppLabel: `${isHome ? 'vs' : '@'} ${opp}`, oppArm: oppPP?.name ?? null };
  }
  return { oppLabel: 'no game', oppArm: null };
}

export async function analyzePointsTeam(
  userId: string,
  leagueKey: string,
  teamKey: string,
  profile: ScoringProfile,
  opts: { week?: WeekTarget; includeFA?: boolean; weekBounds?: WeekBounds } = {},
): Promise<PointsTeamAnalysis> {
  const week: WeekTarget = opts.week ?? 'current';
  const includeFA = opts.includeFA ?? true;
  const weekBounds = opts.weekBounds;

  const today = new Date().toISOString().slice(0, 10);
  const roster = await getTeamRosterByDate(userId, teamKey, today);
  const rosterBatters = roster.filter(p => !isPitcher(p));
  const rosterPitchers = roster.filter(p => isPitcher(p));

  let faBatters: FAish[] = [];
  let faPitchers: FAish[] = [];
  if (includeFA) {
    // Extended pool (~100 batters) — the upgrade board and the position-
    // aware swap engine need a real shopping pool, not just the most-owned
    // handful. Same cached fetch the categories roster page uses.
    const [batPool, pitPool] = await Promise.all([
      getAvailableBatters(userId, leagueKey),
      getAvailablePitchers(userId, leagueKey),
    ]);
    const byOwned = (a: { percent_owned?: number }, b: { percent_owned?: number }) =>
      (b.percent_owned ?? 0) - (a.percent_owned ?? 0);
    faBatters = batPool.filter(p => !isPitcherPos(p.eligible_positions, p.display_position)).sort(byOwned).slice(0, FA_BATTER_CAP);
    faPitchers = pitPool.filter(p => isPitcherPos(p.eligible_positions, p.display_position)).sort(byOwned).slice(0, FA_PITCHER_CAP);
  }

  const batterInputs = [
    ...rosterBatters.map(p => ({
      name: p.name, team: p.editorial_team_abbr, playerKey: p.player_key,
      owned: true, injured: getRowStatus(p) === 'injured',
      onIL: isStashableIL(p), percentOwned: p.percent_owned,
      positions: p.eligible_positions,
    })),
    ...faBatters.map(p => ({
      name: p.name, team: p.editorial_team_abbr, playerKey: p.player_key,
      // FA rows: `injured` = on a real IL (canonical rubric in
      // lib/roster/playerPool). Keeps stash candidates visible on the
      // boards while swap pools and replacement calcs filter them out —
      // you can't start them.
      owned: false, injured: isStashableIL(p),
      onIL: isStashableIL(p), percentOwned: p.percent_owned,
      positions: p.eligible_positions,
    })),
  ];
  const pitcherInputs = [
    ...rosterPitchers.map(p => ({ name: p.name, team: p.editorial_team_abbr, playerKey: p.player_key, owned: true, injured: getRowStatus(p) === 'injured', positions: p.eligible_positions })),
    ...faPitchers.map(p => ({ name: p.name, team: p.editorial_team_abbr, playerKey: p.player_key, owned: false, injured: isStashableIL(p), positions: p.eligible_positions })),
  ];

  const [batterStats, pitcherData] = await Promise.all([
    getRosterSeasonStats(batterInputs.map(p => ({ name: p.name, team: p.team }))),
    getPointsPitcherInputs(pitcherInputs.map(p => ({ name: p.name, team: p.team }))),
  ]);

  const key = (name: string, team: string) => `${name.toLowerCase()}|${team.toLowerCase()}`;

  // Schedule for the horizon — Yahoo's real week calendar when bounds are
  // supplied (up to 14 days in the combined all-star week).
  const days = getWeekDays(new Date(), week, weekBounds);
  const remaining = days.filter(d => d.isRemaining);
  const gameDayResults = await Promise.all(remaining.map(d => getGameDay(d.date)));
  const gamesByDate = new Map<string, EnrichedGame[]>();
  remaining.forEach((d, i) => gamesByDate.set(d.date, (gameDayResults[i] ?? []) as EnrichedGame[]));

  const rosterBatterMlbIds = batterInputs
    .filter(p => p.owned)
    .map(p => batterStats[key(p.name, p.team)]?.mlbId)
    .filter((id): id is number => typeof id === 'number' && id > 0);
  const lineupSpots = await getObservedLineupSpots(rosterBatterMlbIds);

  // Role share (playing-time factor): pace refs over the whole batter pool
  // (roster + FA) so both sides scale on the same reference — the same
  // carry-over the categories forecast route applies. Keeps VOR,
  // replacement, and suggested moves from crediting part-timers with
  // everyday volume.
  const allBatterStats = Object.values(batterStats);
  const fullTimePaceRef = estimateFullTimePaceRef(allBatterStats);
  const fullTimeGpRef = estimateFullTimeGpRef(allBatterStats);

  const batters: PointsPlayerRow[] = batterInputs
    .map((p): PointsPlayerRow | null => {
      const stats = batterStats[key(p.name, p.team)];
      if (!stats) return null;
      const roleShare = playingTimeFactor(stats, {
        fullTimePaceRef,
        fullTimeGpRef,
        isOnIL: p.onIL || p.injured,
        percentOwned: p.percentOwned,
      });
      const v = batterPointsValue(stats, profile, { roleShare });
      // Per-stat pts/wk contributions — rate × weight × the same role-
      // share-adjusted weekly PA the total uses, so the parts sum to the
      // whole. The client-side move builder diffs these for impact strips.
      const vec = batterPointsRateVector(stats).perPA;
      const statPoints: Record<number, number> = {};
      for (const [idStr, weight] of Object.entries(profile.weights)) {
        const r = vec[Number(idStr)];
        if (r) statPoints[Number(idStr)] = Number((r * weight * v.weeklyPA).toFixed(1));
      }
      let thisWeek: number | null = null;
      if (p.owned) {
        if (p.injured) {
          // IL/NA — his team still has games on the slate, so the volume
          // resolver would happily credit a full week he can't play.
          thisWeek = 0;
        } else {
          const spot = lineupSpots.get(stats.mlbId) ?? null;
          const vol = resolveBatterVolume(p.team, spot, gamesByDate, remaining);
          thisWeek = round1(forecastBatterPoints(stats, profile, vol).expectedPoints);
        }
      }
      return {
        name: p.name, team: p.team, playerKey: p.playerKey, owned: p.owned, injured: p.injured,
        percentOwned: p.percentOwned, positions: p.positions, kind: 'B',
        weeklyPoints: round1(v.weeklyPoints), perUnit: Number(v.pointsPerGame.toFixed(2)), thisWeekPoints: thisWeek,
        statPoints,
      };
    })
    .filter((x): x is PointsPlayerRow => x !== null)
    .sort((a, b) => b.weeklyPoints - a.weeklyPoints);

  const pitchers: PointsPlayerRow[] = pitcherInputs
    .map((p): PointsPlayerRow | null => {
      const entry = pitcherData[key(p.name, p.team)];
      if (!entry || entry.isGhost) return null;
      const v = pitcherPointsValue(entry.talent, profile, { role: entry.role, seasonSaves: entry.seasonSaves, seasonGames: entry.seasonGames });
      let thisWeek: number | null = null;
      let thisWeekStarts: number | null = null;
      if (p.owned) {
        if (p.injured) {
          // IL arms have no probables (starters price to ~0 naturally),
          // but the relief-pace path would still credit an IL reliever.
          thisWeek = 0;
          thisWeekStarts = 0;
        } else {
          const startVol = resolvePitcherStartVolume(p.name, p.team, entry.talent.ipPerStart, gamesByDate, remaining);
          const reliefVol = resolveReliefVolume(entry.talent.appearancesPerWeek, entry.talent.ipPerAppearance, remaining);
          const f = forecastPitcherPoints(entry, profile, startVol, reliefVol);
          thisWeek = round1(f.expectedPoints);
          thisWeekStarts = startVol.starts;
        }
      }
      return {
        name: p.name, team: p.team, playerKey: p.playerKey, owned: p.owned, injured: p.injured, positions: p.positions, kind: 'P',
        role: v.role, seasonSaves: entry.seasonSaves,
        weeklyPoints: round1(v.weeklyPoints), perUnit: Number(v.pointsPerIP.toFixed(2)), thisWeekPoints: thisWeek, thisWeekStarts,
      };
    })
    .filter((x): x is PointsPlayerRow => x !== null)
    .sort((a, b) => b.weeklyPoints - a.weeklyPoints);

  // Replacement + VOR. "Readily-available replacement" means startable
  // now — IL FAs are stashes, not replacements, so they stay out of the
  // pool (an IL stud would otherwise inflate his position's replacement
  // level and deflate every VOR at that slot).
  const faCands = [
    ...batters.filter(b => !b.owned && !b.injured).map(b => ({ positions: b.positions, weeklyPoints: b.weeklyPoints })),
    ...pitchers.filter(p => !p.owned && !p.injured).map(p => ({ positions: p.positions, weeklyPoints: p.weeklyPoints })),
  ];
  const replacement = replacementByPosition(faCands, 3);
  // Annotate every row (rostered AND FA) with VOR — the upgrade board
  // ranks free agents by the same number the roster table shows.
  for (const b of batters) {
    b.vor = round1(valueOverReplacement(b.weeklyPoints, primaryPosition(b.positions, false), replacement));
  }
  for (const p of pitchers) {
    p.vor = round1(valueOverReplacement(p.weeklyPoints, primaryPosition(p.positions, true), replacement));
  }
  const rosterVOR: PointsVORRow[] = [
    ...batters.filter(b => b.owned).map(b => {
      const pos = primaryPosition(b.positions, false);
      return { name: b.name, pos, kind: 'B' as const, weeklyPoints: b.weeklyPoints, thisWeekPoints: b.thisWeekPoints, vor: round1(valueOverReplacement(b.weeklyPoints, pos, replacement)) };
    }),
    ...pitchers.filter(p => p.owned).map(p => {
      const pos = primaryPosition(p.positions, true);
      return { name: p.name, pos, kind: 'P' as const, weeklyPoints: p.weeklyPoints, thisWeekPoints: p.thisWeekPoints, vor: round1(valueOverReplacement(p.weeklyPoints, pos, replacement)) };
    }),
  ].sort((a, b) => b.vor - a.vor);

  // Batter moves/depth/open-slots are CLIENT-side strategy (shared swap
  // engine over these rows + the user's depth targets) — see
  // lib/points/rosterStrategy.ts. This keeps the facts/preferences
  // boundary: this analysis is cacheable per league+team, never per
  // user preference.
  const rosterPositions = await getLeagueRosterPositions(userId, leagueKey);

  // Greedy value swaps — pitchers only now.
  const rosterCands: MoveCandidate[] = pitchers
    .filter(p => p.owned)
    .map(p => ({ name: p.name, team: p.team, kind: 'P' as const, value: p.weeklyPoints, meta: { role: p.role } }));
  const faCandMoves: MoveCandidate[] = pitchers
    // IL arms can't be added-and-started — never suggest them as swaps.
    .filter(p => !p.owned && !p.injured)
    .map(p => ({ name: p.name, team: p.team, kind: 'P' as const, value: p.weeklyPoints, meta: { role: p.role } }));
  const pitcherMoves = recommendSwaps(rosterCands, faCandMoves, { minGain: 1, maxPerKind: 6 }).pitchers;

  // Matchup-adjusted expected points for a batter on a given day (park /
  // platoon / opp staff; the weekly/VOR values above stay talent-neutral by
  // design). `preferPosted` uses today's actual posted batting order when
  // present — right for the single "today" lineup card; the week projection
  // leans on observed spots since posted orders don't exist for future days.
  // Injured players score 0 (their MLB team may still play, but they can't).
  const adjustedDayPoints = (pl: RosterEntry, day: WeekDay, preferPosted: boolean): number => {
    if (getRowStatus(pl) === 'injured') return 0;
    const stats = batterStats[key(pl.name, pl.editorial_team_abbr)];
    if (!stats) return 0;
    const posted = preferPosted ? pl.batting_order : null;
    const spot = posted && posted >= 1 && posted <= 9 ? posted : (lineupSpots.get(stats.mlbId) ?? null);
    const vol = resolveBatterVolume(pl.editorial_team_abbr, spot, gamesByDate, [day]);
    if (vol.expectedPA <= 0) return 0;
    const ctx = resolveMatchup(gamesByDate.get(day.date) ?? [], null, pl.editorial_team_abbr, {
      hand: stats.bats ?? null,
      battingOrder: spot,
    });
    return adjustedBatterPointsPerPA(stats, profile, ctx, spot).pointsPerPA * vol.expectedPA;
  };

  // Optimal lineup for the next playable day.
  let lineup: (PointsLineupResult & { day?: string }) | null = null;
  const targetDay = remaining[0];
  if (targetDay) {
    const base = optimizePointsLineup(
      roster as RosterEntry[],
      rosterPositions,
      pl => adjustedDayPoints(pl, targetDay, true),
    );

    // Enrich each lineup row for the design: avatar, opponent + opposing SP,
    // IL flag, and the season per-game / weekly points for the expanded card.
    const dayGames = gamesByDate.get(targetDay.date) ?? [];
    const rosterByKey = new Map((roster as RosterEntry[]).map(p => [key(p.name, p.editorial_team_abbr), p]));
    const batterByKey = new Map(batters.map(b => [key(b.name, b.team), b]));
    const enriched = base.lineup.map(r => {
      const entry = rosterByKey.get(key(r.name, r.team));
      const bat = batterByKey.get(key(r.name, r.team));
      const { oppLabel, oppArm } = resolveOpponent(r.team, dayGames);
      return {
        ...r,
        imageUrl: entry?.image_url ?? null,
        oppLabel,
        oppArm,
        injured: entry ? getRowStatus(entry) === 'injured' : false,
        perGamePts: bat?.perUnit,
        weeklyPts: bat?.weeklyPoints,
      };
    });
    lineup = { day: targetDay.date, ...base, lineup: enriched };
  }

  // Week projection = what the roster can actually SCORE, not what it
  // rosters. Batting goes through the shared roster-week engine (optimal
  // batting lineup solved per remaining day and summed — position-aware,
  // off-day-aware, injured benched; cadence-aware for locked-lineup
  // leagues), the SAME engine that powers the /streaming coverage strip.
  // Pitchers stay summed — starters are priced by actual probable starts,
  // not calendar days. (Previously batting was a top-K-by-slot-count
  // approximation here; see docs/history.md 2026-07.)
  const battingProjection = projectRosterWeek({
    roster: (roster as RosterEntry[]).filter(p => !isPitcher(p)),
    rosterPositions,
    days: remaining,
    dayScore: (pl, day) => adjustedDayPoints(pl, day, false),
    cadence: await getLineupCadence(userId, leagueKey),
  });
  const pitcherWeekPoints = pitchers
    .filter(p => p.owned)
    .reduce((sum, p) => sum + (p.thisWeekPoints ?? 0), 0);
  const weekProjectedPoints = round1(battingProjection.battingPoints + pitcherWeekPoints);

  return {
    week: { target: week, start: days[0]?.date, end: days[days.length - 1]?.date, remainingDays: remaining.length },
    weekProjectedPoints,
    batters,
    pitchers,
    replacementByPosition: Object.fromEntries(Object.entries(replacement).map(([k, v]) => [k, round1(v)])),
    rosterVOR,
    pitcherMoves,
    lineup,
  };
}
