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
  getTopAvailableBatters,
  getAvailablePitchers,
  getLeagueRosterPositions,
} from '@/lib/fantasy';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import { getGameDay } from '@/lib/mlb/schedule';
import { getObservedLineupSpots } from '@/lib/mlb/lineupSpots';
import { getWeekDays, type WeekTarget } from '@/lib/dashboard/weekRange';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
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
import { recommendSwaps, type MoveCandidate, type SuggestedSwap } from './moves';
import { optimizePointsLineup, type PointsLineupResult } from './lineupOptimizer';

const FA_BATTER_CAP = 40;
const FA_PITCHER_CAP = 40;

export interface PointsPlayerRow {
  name: string;
  team: string;
  owned: boolean;
  injured: boolean;
  positions: string[];
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
  suggestedMoves: { batters: SuggestedSwap[]; pitchers: SuggestedSwap[] };
  lineup: (PointsLineupResult & { day?: string }) | null;
}

interface FAish {
  name: string;
  editorial_team_abbr: string;
  eligible_positions: string[];
  display_position: string;
  percent_owned?: number;
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
  opts: { week?: WeekTarget; includeFA?: boolean } = {},
): Promise<PointsTeamAnalysis> {
  const week: WeekTarget = opts.week ?? 'current';
  const includeFA = opts.includeFA ?? true;

  const today = new Date().toISOString().slice(0, 10);
  const roster = await getTeamRosterByDate(userId, teamKey, today);
  const rosterBatters = roster.filter(p => !isPitcher(p));
  const rosterPitchers = roster.filter(p => isPitcher(p));

  let faBatters: FAish[] = [];
  let faPitchers: FAish[] = [];
  if (includeFA) {
    const [batPool, pitPool] = await Promise.all([
      getTopAvailableBatters(userId, leagueKey),
      getAvailablePitchers(userId, leagueKey),
    ]);
    const byOwned = (a: { percent_owned?: number }, b: { percent_owned?: number }) =>
      (b.percent_owned ?? 0) - (a.percent_owned ?? 0);
    faBatters = batPool.filter(p => !isPitcherPos(p.eligible_positions, p.display_position)).sort(byOwned).slice(0, FA_BATTER_CAP);
    faPitchers = pitPool.filter(p => isPitcherPos(p.eligible_positions, p.display_position)).sort(byOwned).slice(0, FA_PITCHER_CAP);
  }

  const batterInputs = [
    ...rosterBatters.map(p => ({ name: p.name, team: p.editorial_team_abbr, owned: true, injured: getRowStatus(p) === 'injured', positions: p.eligible_positions })),
    ...faBatters.map(p => ({ name: p.name, team: p.editorial_team_abbr, owned: false, injured: false, positions: p.eligible_positions })),
  ];
  const pitcherInputs = [
    ...rosterPitchers.map(p => ({ name: p.name, team: p.editorial_team_abbr, owned: true, injured: getRowStatus(p) === 'injured', positions: p.eligible_positions })),
    ...faPitchers.map(p => ({ name: p.name, team: p.editorial_team_abbr, owned: false, injured: false, positions: p.eligible_positions })),
  ];

  const [batterStats, pitcherData] = await Promise.all([
    getRosterSeasonStats(batterInputs.map(p => ({ name: p.name, team: p.team }))),
    getPointsPitcherInputs(pitcherInputs.map(p => ({ name: p.name, team: p.team }))),
  ]);

  const key = (name: string, team: string) => `${name.toLowerCase()}|${team.toLowerCase()}`;

  // Schedule for the horizon.
  const days = getWeekDays(new Date(), week);
  const remaining = days.filter(d => d.isRemaining);
  const gameDayResults = await Promise.all(remaining.map(d => getGameDay(d.date)));
  const gamesByDate = new Map<string, EnrichedGame[]>();
  remaining.forEach((d, i) => gamesByDate.set(d.date, (gameDayResults[i] ?? []) as EnrichedGame[]));

  const rosterBatterMlbIds = batterInputs
    .filter(p => p.owned)
    .map(p => batterStats[key(p.name, p.team)]?.mlbId)
    .filter((id): id is number => typeof id === 'number' && id > 0);
  const lineupSpots = await getObservedLineupSpots(rosterBatterMlbIds);

  const batters: PointsPlayerRow[] = batterInputs
    .map((p): PointsPlayerRow | null => {
      const stats = batterStats[key(p.name, p.team)];
      if (!stats) return null;
      const v = batterPointsValue(stats, profile);
      let thisWeek: number | null = null;
      if (p.owned) {
        const spot = lineupSpots.get(stats.mlbId) ?? null;
        const vol = resolveBatterVolume(p.team, spot, gamesByDate, remaining);
        thisWeek = round1(forecastBatterPoints(stats, profile, vol).expectedPoints);
      }
      return {
        name: p.name, team: p.team, owned: p.owned, injured: p.injured, positions: p.positions, kind: 'B',
        weeklyPoints: round1(v.weeklyPoints), perUnit: Number(v.pointsPerGame.toFixed(2)), thisWeekPoints: thisWeek,
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
        const startVol = resolvePitcherStartVolume(p.name, p.team, entry.talent.ipPerStart, gamesByDate, remaining);
        const reliefVol = resolveReliefVolume(entry.talent.appearancesPerWeek, entry.talent.ipPerAppearance, remaining);
        const f = forecastPitcherPoints(entry, profile, startVol, reliefVol);
        thisWeek = round1(f.expectedPoints);
        thisWeekStarts = startVol.starts;
      }
      return {
        name: p.name, team: p.team, owned: p.owned, injured: p.injured, positions: p.positions, kind: 'P',
        role: v.role, seasonSaves: entry.seasonSaves,
        weeklyPoints: round1(v.weeklyPoints), perUnit: Number(v.pointsPerIP.toFixed(2)), thisWeekPoints: thisWeek, thisWeekStarts,
      };
    })
    .filter((x): x is PointsPlayerRow => x !== null)
    .sort((a, b) => b.weeklyPoints - a.weeklyPoints);

  // Replacement + VOR.
  const faCands = [
    ...batters.filter(b => !b.owned).map(b => ({ positions: b.positions, weeklyPoints: b.weeklyPoints })),
    ...pitchers.filter(p => !p.owned).map(p => ({ positions: p.positions, weeklyPoints: p.weeklyPoints })),
  ];
  const replacement = replacementByPosition(faCands, 3);
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

  // Suggested moves.
  const rosterCands: MoveCandidate[] = [
    ...batters.filter(b => b.owned).map(b => ({ name: b.name, team: b.team, kind: 'B' as const, value: b.weeklyPoints })),
    ...pitchers.filter(p => p.owned).map(p => ({ name: p.name, team: p.team, kind: 'P' as const, value: p.weeklyPoints, meta: { role: p.role } })),
  ];
  const faCandMoves: MoveCandidate[] = [
    ...batters.filter(b => !b.owned).map(b => ({ name: b.name, team: b.team, kind: 'B' as const, value: b.weeklyPoints })),
    ...pitchers.filter(p => !p.owned).map(p => ({ name: p.name, team: p.team, kind: 'P' as const, value: p.weeklyPoints, meta: { role: p.role } })),
  ];
  const suggestedMoves = recommendSwaps(rosterCands, faCandMoves, { minGain: 1, maxPerKind: 6 });

  // Optimal lineup for the next playable day.
  let lineup: (PointsLineupResult & { day?: string }) | null = null;
  const targetDay = remaining[0];
  if (targetDay) {
    const rosterPositions = await getLeagueRosterPositions(userId, leagueKey);
    const getDayPoints = (pl: RosterEntry): number => {
      const stats = batterStats[key(pl.name, pl.editorial_team_abbr)];
      if (!stats) return 0;
      const posted = pl.batting_order;
      const spot = posted && posted >= 1 && posted <= 9 ? posted : (lineupSpots.get(stats.mlbId) ?? null);
      const vol = resolveBatterVolume(pl.editorial_team_abbr, spot, gamesByDate, [targetDay]);
      if (vol.expectedPA <= 0) return 0;
      // Day score is matchup-adjusted (park / platoon / opp staff); the
      // weekly/VOR values above stay talent-neutral by design.
      const ctx = resolveMatchup(gamesByDate.get(targetDay.date) ?? [], null, pl.editorial_team_abbr, {
        hand: stats.bats ?? null,
        battingOrder: spot,
      });
      return adjustedBatterPointsPerPA(stats, profile, ctx, spot).pointsPerPA * vol.expectedPA;
    };
    const base = optimizePointsLineup(roster as RosterEntry[], rosterPositions, getDayPoints);

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

  const weekProjectedPoints = round1(
    [...batters, ...pitchers]
      .filter(p => p.owned)
      .reduce((sum, p) => sum + (p.thisWeekPoints ?? 0), 0),
  );

  return {
    week: { target: week, start: days[0]?.date, end: days[days.length - 1]?.date, remainingDays: remaining.length },
    weekProjectedPoints,
    batters,
    pitchers,
    replacementByPosition: Object.fromEntries(Object.entries(replacement).map(([k, v]) => [k, round1(v)])),
    rosterVOR,
    suggestedMoves,
    lineup,
  };
}
