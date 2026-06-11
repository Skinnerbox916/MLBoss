import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTeamRosterByDate, withCache, CACHE_CATEGORIES } from '@/lib/fantasy';
import { getGameDay } from '@/lib/mlb/schedule';
import { getParkByVenueId } from '@/lib/mlb/parks';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import { getCachedLineupSpots } from '@/lib/mlb/lineupSpots';
import { getEnrichedLeagueStatCategories } from '@/lib/fantasy/stats';
import { getWeekDays, type WeekTarget } from '@/lib/dashboard/weekRange';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import {
  projectBatterTeam,
  type ActiveBatter,
  type ProjectionDeps,
} from '@/lib/projection/batterTeam';
import type { EnrichedGame, BatterSeasonStats } from '@/lib/mlb/types';

/**
 * GET /api/projection/batter-team?teamKey=...&leagueKey=...
 *
 * Forward batter-cat projection for the rest of the matchup week (Mon-Sun).
 * Filters the team's roster down to active batters (not IL/IL+/NA, not
 * pitchers), looks up their season stats, fans out per-day games, runs
 * `getBatterRating` per (player, day) and aggregates per-cat counting / AB
 * totals plus a PA-weighted weekly score per player.
 *
 * Used by the streaming page's strategy summary and corrected margin.
 *
 * Response shape (JSON-friendly — Maps serialised as records):
 *   {
 *     teamKey, weekStart, weekEnd, daysElapsed,
 *     byCategory: { [statId]: { expectedCount, expectedDenom } },
 *     perPlayer: [{ mlbId, name, teamAbbr, weeklyScore, weeklyPA,
 *                   expectedGames, byCategory: {...}, perDay: [...] }],
 *     contributorCount,
 *   }
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;
    const { searchParams } = new URL(request.url);
    const teamKey = searchParams.get('teamKey');
    const leagueKey = searchParams.get('leagueKey');

    if (!teamKey) {
      return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    }
    if (!leagueKey) {
      return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });
    }

    // `?targetWeek=next` projects next Mon-Sun instead of the current
    // matchup. Used by the Sunday streaming pivot — the current matchup
    // is effectively closed (only Sunday remains), so the chase/hold/punt
    // and volume-gap views should describe next week instead. Default
    // `'current'` preserves mid-week behavior.
    const targetWeek: WeekTarget = searchParams.get('targetWeek') === 'next' ? 'next' : 'current';
    // Cache the assembled projection. This is fanned out 4× per page by
    // `useCorrectedMatchupAnalysis` (my+opp × batter+pitcher) and drives the
    // Lineup Game Plan, Streaming, and Dashboard — recomputing per-player ×
    // per-day ratings every call was a top categories-page cost. Keyed by
    // team + week; 5-min TTL (roster/lineups shift). Single-flight in
    // withCache also collapses the concurrent my/opp calls.
    const payload = await withCache(
      `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:proj-batter-team:${teamKey}:${targetWeek}`,
      CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
      async () => {
        const days = getWeekDays(new Date(), targetWeek);
        const remaining = days.filter(d => d.isRemaining);
        const weekStart = days[0]?.date;
        const weekEnd = days[days.length - 1]?.date;
        const daysElapsed = days.filter(d => !d.isRemaining).length;

        const empty = { teamKey, weekStart, weekEnd, daysElapsed, byCategory: {}, perPlayer: [], contributorCount: 0 };
        if (remaining.length === 0) return empty;

        // Roster as of the LAST remaining day — captures pickups effective for
        // upcoming days. See `docs/history.md` "Always-fetch-roster-by-date".
        const rosterDate = remaining[remaining.length - 1]!.date;
        const [roster, allCategories, gameDayResults] = await Promise.all([
          getTeamRosterByDate(user.id, teamKey, rosterDate),
          getEnrichedLeagueStatCategories(user.id, leagueKey),
          Promise.all(remaining.map(d => getGameDay(d.date))),
        ]);

        const scoredCategories = allCategories.filter(c => c.is_batter_stat);
        const activeRoster = roster.filter(p => !isPitcher(p) && getRowStatus(p) !== 'injured');
        if (activeRoster.length === 0) return empty;

        const statsRecord = await getRosterSeasonStats(
          activeRoster.map(p => ({ name: p.name, team: p.editorial_team_abbr })),
        );
        const statsByMlbId = new Map<number, BatterSeasonStats>();
        for (const s of Object.values(statsRecord)) {
          if (s.mlbId > 0) statsByMlbId.set(s.mlbId, s);
        }

        const activeBatters: ActiveBatter[] = [];
        for (const p of activeRoster) {
          const k = `${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`;
          const stats = statsRecord[k];
          if (!stats) continue;
          activeBatters.push({ mlbId: stats.mlbId, name: p.name, teamAbbr: p.editorial_team_abbr });
        }

        const gamesByDate = new Map<string, EnrichedGame[]>();
        remaining.forEach((d, i) => {
          const enriched = (gameDayResults[i] ?? []).map(g => ({
            ...g,
            park: getParkByVenueId(g.venue.mlbId) ?? null,
          })) as EnrichedGame[];
          gamesByDate.set(d.date, enriched);
        });

        const lineupSpots = await getCachedLineupSpots(activeBatters.map(b => b.mlbId));

        const deps: ProjectionDeps = {
          days: remaining,
          statsByMlbId,
          gamesByDate,
          scoredCategories,
          lineupSpots,
        };

        const projection = projectBatterTeam(activeBatters, deps);

        const byCategoryRecord: Record<number, { expectedCount: number; expectedDenom: number }> = {};
        for (const [statId, cat] of projection.byCategory) {
          byCategoryRecord[statId] = { expectedCount: cat.expectedCount, expectedDenom: cat.expectedDenom };
        }
        const perPlayer = projection.perPlayer.map(p => {
          const byCat: Record<number, { expectedCount: number; expectedDenom: number }> = {};
          for (const [statId, cat] of p.byCategory) {
            byCat[statId] = { expectedCount: cat.expectedCount, expectedDenom: cat.expectedDenom };
          }
          return {
            mlbId: p.mlbId,
            name: p.name,
            teamAbbr: p.teamAbbr,
            weeklyScore: p.weeklyScore,
            weeklyPA: p.weeklyPA,
            expectedGames: p.expectedGames,
            byCategory: byCat,
            perDay: p.perDay.map(d => ({
              date: d.date,
              dayLabel: d.dayLabel,
              hasGame: d.hasGame,
              doubleHeader: d.doubleHeader,
              opponent: d.opponent,
              spotUsed: d.spotUsed,
              spotSource: d.spotSource,
              parkFactor: d.parkFactor,
              spName: d.spName,
              spThrows: d.spThrows,
              weatherFlag: d.weatherFlag,
              expectedPA: d.expectedPA,
              score: d.rating?.score ?? null,
              tier: d.rating?.tier ?? null,
            })),
          };
        });

        return { teamKey, weekStart, weekEnd, daysElapsed, byCategory: byCategoryRecord, perPlayer, contributorCount: projection.contributorCount };
      },
    );

    return NextResponse.json(payload);
  } catch (error) {
    console.error('batter-team projection API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to project batter team' },
      { status: 500 },
    );
  }
}
