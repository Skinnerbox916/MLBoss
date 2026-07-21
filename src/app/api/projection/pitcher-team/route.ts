import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTeamRosterByDate, getWeekBounds, withCacheGated, CACHE_CATEGORIES } from '@/lib/fantasy';
import { getGameDay } from '@/lib/mlb/schedule';
import { getParkByVenueId } from '@/lib/mlb/parks';
import { getEnrichedLeagueStatCategories } from '@/lib/fantasy/stats';
import { getWeekDays, type WeekTarget } from '@/lib/dashboard/weekRange';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import {
  projectPitcherTeam,
  type ActivePitcher,
  type PitcherProjectionDeps,
} from '@/lib/projection/pitcherTeam';
import { isStartConcluded } from '@/lib/mlb/gameState';
import { resolveMLBId } from '@/lib/mlb/identity';
import { getPitcherSeasonLines, getPitcherOverallLines } from '@/lib/mlb/players';
import { fetchStatcastPitchers } from '@/lib/mlb/savant';
import { computePitcherTalent } from '@/lib/pitching/talent';
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

    // See sibling batter-team route for the `targetWeek=next` rationale
    // (Sunday streaming pivot — describe next week's matchup, not the
    // closed one).
    const targetWeek: WeekTarget = searchParams.get('targetWeek') === 'next' ? 'next' : 'current';

    // Real matchup-week bounds (Yahoo game_weeks) — the window is 7 days
    // normally, up to 14 in the combined all-star week.
    const weekBounds = await getWeekBounds(user.id, leagueKey);
    // Cache the assembled projection (see sibling batter-team route). Fanned
    // out by useCorrectedMatchupAnalysis (my+opp); 5-min TTL; single-flight
    // collapses concurrent my/opp calls. Coverage-gated like the batter
    // sibling (docs/data-architecture.md#quality-gate) so a partial
    // talent/stats run isn't pinned for the full TTL.
    const payload = await withCacheGated(
      `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:proj-pitcher-team:${teamKey}:${targetWeek}:${weekBounds?.end ?? 'legacy'}`,
      CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
      async () => {
    const days = getWeekDays(new Date(), targetWeek, weekBounds);
    const remaining = days.filter(d => d.isRemaining);
    const weekStart = days[0]?.date;
    const weekEnd = days[days.length - 1]?.date;
    const daysElapsed = days.filter(d => !d.isRemaining).length;

    const empty = {
      teamKey, weekStart, weekEnd, daysElapsed,
      byCategory: {}, perPlayer: [], perReliever: [],
      weeklySpIp: 0, weeklyRpIp: 0, weeklyIp: 0, contributorCount: 0,
      rosterPitcherCount: 0, resolvedPitcherCount: 0,
    };
    if (remaining.length === 0) return empty;

    // Roster as of the LAST remaining day of the matchup week — captures
    // pickups effective for upcoming starts that aren't on today's roster
    // snapshot yet. See `docs/history.md` "Always-fetch-roster-by-date".
    const rosterDate = remaining[remaining.length - 1]!.date;
    const [roster, allCategories, gameDayResults] = await Promise.all([
      getTeamRosterByDate(user.id, teamKey, rosterDate),
      getEnrichedLeagueStatCategories(user.id, leagueKey),
      Promise.all(remaining.map(d => getGameDay(d.date))),
    ]);

    const scoredCategories = allCategories.filter(c => c.is_pitcher_stat);

    // Filter to active pitchers: pitchers, not IL/IL+/NA. Mirrors
    // `getRowStatus` so engine and lineup UI agree.
    const activeRoster = roster.filter(p => isPitcher(p) && getRowStatus(p) !== 'injured');

    if (activeRoster.length === 0) return empty;

    // Build per-day game lookup with park resolution. For TODAY's slate
    // we drop any games whose SP has already concluded (or won't happen)
    // so the projection doesn't double-count IP that's already booked or
    // forever-zero. See [[reference-mlboss-deployment]] for the Boss
    // Card design that motivates this filter.
    const gamesByDate = new Map<string, EnrichedGame[]>();
    remaining.forEach((d, i) => {
      const enriched = (gameDayResults[i] ?? []).map(g => ({
        ...g,
        park: getParkByVenueId(g.venue.mlbId) ?? null,
      })) as EnrichedGame[];
      const filtered = d.isToday
        ? enriched.filter(g => !isStartConcluded(g.status))
        : enriched;
      gamesByDate.set(d.date, filtered);
    });

    // Resolve per-pitcher talent up front. Starters DON'T strictly need
    // this (the projection engine reads their talent off the probable
    // pitcher object stamped on each day's slate), but relievers do —
    // they never appear as probables and the only way to project them
    // is via talent supplied in `ActivePitcher.talent`. Doing this for
    // all pitchers unifies the talent path and lets the engine route by
    // `talent.role` cleanly. Falls back to no-talent (engine handles as
    // SP-via-probable) when resolution fails.
    const season = new Date().getFullYear();
    const [savantCurrent, savantPrior] = await Promise.all([
      fetchStatcastPitchers(season),
      fetchStatcastPitchers(season - 1),
    ]);
    const activePitchers: ActivePitcher[] = await Promise.all(
      activeRoster.map(async (p): Promise<ActivePitcher> => {
        const identity = await resolveMLBId(p.name, p.editorial_team_abbr);
        if (!identity) {
          return { mlbId: 0, name: p.name, teamAbbr: p.editorial_team_abbr };
        }
        const [seasonLines, overallLines] = await Promise.all([
          getPitcherSeasonLines(identity.mlbId, season),
          getPitcherOverallLines(identity.mlbId, season),
        ]);
        const talent = computePitcherTalent({
          mlbId: identity.mlbId,
          throws: identity.throws,
          currentLine: seasonLines.current,
          priorLine: seasonLines.prior,
          currentSavant: savantCurrent.get(identity.mlbId) ?? null,
          priorSavant: savantPrior.get(identity.mlbId) ?? null,
          currentOverall: overallLines.current,
          priorOverall: overallLines.prior,
        });
        return {
          mlbId: identity.mlbId,
          name: p.name,
          teamAbbr: p.editorial_team_abbr,
          talent,
        };
      }),
    );

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

    const perReliever = projection.perReliever.map(p => {
      const byCat: Record<number, { expectedCount: number; expectedDenom: number }> = {};
      for (const [statId, cat] of p.byCategory) {
        byCat[statId] = { expectedCount: cat.expectedCount, expectedDenom: cat.expectedDenom };
      }
      return {
        name: p.name,
        teamAbbr: p.teamAbbr,
        expectedAppearances: p.expectedAppearances,
        weeklyIP: p.weeklyIP,
        byCategory: byCat,
      };
    });

    return {
      teamKey,
      weekStart,
      weekEnd,
      daysElapsed,
      byCategory: byCategoryRecord,
      perPlayer,
      perReliever,
      weeklySpIp: projection.weeklySpIp,
      weeklyRpIp: projection.weeklyRpIp,
      weeklyIp: projection.weeklyIp,
      contributorCount: projection.contributorCount,
      rosterPitcherCount: activeRoster.length,
      resolvedPitcherCount: activePitchers.filter(p => p.mlbId > 0).length,
    };
      },
      // Gate on the identity/talent-RESOLUTION stage, NOT contributorCount —
      // an SP between starts legitimately contributes 0 in a short window.
      p => p.resolvedPitcherCount >= Math.ceil(p.rosterPitcherCount * 0.7),
    );

    return NextResponse.json(payload);
  } catch (error) {
    console.error('/api/projection/pitcher-team failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to project pitcher team' },
      { status: 500 },
    );
  }
}
