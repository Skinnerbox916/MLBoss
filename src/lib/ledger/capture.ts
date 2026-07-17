import { getDb, forecastSnapshots } from '@/lib/db';
import { buildGameForecast } from '@/lib/pitching/forecast';
import { getPitcherRating } from '@/lib/pitching/rating';
import { DEFAULT_SCORED_CATS } from '@/lib/pitching/scoring';
import { getTeamOffense } from '@/lib/mlb/teams';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import { projectBatterPlayer, type ActiveBatter, type ProjectionDeps } from '@/lib/projection/batterTeam';
import type { EnrichedGame } from '@/lib/mlb/types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { PointsStreamingAnalysis } from '@/lib/points/streaming';
import { MODEL_VERSION } from './modelVersion';

/**
 * Forecast capture — the write side of the ledger.
 *
 * A snapshot freezes what an engine predicted BEFORE the outcome exists;
 * rows are immutable and first-write-wins per identity (the DB unique
 * index is the guard). Captures are fire-and-forget from request paths:
 * they must never slow down or fail a page.
 *
 * Engines snapshotted here call the same canonical L1/L2 primitives the
 * product surfaces use — capture never re-implements forecast math.
 */

export type ForecastEngine =
  | 'pitcher-start'
  | 'batter-day'
  | 'points-pitcher-start'
  | 'points-batter-day';

export interface SnapshotRow {
  gameDate: string; // YYYY-MM-DD
  engine: ForecastEngine;
  mlbId: number;
  playerName: string;
  leagueKey?: string;
  predicted: Record<string, number>;
  context: Record<string, unknown>;
}

const round3 = (n: number) => Number(n.toFixed(3));

/** Today's date in ET — MLB game dates are ET-anchored. */
export function todayEt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/** Whole days between ET-today and a game date (0 = day-of, negative → past). */
export function leadDaysFor(gameDate: string): number {
  const ms = Date.parse(`${gameDate}T00:00:00Z`) - Date.parse(`${todayEt()}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export async function insertSnapshots(rows: SnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const lead = new Map(rows.map(r => [r.gameDate, leadDaysFor(r.gameDate)]));
  // Past games can't be forecast — a "snapshot" written after the fact
  // would poison the ledger with hindsight.
  const valid = rows.filter(r => (lead.get(r.gameDate) ?? -1) >= 0);
  if (valid.length === 0) return 0;
  const inserted = await getDb()
    .insert(forecastSnapshots)
    .values(
      valid.map(r => ({
        gameDate: r.gameDate,
        engine: r.engine,
        mlbId: r.mlbId,
        playerName: r.playerName,
        leagueKey: r.leagueKey ?? '',
        leadDays: lead.get(r.gameDate)!,
        predicted: r.predicted,
        context: r.context,
        modelVersion: MODEL_VERSION,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: forecastSnapshots.id });
  return inserted.length;
}

// ---------------------------------------------------------------------------
// Engine: pitcher-start — every probable starter on a slate, league-free
// ---------------------------------------------------------------------------

/** Game statuses it's still honest to forecast from. Anything in-progress
 *  or finished is information leakage, not a prediction. */
const PREGAME_STATUSES = new Set(['Scheduled', 'Pre-Game', 'Warmup', 'Delayed Start']);

/**
 * Snapshot the L2 game forecast (`buildGameForecast`) for every talent-
 * stamped probable on the slate. League-independent raw stat lines —
 * this is the engine-bias workhorse: ~15–30 starts captured per day.
 */
export async function capturePitcherSlate(
  gameDate: string,
  games: EnrichedGame[],
): Promise<number> {
  const rows: SnapshotRow[] = [];
  for (const game of games) {
    if (!PREGAME_STATUSES.has(game.status)) continue;
    for (const isHome of [true, false]) {
      const pp = isHome ? game.homeProbablePitcher : game.awayProbablePitcher;
      if (!pp?.talent || !pp.mlbId) continue;
      const oppTeam = isHome ? game.awayTeam : game.homeTeam;
      const opposing = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;
      const forecast = buildGameForecast({
        pitcher: pp.talent,
        game,
        isHome,
        opposingOffense: await getTeamOffense(oppTeam.mlbId),
        opposingPitcher: opposing?.talent ?? null,
      });
      const g = forecast.expectedPerGame;
      // Composite 0-100 under the league-free default cats — captured so
      // the scorecard can test discrimination (do 80s out-produce 55s?).
      const rating = getPitcherRating({ forecast, scoredCategories: DEFAULT_SCORED_CATS, focusMap: {} });
      rows.push({
        gameDate,
        engine: 'pitcher-start',
        mlbId: pp.mlbId,
        playerName: pp.name,
        predicted: {
          ip: g.ip, pa: g.pa, k: g.k, bb: g.bb, er: g.er, h: g.h, hr: g.hr,
          qs: forecast.probabilities.qs,
          w: forecast.probabilities.w,
          era: forecast.expectedERA,
          xwoba: forecast.xwobaAllowed,
          score: rating.score,
        },
        context: {
          opponentTeamId: oppTeam.mlbId,
          opponentAbbr: oppTeam.abbreviation,
          isHome,
          venue: game.venue.name,
          parkKnown: game.park !== null,
          oppPitcherKnown: opposing?.talent != null,
          // Per-knob attribution: each L2 modifier as applied (>1 boosts
          // the pitcher). Lets the scorecard grade the knob, not just the
          // total — "did starts we park-boosted actually allow fewer runs?"
          mults: Object.fromEntries(
            Object.entries(forecast.multipliers).map(([k, m]) => [k, round3(m.multiplier)]),
          ),
        },
      });
    }
  }
  return insertSnapshots(rows);
}

// ---------------------------------------------------------------------------
// Engine: batter-day — every batter in a posted lineup, league-free
// ---------------------------------------------------------------------------

/**
 * League-free capture vocabulary for the batter engine: the counting cats
 * the L2/L3 batter path supports and an actual game line can grade.
 * (AVG and HBP are derivable from the same graded counts at read time.)
 */
const BATTER_CAPTURE_CATS: EnrichedLeagueStatCategory[] = ([
  [7, 'Runs', 'R'], [8, 'Hits', 'H'], [10, 'Doubles', '2B'], [11, 'Triples', '3B'],
  [12, 'Home Runs', 'HR'], [13, 'Runs Batted In', 'RBI'], [16, 'Stolen Bases', 'SB'],
  [18, 'Walks', 'BB'], [21, 'Strikeouts', 'K'], [23, 'Total Bases', 'TB'],
] as const).map(([stat_id, name, display_name]) => ({
  stat_id, name, display_name, betterIs: 'higher' as const,
  position_types: ['B'], is_batter_stat: true, is_pitcher_stat: false, sort_order: '1',
}));

/** predicted-key ↔ statId mapping, shared with the scorecard's grading. */
export const BATTER_STAT_KEYS: [string, number][] = [
  ['r', 7], ['h', 8], ['doubles', 10], ['triples', 11], ['hr', 12],
  ['rbi', 13], ['sb', 16], ['bb', 18], ['k', 21], ['tb', 23],
];

/**
 * Snapshot the canonical batter day projection (`projectBatterPlayer` —
 * L2 forecast × lineup-spot PA model) for every batter in a POSTED
 * lineup on the slate. Posted-only keeps the sample honest: the engine
 * is graded on days it knew who was playing, and a batter who then
 * doesn't play is a real forecast miss (late scratch), not noise.
 * ~200–300 snapshots per full slate.
 */
export async function captureBatterSlate(
  gameDate: string,
  games: EnrichedGame[],
): Promise<number> {
  const byMlbId = new Map<number, ActiveBatter & { isHome: boolean }>();
  for (const game of games) {
    if (!PREGAME_STATUSES.has(game.status)) continue;
    for (const isHome of [true, false]) {
      const lineup = isHome ? game.homeLineup : game.awayLineup;
      const team = isHome ? game.homeTeam : game.awayTeam;
      for (const entry of lineup) {
        if (entry.mlbId > 0 && !byMlbId.has(entry.mlbId)) {
          byMlbId.set(entry.mlbId, {
            mlbId: entry.mlbId,
            name: entry.fullName,
            teamAbbr: team.abbreviation,
            isHome,
          });
        }
      }
    }
  }
  if (byMlbId.size === 0) return 0;

  const batters = [...byMlbId.values()];
  const statsRecord = await getRosterSeasonStats(
    batters.map(b => ({ name: b.name, team: b.teamAbbr })),
  );
  const statsByMlbId = new Map(
    Object.values(statsRecord).filter(s => s.mlbId > 0).map(s => [s.mlbId, s]),
  );

  const deps: ProjectionDeps = {
    days: [{ date: gameDate, dayLabel: '', dayName: '', isRemaining: true, isToday: gameDate === todayEt() }],
    statsByMlbId,
    gamesByDate: new Map([[gameDate, games]]),
    scoredCategories: BATTER_CAPTURE_CATS,
    lineupSpots: new Map(),
  };

  const rows: SnapshotRow[] = [];
  for (const batter of batters) {
    if (!statsByMlbId.has(batter.mlbId)) continue;
    const proj = projectBatterPlayer(batter, deps);
    const day = proj.perDay[0];
    if (!day?.hasGame || day.expectedPA <= 0 || !day.rating) continue;
    const predicted: Record<string, number> = {
      pa: day.expectedPA,
      score: day.rating.score,
    };
    // Per-stat modifier attribution: adjusted / talent-baseline rate ratio
    // (park + platoon + opp SP + weather + order, combined). >1 = the
    // matchup context boosted this stat above the player's neutral talent.
    const mods: Record<string, number> = {};
    for (const [key, statId] of BATTER_STAT_KEYS) {
      const cat = proj.byCategory.get(statId);
      if (cat) predicted[key] = cat.expectedCount;
      const rated = day.rating.categories.find(c => c.statId === statId);
      if (rated && rated.baseline > 1e-9) mods[key] = round3(rated.expected / rated.baseline);
    }
    rows.push({
      gameDate,
      engine: 'batter-day',
      mlbId: batter.mlbId,
      playerName: batter.name,
      predicted,
      // Slice keys for conditional-bias findings: what the aggregate table
      // averages away (platoon side, park, home/away) is where engines hide
      // their systematic misses.
      context: {
        teamAbbr: batter.teamAbbr,
        isHome: batter.isHome,
        opponent: day.opponent ?? null,
        spot: day.spotUsed,
        spotSource: day.spotSource,
        doubleHeader: day.doubleHeader,
        spThrows: day.spThrows ?? null,
        parkFactor: day.parkFactor ?? null,
        weatherFlag: day.weatherFlag ?? null,
        mods,
      },
    });
  }
  return insertSnapshots(rows);
}

// ---------------------------------------------------------------------------
// Fire-and-forget wrappers for request-path write-through
// ---------------------------------------------------------------------------

// Per-process memo so hot pages don't re-attempt inserts on every request.
// Not a correctness guard (the DB unique index is) — just skips redundant
// work until the process restarts or the lead-day rolls over.
const attempted = new Set<string>();

function inBackground(memoKey: string, run: () => Promise<number>): void {
  if (attempted.has(memoKey)) return;
  attempted.add(memoKey);
  void run().catch(err => {
    attempted.delete(memoKey); // let a later request retry a failed capture
    console.error(`[ledger] capture failed (${memoKey}):`, err);
  });
}

export function capturePitcherSlateInBackground(gameDate: string, games: EnrichedGame[]): void {
  const lead = leadDaysFor(gameDate);
  if (lead < 0) return;
  inBackground(`pitcher-start:${gameDate}:${lead}`, () => capturePitcherSlate(gameDate, games));
}

export function captureBatterSlateInBackground(gameDate: string, games: EnrichedGame[]): void {
  const lead = leadDaysFor(gameDate);
  if (lead < 0) return;
  // Lineups post progressively through the day; keying the memo on how
  // many pregame games have one lets capture re-run as new lineups land
  // (already-captured batters dedupe on the unique index).
  const lineupsPosted = games.filter(
    g => PREGAME_STATUSES.has(g.status) && (g.homeLineup.length > 0 || g.awayLineup.length > 0),
  ).length;
  if (lineupsPosted === 0) return;
  inBackground(`batter-day:${gameDate}:${lead}:${lineupsPosted}`, () =>
    captureBatterSlate(gameDate, games),
  );
}

// ---------------------------------------------------------------------------
// Engines: points-pitcher-start / points-batter-day — write-through from
// the already-computed points streaming analysis (server-ranked)
// ---------------------------------------------------------------------------

/**
 * Map a computed points streaming analysis to snapshot rows. Board rank
 * is part of the FA pitcher context — it's what the rank-quality grade
 * (did the top picks beat the pool?) verifies.
 */
export function pointsSnapshotRows(
  leagueKey: string,
  analysis: PointsStreamingAnalysis,
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];

  analysis.pitcherStreams.forEach((row, i) => {
    if (!row.mlbId) return;
    for (const start of row.starts) {
      rows.push({
        gameDate: start.date,
        engine: 'points-pitcher-start',
        mlbId: row.mlbId,
        playerName: row.name,
        leagueKey,
        predicted: { points: start.expectedPoints, pointsPerIP: row.pointsPerIP },
        context: { opp: start.opp, owned: false, rank: i + 1, cadence: analysis.cadence },
      });
    }
  });

  for (const row of analysis.myPitcherFacts) {
    if (!row.mlbId) continue;
    for (const start of row.starts) {
      rows.push({
        gameDate: start.date,
        engine: 'points-pitcher-start',
        mlbId: row.mlbId,
        playerName: row.name,
        leagueKey,
        predicted: { points: start.expectedPoints },
        context: { opp: start.opp, owned: true, cadence: analysis.cadence },
      });
    }
  }

  analysis.batterFacts.forEach(row => {
    if (!row.mlbId) return;
    row.dayPoints.forEach((points, i) => {
      const day = analysis.days[i];
      if (!day || points <= 0) return;
      rows.push({
        gameDate: day.date,
        engine: 'points-batter-day',
        mlbId: row.mlbId!,
        playerName: row.name,
        leagueKey,
        predicted: { points },
        context: { owned: row.owned, injured: row.injured },
      });
    });
  });

  return rows;
}

export function capturePointsInBackground(
  leagueKey: string,
  analysis: PointsStreamingAnalysis,
): void {
  const windowStart = analysis.days[0]?.date;
  if (!windowStart) return;
  const memoKey = `points:${leagueKey}:${windowStart}:${leadDaysFor(windowStart)}`;
  inBackground(memoKey, () => insertSnapshots(pointsSnapshotRows(leagueKey, analysis)));
}
