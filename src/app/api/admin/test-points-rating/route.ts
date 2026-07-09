import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  getCurrentMLBGameKey,
  analyzeUserFantasyLeagues,
  getScoringProfile,
  getTeamRosterByDate,
  getTopAvailableBatters,
  getAvailablePitchers,
  getLeagueRosterPositions,
  cacheResult,
} from '@/lib/fantasy';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import { getGameDay } from '@/lib/mlb/schedule';
import { getObservedLineupSpots } from '@/lib/mlb/lineupSpots';
import { getWeekDays } from '@/lib/dashboard/weekRange';
import { getPointsPitcherInputs } from '@/lib/points/pitcherInputs';
import { batterPointsValue, pitcherPointsValue, batterPointsPerPA } from '@/lib/points/pointsValue';
import {
  resolveBatterVolume,
  resolvePitcherStartVolume,
  resolveReliefVolume,
} from '@/lib/points/schedule';
import { forecastBatterPoints, forecastPitcherPoints } from '@/lib/points/forecast';
import {
  replacementByPosition,
  valueOverReplacement,
  primaryPosition,
} from '@/lib/points/replacement';
import { recommendSwaps, type MoveCandidate } from '@/lib/points/moves';
import { optimizePointsLineup } from '@/lib/points/lineupOptimizer';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import type { EnrichedGame } from '@/lib/mlb/types';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';

/**
 * Points-league smoke endpoint.
 *  - Phase 1: ranks roster + top FAs by talent-neutral weekly points.
 *  - Phase 2: schedule-aware expected points for the rest of THIS week, plus
 *    per-position replacement level and each roster player's value over
 *    replacement (VOR).
 *
 *   GET /api/admin/test-points-rating[?league_key=...&fa=1]
 */

const FA_BATTER_CAP = 30;
const FA_PITCHER_CAP = 30;

interface FAish { name: string; editorial_team_abbr: string; eligible_positions: string[]; display_position: string; percent_owned?: number; }

function isPitcherPos(eligible: string[], display: string): boolean {
  const pos = [...(eligible ?? []), display];
  return pos.some(x => x === 'P' || x === 'SP' || x === 'RP');
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const user = session.user;

    const { searchParams } = new URL(request.url);
    const requestedLeagueKey = searchParams.get('league_key');
    const includeFA = searchParams.get('fa') !== '0';

    const currentMLB = await getCurrentMLBGameKey(user.id);
    if (!currentMLB?.game_key) {
      return NextResponse.json({ error: 'No active MLB season' }, { status: 404 });
    }

    const analysis = await analyzeUserFantasyLeagues(user.id, [currentMLB.game_key]);
    if (!analysis.ok) {
      return NextResponse.json({ error: analysis.error }, { status: 500 });
    }
    const leagues = analysis.data.leagues ?? [];

    let target = requestedLeagueKey
      ? leagues.find(l => l.league_key === requestedLeagueKey)
      : undefined;
    if (!target) {
      for (const l of leagues) {
        const prof = await getScoringProfile(user.id, l.league_key, l.scoring_type);
        if (prof.mode === 'points') { target = l; break; }
      }
    }
    if (!target) {
      return NextResponse.json({ error: 'No points-mode league found for this user' }, { status: 404 });
    }

    const profile = await getScoringProfile(user.id, target.league_key, target.scoring_type);
    if (profile.mode !== 'points') {
      return NextResponse.json(
        { error: `League ${target.league_key} is ${profile.mode}, not points`, profile },
        { status: 400 },
      );
    }

    const teamKey = target.user_team?.team_key;
    if (!teamKey) {
      return NextResponse.json({ error: 'No team for user in target league' }, { status: 404 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const roster = await getTeamRosterByDate(user.id, teamKey, today);
    const rosterBatters = roster.filter(p => !isPitcher(p));
    const rosterPitchers = roster.filter(p => isPitcher(p));

    let faBatters: FAish[] = [];
    let faPitchers: FAish[] = [];
    if (includeFA) {
      const [batPool, pitPool] = await Promise.all([
        getTopAvailableBatters(user.id, target.league_key),
        getAvailablePitchers(user.id, target.league_key),
      ]);
      const byOwned = (a: { percent_owned?: number }, b: { percent_owned?: number }) =>
        (b.percent_owned ?? 0) - (a.percent_owned ?? 0);
      faBatters = batPool.filter(p => !isPitcherPos(p.eligible_positions, p.display_position)).sort(byOwned).slice(0, FA_BATTER_CAP);
      faPitchers = pitPool.filter(p => isPitcherPos(p.eligible_positions, p.display_position)).sort(byOwned).slice(0, FA_PITCHER_CAP);
    }

    // Player input universe (positions carried through for VOR / replacement).
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

    // ----- Phase 2: schedule (this week, or ?week=next for the first
    // scoring week of a just-drafted league) -----
    const targetWeek = searchParams.get('week') === 'next' ? 'next' : 'current';
    const days = getWeekDays(new Date(), targetWeek);
    const remaining = days.filter(d => d.isRemaining);
    const gameDayResults = await Promise.all(remaining.map(d => getGameDay(d.date)));
    const gamesByDate = new Map<string, EnrichedGame[]>();
    remaining.forEach((d, i) => gamesByDate.set(d.date, (gameDayResults[i] ?? []) as EnrichedGame[]));

    // Lineup spots for roster batters (drives expected PA/game).
    const rosterBatterMlbIds = batterInputs
      .filter(p => p.owned)
      .map(p => batterStats[key(p.name, p.team)]?.mlbId)
      .filter((id): id is number => typeof id === 'number' && id > 0);
    const lineupSpots = await getObservedLineupSpots(rosterBatterMlbIds);

    // ----- Phase 1 values (talent-neutral weekly) + Phase 2 (this week) -----
    const batters = batterInputs
      .map(p => {
        const stats = batterStats[key(p.name, p.team)];
        if (!stats) return null;
        const v = batterPointsValue(stats, profile);
        let thisWeek: number | null = null;
        if (p.owned) {
          const spot = lineupSpots.get(stats.mlbId) ?? null;
          const vol = resolveBatterVolume(p.team, spot, gamesByDate, remaining);
          thisWeek = Number(forecastBatterPoints(stats, profile, vol).expectedPoints.toFixed(1));
        }
        return {
          name: p.name, team: p.team, owned: p.owned, injured: p.injured,
          positions: p.positions,
          weeklyPoints: Number(v.weeklyPoints.toFixed(1)),
          pointsPerGame: Number(v.pointsPerGame.toFixed(2)),
          thisWeekPoints: thisWeek,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.weeklyPoints - a.weeklyPoints);

    const pitchers = pitcherInputs
      .map(p => {
        const entry = pitcherData[key(p.name, p.team)];
        if (!entry || entry.isGhost) return null;
        const v = pitcherPointsValue(entry.talent, profile, {
          role: entry.role, seasonSaves: entry.seasonSaves, seasonGames: entry.seasonGames,
        });
        let thisWeek: number | null = null;
        let starts: number | null = null;
        if (p.owned) {
          const startVol = resolvePitcherStartVolume(p.name, p.team, entry.talent.ipPerStart, gamesByDate, remaining);
          const reliefVol = resolveReliefVolume(entry.talent.appearancesPerWeek, entry.talent.ipPerAppearance, remaining);
          const f = forecastPitcherPoints(entry, profile, startVol, reliefVol);
          thisWeek = Number(f.expectedPoints.toFixed(1));
          starts = startVol.starts;
        }
        return {
          name: p.name, team: p.team, owned: p.owned, injured: p.injured,
          positions: p.positions, role: v.role, seasonSaves: entry.seasonSaves,
          weeklyPoints: Number(v.weeklyPoints.toFixed(1)),
          pointsPerIP: Number(v.pointsPerIP.toFixed(2)),
          thisWeekPoints: thisWeek,
          thisWeekStarts: starts,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.weeklyPoints - a.weeklyPoints);

    // ----- Replacement level (from FA pool) + VOR for roster players -----
    const faReplacementCandidates = [
      ...batters.filter(b => !b.owned).map(b => ({ positions: b.positions, weeklyPoints: b.weeklyPoints })),
      ...pitchers.filter(p => !p.owned).map(p => ({ positions: p.positions, weeklyPoints: p.weeklyPoints })),
    ];
    const replacement = replacementByPosition(faReplacementCandidates, 3);

    const rosterVOR = [
      ...batters.filter(b => b.owned).map(b => {
        const pos = primaryPosition(b.positions, false);
        return { name: b.name, pos, weeklyPoints: b.weeklyPoints, thisWeekPoints: b.thisWeekPoints, vor: Number(valueOverReplacement(b.weeklyPoints, pos, replacement).toFixed(1)) };
      }),
      ...pitchers.filter(p => p.owned).map(p => {
        const pos = primaryPosition(p.positions, true);
        return { name: p.name, pos, weeklyPoints: p.weeklyPoints, thisWeekPoints: p.thisWeekPoints, vor: Number(valueOverReplacement(p.weeklyPoints, pos, replacement).toFixed(1)) };
      }),
    ].sort((a, b) => b.vor - a.vor);

    // ----- Phase 3: suggested moves (greedy value upgrades) -----
    const rosterMoveCands: MoveCandidate[] = [
      ...batters.filter(b => b.owned).map(b => ({ name: b.name, team: b.team, kind: 'B' as const, value: b.weeklyPoints })),
      ...pitchers.filter(p => p.owned).map(p => ({ name: p.name, team: p.team, kind: 'P' as const, value: p.weeklyPoints, meta: { role: p.role } })),
    ];
    const faMoveCands: MoveCandidate[] = [
      ...batters.filter(b => !b.owned).map(b => ({ name: b.name, team: b.team, kind: 'B' as const, value: b.weeklyPoints })),
      ...pitchers.filter(p => !p.owned).map(p => ({ name: p.name, team: p.team, kind: 'P' as const, value: p.weeklyPoints, meta: { role: p.role } })),
    ];
    const moves = recommendSwaps(rosterMoveCands, faMoveCands, { minGain: 1, maxPerKind: 6 });

    // ----- Phase 3: optimal batting lineup for the target day -----
    let lineup: ReturnType<typeof optimizePointsLineup> | null = null;
    let lineupDay: string | undefined;
    const targetDay = remaining[0];
    if (targetDay) {
      lineupDay = targetDay.date;
      const rosterPositions = await getLeagueRosterPositions(user.id, target.league_key);
      const getDayPoints = (p: RosterEntry): number => {
        const stats = batterStats[key(p.name, p.editorial_team_abbr)];
        if (!stats) return 0;
        const posted = p.batting_order;
        const spot = posted && posted >= 1 && posted <= 9 ? posted : (lineupSpots.get(stats.mlbId) ?? null);
        const vol = resolveBatterVolume(p.editorial_team_abbr, spot, gamesByDate, [targetDay]);
        return batterPointsPerPA(stats, profile) * vol.expectedPA;
      };
      lineup = optimizePointsLineup(roster as RosterEntry[], rosterPositions, getDayPoints);
    }

    const payload = {
      league_key: target.league_key,
      league_name: target.league_name,
      scoring_type: target.scoring_type,
      week: { target: targetWeek, start: days[0]?.date, end: days[days.length - 1]?.date, remainingDays: remaining.length },
      caveats: {
        sv_modeled: 'observed pace (saves/appearances), gated to relievers with >=3 saves',
        w_model: 'quality + depth aware; no team run-support context',
        matchup_adjusted: false, // this-week uses real schedule VOLUME but talent-neutral rate (no park/opp); that is Phase 3
        replacement: '3rd-best available FA at each position; VOR uses primary position',
      },
      replacement_by_position: Object.fromEntries(
        Object.entries(replacement).map(([k, v]) => [k, Number(v.toFixed(1))]),
      ),
      roster_value_over_replacement: rosterVOR,
      suggested_moves: moves,
      lineup_optimizer: lineup ? { day: lineupDay, ...lineup } : null,
      batters: { count: batters.length, ranked: batters },
      pitchers: { count: pitchers.length, ranked: pitchers },
    };

    await cacheResult(`static:debug-points-rating:${target.league_key}`, payload, 600);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[test-points-rating]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rank points values' },
      { status: 500 },
    );
  }
}
