import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTeamRoster } from '@/lib/fantasy';
import { getGameDay } from '@/lib/mlb/schedule';
import { getParkByVenueId } from '@/lib/mlb/parks';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import { getCachedLineupSpots } from '@/lib/mlb/lineupSpots';
import { getEnrichedLeagueStatCategories } from '@/lib/fantasy/stats';
import { getMatchupWeekDays } from '@/lib/dashboard/weekRange';
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
 *     byCategory: { [statId]: { expectedCount, expectedPA } },
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

    const days = getMatchupWeekDays();
    const remaining = days.filter(d => d.isRemaining);
    const weekStart = days[0]?.date;
    const weekEnd = days[days.length - 1]?.date;
    const daysElapsed = days.filter(d => !d.isRemaining).length;

    if (remaining.length === 0) {
      // End of Sunday — nothing to project. Return an empty shape so the
      // client renders without errors.
      return NextResponse.json({
        teamKey,
        weekStart,
        weekEnd,
        daysElapsed,
        byCategory: {},
        perPlayer: [],
        contributorCount: 0,
      });
    }

    // Fan out roster + categories + per-day games in parallel. The
    // underlying caches (dynamic 1-min for rosters, semi-dynamic 5-min for
    // games) cover the cost of repeated calls within a session.
    const [roster, allCategories, gameDayResults] = await Promise.all([
      getTeamRoster(user.id, teamKey),
      getEnrichedLeagueStatCategories(user.id, leagueKey),
      Promise.all(remaining.map(d => getGameDay(d.date))),
    ]);

    const scoredCategories = allCategories.filter(c => c.is_batter_stat);

    // Filter to active batters: not pitchers, not IL/IL+/NA. Mirrors
    // `getRowStatus` so the engine and the lineup UI agree on "who's
    // contributing this week".
    const activeRoster = roster.filter(p => !isPitcher(p) && getRowStatus(p) !== 'injured');

    if (activeRoster.length === 0) {
      return NextResponse.json({
        teamKey,
        weekStart,
        weekEnd,
        daysElapsed,
        byCategory: {},
        perPlayer: [],
        contributorCount: 0,
      });
    }

    // Stats lookup. The roster-stats batch keys by `name|team`; pull the
    // mlbId off the resulting `BatterSeasonStats` so the engine can key by
    // mlbId (matches how the lineup-spot cache keys).
    const statsRecord = await getRosterSeasonStats(
      activeRoster.map(p => ({ name: p.name, team: p.editorial_team_abbr })),
    );
    const statsByMlbId = new Map<number, BatterSeasonStats>();
    for (const s of Object.values(statsRecord)) {
      if (s.mlbId > 0) statsByMlbId.set(s.mlbId, s);
    }

    // Build the active-batters list with mlbIds we resolved. Drop players
    // we couldn't look up — they'd contribute zero anyway and including
    // them only inflates the contributor count.
    const activeBatters: ActiveBatter[] = [];
    for (const p of activeRoster) {
      const key = `${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`;
      const stats = statsRecord[key];
      if (!stats) continue;
      activeBatters.push({
        mlbId: stats.mlbId,
        name: p.name,
        teamAbbr: p.editorial_team_abbr,
      });
    }

    // Build the per-day game lookup. Each entry is the *enriched* slate
    // (park resolved) so the rating engine has everything it needs.
    const gamesByDate = new Map<string, EnrichedGame[]>();
    remaining.forEach((d, i) => {
      const enriched = (gameDayResults[i] ?? []).map(g => ({
        ...g,
        park: getParkByVenueId(g.venue.mlbId) ?? null,
      })) as EnrichedGame[];
      gamesByDate.set(d.date, enriched);
    });

    // Lineup spots from the cache. Single fan-out by mlbId; missing entries
    // fall through to "no signal" inside the engine.
    const lineupSpots = await getCachedLineupSpots(activeBatters.map(b => b.mlbId));

    const deps: ProjectionDeps = {
      days: remaining,
      statsByMlbId,
      gamesByDate,
      scoredCategories,
      lineupSpots,
    };

    const projection = projectBatterTeam(activeBatters, deps);

    // Map → record for JSON.
    const byCategoryRecord: Record<number, { expectedCount: number; expectedPA: number }> = {};
    for (const [statId, cat] of projection.byCategory) {
      byCategoryRecord[statId] = {
        expectedCount: cat.expectedCount,
        expectedPA: cat.expectedPA,
      };
    }
    const perPlayer = projection.perPlayer.map(p => {
      const byCat: Record<number, { expectedCount: number; expectedPA: number }> = {};
      for (const [statId, cat] of p.byCategory) {
        byCat[statId] = { expectedCount: cat.expectedCount, expectedPA: cat.expectedPA };
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

    return NextResponse.json({
      teamKey,
      weekStart,
      weekEnd,
      daysElapsed,
      byCategory: byCategoryRecord,
      perPlayer,
      contributorCount: projection.contributorCount,
    });
  } catch (error) {
    console.error('batter-team projection API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to project batter team' },
      { status: 500 },
    );
  }
}
