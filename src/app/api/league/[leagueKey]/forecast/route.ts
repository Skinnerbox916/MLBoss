import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getLeagueStandings, getTeamRoster, getTeamRosterByDate } from '@/lib/fantasy';
import { getTeamStatsSeason } from '@/lib/fantasy/teamStats';
import { getLeagueRosterPositions } from '@/lib/fantasy/roster';
import { getAvailableBatters } from '@/lib/fantasy/players';
import { getEnrichedLeagueStatCategories, type EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import {
  getRosterSeasonStats,
  getPitcherTalentBatch,
  hashCode,
  type PitcherTalentWithMetadata,
} from '@/lib/mlb/players';
import { getObservedLineupSpots } from '@/lib/mlb/lineupSpots';
import { isPitcher } from '@/components/lineup/types';
import { withCache, CACHE_CATEGORIES } from '@/lib/fantasy/cache';
import {
  projectPitcherTeamNeutral,
  projectBatterNeutral,
  buildNeutralBatterContext,
  type NeutralPitcherEntry,
  type NeutralBatterDeps,
} from '@/lib/projection/neutralWeek';
import type { ActiveBatter, PlayerProjection } from '@/lib/projection/batterTeam';
import type { ActivePitcher } from '@/lib/projection/pitcherTeam';
import {
  assignStarters,
  parseStartingSlots,
  getBatterPositions,
  type ScoredPlayer,
  type StartingSlots,
} from '@/lib/roster/depth';
import { blendedCategoryScore } from '@/lib/roster/scoring';
import {
  computeLeagueForecast,
  isRatioCat,
  type TeamAggregate,
  type ProjectedCategoryAgg,
  type LeagueForecast,
} from '@/lib/league/forecast';
import { computeRupm } from '@/lib/league/rupm';
import { computeTeamEngagements } from '@/lib/league/engagement';
import type { BatterSeasonStats } from '@/lib/mlb/types';

/**
 * GET /api/league/[leagueKey]/forecast?teamKey=...
 *
 * L6 roster strategy — talent-only, neutral-context, matchup-vacuum
 * per-category position vs the rest of the league. Drives the roster
 * page's chase / hold / punt for ROS roster construction decisions.
 *
 * Each team's per-cat projection is computed by running the rating
 * engines against a synthetic neutral matchup (`buildNeutralGame`) and
 * scaling per-PA / per-IP rates by observed YTD pace. See
 * [docs/roster-strategy.md](../../../../../docs/roster-strategy.md) and
 * [src/lib/projection/neutralWeek.ts](../../../../lib/projection/neutralWeek.ts).
 *
 * Caching strategy:
 *  - The expensive part is the per-team fan-out (rosters + season stats
 *    + pitcher talent batch for every team). That's cached once per
 *    league at SEMI_DYNAMIC.ttlLong (1 h). Cache key is league-scoped
 *    and not date-scoped — the projection depends only on rosters and
 *    season stats, not on what day it is.
 *  - The key also carries a fingerprint of the viewer's current roster
 *    (60 s dynamic-tier fetch), so the viewer's own adds/drops force a
 *    bundle recompute within a minute instead of waiting out the hour.
 *    Other teams' moves still lag up to the full TTL, which is fine —
 *    the league-wide talent pool shifts slowly.
 *  - The cheap part is the league-wide rank/z/outlier math, which
 *    depends on `myTeamKey`. Runs on every request after the aggregates
 *    load, takes <1 ms.
 *
 * Returns `LeagueForecast` (see `src/lib/league/forecast.ts`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ leagueKey: string }> },
) {
  try {
    const session = await getSession();
    if (!session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;
    const { leagueKey } = await params;

    const { searchParams } = new URL(request.url);
    const teamKey = searchParams.get('teamKey');
    if (!teamKey) {
      return NextResponse.json({ error: 'teamKey is required' }, { status: 400 });
    }

    // Cache only the aggregates — they're identical regardless of viewer.
    // The viewer's roster fingerprints the key (see header comment): the
    // roster read is warm because the roster page fetches it in parallel.
    const myRoster = await getTeamRoster(user.id, teamKey);
    const rosterFp = hashCode(myRoster.map(p => p.player_key).sort().join(','));

    const aggregateBundle = await withCache(
      `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:league-forecast-aggregates:${leagueKey}:${rosterFp}`,
      CACHE_CATEGORIES.SEMI_DYNAMIC.ttlLong,
      () => computeAggregateBundle(user.id, leagueKey),
    );

    const result: LeagueForecast = computeLeagueForecast({
      myTeamKey: teamKey,
      teams: aggregateBundle.teams,
      categories: aggregateBundle.categories,
      rupmByStatId: new Map(aggregateBundle.rupm),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('league forecast API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute league forecast' },
      { status: 500 },
    );
  }
}

interface AggregateBundle {
  teams: TeamAggregate[];
  categories: EnrichedLeagueStatCategory[];
  /** Per-cat RUPM (Replacement Upgrade Per Move) — league-wide constant
   *  per stat_id. Serialized as `[statId, rupm][]` for JSON cache
   *  roundtripping (Map doesn't survive JSON.stringify). */
  rupm: Array<[number, number]>;
}

/**
 * Top-K and bottom-K used for RUPM. K=10 captures the realistic upgrade
 * pool (top ~10 FAs at a cat) and the realistic drop pool (the bottom
 * ~10 rostered hitters across the league) without single-point noise.
 */
const RUPM_K = 10;

/**
 * Scale each team's counting-cat aggregates by its engagement ratio.
 * Ratio cats are left unchanged (they're volume-invariant). Teams with
 * `engagementRatio === 0` (no signal) are skipped — keeps the model
 * defensive when team_stats fetch fails for one team.
 */
function applyEngagement(
  teams: TeamAggregate[],
  engagementByTeamKey: Map<string, number>,
  batterCategories: EnrichedLeagueStatCategory[],
): void {
  const ratioStatIds = new Set(
    batterCategories.filter(c => isRatioCat(c)).map(c => c.stat_id),
  );
  for (const team of teams) {
    const ratio = engagementByTeamKey.get(team.teamKey);
    if (!ratio || ratio === 0 || ratio === 1) continue;
    for (const [statId, agg] of Object.entries(team.byCategory)) {
      const id = Number(statId);
      if (ratioStatIds.has(id)) continue; // rate cats unaffected by volume
      agg.expectedCount *= ratio;
      agg.expectedDenom *= ratio;
    }
  }
}

async function computeAggregateBundle(
  userId: string,
  leagueKey: string,
): Promise<AggregateBundle> {
  // Shared invariants across teams: standings, categories, lineup config.
  // The starting-slot config caps each team's batter projection at the
  // league's daily lineup capacity — a 14-hitter roster doesn't get
  // credit for stats that 4 bench players would never accumulate.
  const [standings, allCategories, rosterPositions] = await Promise.all([
    getLeagueStandings(userId, leagueKey),
    getEnrichedLeagueStatCategories(userId, leagueKey),
    getLeagueRosterPositions(userId, leagueKey),
  ]);

  const scoredCategories = allCategories.filter(c => c.is_batter_stat || c.is_pitcher_stat);
  const batterCategories = scoredCategories.filter(c => c.is_batter_stat);
  const pitcherCategories = scoredCategories.filter(c => c.is_pitcher_stat);
  const startingSlots = parseStartingSlots(rosterPositions);

  // Per-team fan-out runs in parallel with the FA pool fetch — the two
  // are independent and both feed the RUPM calc below.
  const [teamResults, faProjections] = await Promise.all([
    Promise.all(
      standings.map(team => projectOneTeam({
        userId,
        teamKey: team.team_key,
        teamName: team.name,
        batterCategories,
        pitcherCategories,
        startingSlots,
      })),
    ),
    projectFreeAgents({ userId, leagueKey, batterCategories }),
  ]);

  const teams = teamResults.map(r => r.aggregate);

  // Engagement multiplier — scales each team's counting cats by their
  // manager engagement (YTD PA accrued / league-top PA accrued). Catches
  // the "set-and-forget manager" variance that talent modeling alone
  // can't see. See [engagement.ts](../../../lib/league/engagement.ts).
  const teamStatsAll = await Promise.all(
    standings.map(t => getTeamStatsSeason(userId, t.team_key).catch(() => null)),
  );
  const engagements = computeTeamEngagements(
    standings.map((t, i) => ({
      teamKey: t.team_key,
      teamName: t.name,
      stats: teamStatsAll[i],
    })),
  );
  const engagementByTeamKey = new Map(engagements.map(e => [e.teamKey, e.engagementRatio]));
  applyEngagement(teams, engagementByTeamKey, batterCategories);

  // Pool all rostered batter projections across the league for the
  // RUPM "bottom-K" reference. Includes both starters and bench —
  // bench is the realistic drop pool.
  const allRosteredBatters = teamResults.flatMap(r => r.batterProjections);

  const rupmMap = computeRupm({
    rosteredProjections: allRosteredBatters,
    faProjections,
    categories: batterCategories,
    k: RUPM_K,
  });
  const rupm = Array.from(rupmMap.entries());

  return { teams, categories: scoredCategories, rupm };
}

/**
 * Fetch the league's batter FA pool and project each at neutral-week
 * volume. Uses the same `getAvailableBatters` cache the roster page
 * populates (5-min TTL), so the marginal cost of running this from
 * the forecast route is small on a warm session.
 */
async function projectFreeAgents(args: {
  userId: string;
  leagueKey: string;
  batterCategories: EnrichedLeagueStatCategory[];
}): Promise<PlayerProjection[]> {
  const { userId, leagueKey, batterCategories } = args;

  const fas = await getAvailableBatters(userId, leagueKey);
  if (fas.length === 0) return [];

  const statsRecord = await getRosterSeasonStats(
    fas.map(p => ({ name: p.name, team: p.editorial_team_abbr })),
  );
  const statsByMlbId = new Map<number, BatterSeasonStats>();
  for (const s of Object.values(statsRecord)) {
    if (s.mlbId > 0) statsByMlbId.set(s.mlbId, s);
  }

  const activeFAs: ActiveBatter[] = [];
  for (const p of fas) {
    const key = `${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`;
    const stats = statsRecord[key];
    if (!stats) continue;
    activeFAs.push({
      mlbId: stats.mlbId,
      name: p.name,
      teamAbbr: p.editorial_team_abbr,
    });
  }

  if (activeFAs.length === 0) return [];

  const lineupSpots = await getObservedLineupSpots(activeFAs.map(b => b.mlbId));
  const deps: NeutralBatterDeps = {
    scoredCategories: batterCategories,
    statsByMlbId,
    lineupSpots,
  };
  const reusableContext = buildNeutralBatterContext();

  const projections: PlayerProjection[] = [];
  for (const fa of activeFAs) {
    const proj = projectBatterNeutral(fa, deps, reusableContext);
    if (proj) projections.push(proj);
  }
  return projections;
}

interface TeamProjectionResult {
  aggregate: TeamAggregate;
  /** ALL eligible roster batters projected at neutral-week volume —
   *  includes starters AND bench. Used by the league-wide RUPM calc
   *  to find the "bottom-K rostered" replacement-level reference
   *  (bench is the realistic drop pool). */
  batterProjections: PlayerProjection[];
}

async function projectOneTeam(input: {
  userId: string;
  teamKey: string;
  teamName: string;
  batterCategories: EnrichedLeagueStatCategory[];
  pitcherCategories: EnrichedLeagueStatCategory[];
  startingSlots: StartingSlots;
}): Promise<TeamProjectionResult> {
  const { userId, teamKey, teamName, batterCategories, pitcherCategories, startingSlots } = input;

  // Roster as of today — no need to peek at a future date the way the
  // old schedule-aware path did, because the neutral projection doesn't
  // depend on a specific game day. Today's snapshot is the truth.
  const today = new Date().toISOString().slice(0, 10);
  const roster = await getTeamRosterByDate(userId, teamKey, today);

  // IL players DO count toward roster strength in the matchup-vacuum
  // frame. The premise: they'll be back to producing on a weekly
  // basis (or the team would have dropped them). Excluding them
  // asymmetrically hurts teams stashing studs on IL — Full count
  // without Acuña doesn't reflect Full count's real SB power.
  //
  // The starting-lineup optimizer (`assignStarters` below) still
  // caps each team at the league's daily starting capacity, so IL
  // players compete with healthy players for those slots based on
  // talent. Low-talent stash candidates don't make the cut.
  const activeBatRoster = roster.filter(p => !isPitcher(p));
  const activePitRoster = roster.filter(p => isPitcher(p));

  const byCategory: Record<number, ProjectedCategoryAgg> = {};
  let batterProjections: PlayerProjection[] = [];

  // ---- Batter side --------------------------------------------------
  //
  // Three-step:
  //   1. Build paired (ActiveBatter, ScoredPlayer) entries for every
  //      eligible roster batter. Score is focus-neutral talent (empty
  //      focusMap, ptf=1) so the optimizer picks the best players for
  //      the league as a whole, not the user's chosen strategy.
  //   2. Project EVERY eligible batter (starters + bench) at neutral
  //      volume. The full set is needed for the league-wide RUPM
  //      "bottom-K rostered" reference. Only starters contribute to
  //      the team aggregate that feeds the per-cat rankings.
  //   3. Run `assignStarters` to pick the optimal starting lineup
  //      under position constraints, and aggregate only those.
  //
  // The starting-lineup cap is load-bearing — a 14-hitter roster
  // doesn't get 14 hitters' worth of weekly PA in its team total;
  // only the 10 that would actually fill the starting slots.
  if (activeBatRoster.length > 0 && batterCategories.length > 0) {
    const statsRecord = await getRosterSeasonStats(
      activeBatRoster.map(p => ({ name: p.name, team: p.editorial_team_abbr })),
    );
    const statsByMlbId = new Map<number, BatterSeasonStats>();
    for (const s of Object.values(statsRecord)) {
      if (s.mlbId > 0) statsByMlbId.set(s.mlbId, s);
    }

    interface BatterEntry { active: ActiveBatter; scored: ScoredPlayer }
    const entries: BatterEntry[] = [];
    for (const p of activeBatRoster) {
      const key = `${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`;
      const stats = statsRecord[key];
      if (!stats) continue;
      const eligibleBatterPositions = getBatterPositions(p.eligible_positions);
      if (eligibleBatterPositions.length === 0) continue;
      entries.push({
        active: {
          mlbId: stats.mlbId,
          name: p.name,
          teamAbbr: p.editorial_team_abbr,
        },
        scored: {
          player_key: p.player_key,
          name: p.name,
          eligibleBatterPositions,
          score: blendedCategoryScore(stats, batterCategories, 1, false, {}),
          raw: p,
        },
      });
    }

    if (entries.length > 0) {
      // Project ALL eligible batters once (used by both the team
      // aggregate and the league-wide RUPM pool).
      const lineupSpots = await getObservedLineupSpots(entries.map(e => e.active.mlbId));
      const deps: NeutralBatterDeps = {
        scoredCategories: batterCategories,
        statsByMlbId,
        lineupSpots,
      };
      const reusableContext = buildNeutralBatterContext();
      const projByMlbId = new Map<number, PlayerProjection>();
      for (const e of entries) {
        const proj = projectBatterNeutral(e.active, deps, reusableContext);
        if (proj) projByMlbId.set(e.active.mlbId, proj);
      }
      batterProjections = Array.from(projByMlbId.values());

      // Pick optimal starters under position constraints.
      const assignment = assignStarters(entries.map(e => e.scored), startingSlots);
      const starterMlbIds = new Set(
        entries
          .filter(e => assignment.assignedKeys.has(e.scored.player_key))
          .map(e => e.active.mlbId),
      );

      // Aggregate starters only into the team total.
      for (const proj of batterProjections) {
        if (!starterMlbIds.has(proj.mlbId)) continue;
        for (const [statId, cat] of proj.byCategory) {
          const prior = byCategory[statId];
          if (prior) {
            prior.expectedCount += cat.expectedCount;
            prior.expectedDenom += cat.expectedDenom;
          } else {
            byCategory[statId] = {
              expectedCount: cat.expectedCount,
              expectedDenom: cat.expectedDenom,
            };
          }
        }
      }
    }
  }

  // ---- Pitcher side -------------------------------------------------
  if (activePitRoster.length > 0 && pitcherCategories.length > 0) {
    const talentRecord = await getPitcherTalentBatch(
      activePitRoster.map(p => ({ name: p.name, team: p.editorial_team_abbr })),
    );
    const talentByNameTeam = new Map<string, NeutralPitcherEntry>();
    for (const [key, entry] of Object.entries(talentRecord) as [
      string,
      PitcherTalentWithMetadata,
    ][]) {
      talentByNameTeam.set(key, {
        talent: entry.talent,
        role: entry.metadata.role,
        isGhost: entry.metadata.isGhost,
        seasonGS: entry.metadata.seasonGS,
        seasonIP: entry.metadata.seasonIP,
      });
    }

    const activePitchers: ActivePitcher[] = activePitRoster.map(p => ({
      mlbId: 0,
      name: p.name,
      teamAbbr: p.editorial_team_abbr,
    }));
    const proj = projectPitcherTeamNeutral(activePitchers, {
      scoredCategories: pitcherCategories,
      talentByNameTeam,
    });
    for (const [statId, cat] of proj.byCategory) {
      byCategory[statId] = { expectedCount: cat.expectedCount, expectedDenom: cat.expectedDenom };
    }
  }

  return {
    aggregate: { teamKey, teamName, byCategory },
    batterProjections,
  };
}
