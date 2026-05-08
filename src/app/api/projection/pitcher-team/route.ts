import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTeamRoster } from '@/lib/fantasy';
import { getGameDay } from '@/lib/mlb/schedule';
import { getParkByVenueId } from '@/lib/mlb/parks';
import { getEnrichedLeagueStatCategories } from '@/lib/fantasy/stats';
import { getMatchupWeekDays } from '@/lib/dashboard/weekRange';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import {
  projectPitcherTeam,
  type ActivePitcher,
  type PitcherProjectionDeps,
} from '@/lib/projection/pitcherTeam';
import type { EnrichedGame } from '@/lib/mlb/types';

/**
 * GET /api/projection/pitcher-team?teamKey=...&leagueKey=...
 *
 * Forward pitcher-cat projection for the rest of the matchup week. Mirrors
 * `/api/projection/batter-team` for the pitcher side. Filters the team's
 * roster to non-injured pitchers, fans out per-day games (whose probable
 * starters carry stamped talent vectors), and runs `projectPitcherTeam`.
 *
 * Per the design: matching pitchers to probable starts is name-based via
 * `isLikelySamePlayer`, so we don't resolve MLB IDs server-side — the
 * engine matches against the day's slate by name + team.
 *
 * Response shape mirrors the batter route:
 *   {
 *     teamKey, weekStart, weekEnd, daysElapsed,
 *     byCategory: { [statId]: { expectedCount, expectedDenom } },
 *     perPlayer: [{ name, teamAbbr, weeklyScore, weeklyIP,
 *                   expectedStarts, byCategory: {...}, perStart: [...] }],
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

    const [roster, allCategories, gameDayResults] = await Promise.all([
      getTeamRoster(user.id, teamKey),
      getEnrichedLeagueStatCategories(user.id, leagueKey),
      Promise.all(remaining.map(d => getGameDay(d.date))),
    ]);

    const scoredCategories = allCategories.filter(c => c.is_pitcher_stat);

    // Filter to active pitchers: pitchers, not IL/IL+/NA. Mirrors
    // `getRowStatus` so engine and lineup UI agree.
    const activeRoster = roster.filter(p => isPitcher(p) && getRowStatus(p) !== 'injured');

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

    // Build per-day game lookup with park resolution.
    const gamesByDate = new Map<string, EnrichedGame[]>();
    remaining.forEach((d, i) => {
      const enriched = (gameDayResults[i] ?? []).map(g => ({
        ...g,
        park: getParkByVenueId(g.venue.mlbId) ?? null,
      })) as EnrichedGame[];
      gamesByDate.set(d.date, enriched);
    });

    // Name-based matching means we don't need MLB IDs up front. Pass 0
    // as a placeholder; the engine never reads it for matching.
    const activePitchers: ActivePitcher[] = activeRoster.map(p => ({
      mlbId: 0,
      name: p.name,
      teamAbbr: p.editorial_team_abbr,
    }));

    const deps: PitcherProjectionDeps = {
      days: remaining,
      gamesByDate,
      scoredCategories,
    };

    const projection = projectPitcherTeam(activePitchers, deps);

    // Map → record for JSON.
    const byCategoryRecord: Record<number, { expectedCount: number; expectedDenom: number }> = {};
    for (const [statId, cat] of projection.byCategory) {
      byCategoryRecord[statId] = {
        expectedCount: cat.expectedCount,
        expectedDenom: cat.expectedDenom,
      };
    }
    const perPlayer = projection.perPitcher.map(p => {
      const byCat: Record<number, { expectedCount: number; expectedDenom: number }> = {};
      for (const [statId, cat] of p.byCategory) {
        byCat[statId] = { expectedCount: cat.expectedCount, expectedDenom: cat.expectedDenom };
      }
      return {
        name: p.name,
        teamAbbr: p.teamAbbr,
        weeklyScore: p.weeklyScore,
        weeklyIP: p.weeklyIP,
        expectedStarts: p.expectedStarts,
        byCategory: byCat,
        perStart: p.perStart.map(s => ({
          date: s.date,
          dayLabel: s.dayLabel,
          hasStart: s.hasStart,
          doubleHeader: s.doubleHeader,
          opponent: s.opponent,
          isHome: s.isHome,
          parkFactor: s.parkFactor,
          weatherFlag: s.weatherFlag,
          expectedIP: s.expectedIP,
          score: s.rating?.score ?? null,
          tier: s.rating?.tier ?? null,
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
    console.error('/api/projection/pitcher-team failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to project pitcher team' },
      { status: 500 },
    );
  }
}
