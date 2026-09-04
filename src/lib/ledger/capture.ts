import { sql } from 'drizzle-orm';
import { getDb, forecastSnapshots } from '@/lib/db';
import { buildGameForecast, type PitcherKnobStat } from '@/lib/pitching/forecast';
import { getPitcherRating } from '@/lib/pitching/rating';
import { DEFAULT_SCORED_CATS } from '@/lib/pitching/scoring';
import { getTeamOffense } from '@/lib/mlb/teams';
import { getRosterSeasonStats } from '@/lib/mlb/players';
import {
  projectBatterPlayer,
  type ActiveBatter,
  type ProjectionDeps,
  type PlayerProjection,
} from '@/lib/projection/batterTeam';
import type { EnrichedGame } from '@/lib/mlb/types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { PointsStreamingAnalysis } from '@/lib/points/streaming';
import { MODEL_VERSION } from './modelVersion';

/**
 * Forecast capture — the write side of the ledger.
 *
 * A snapshot freezes what an engine predicted BEFORE the outcome exists;
 * live rows are immutable and first-write-wins per identity (the DB unique
 * index is the guard). Captures are fire-and-forget from request paths:
 * they must never slow down or fail a page.
 *
 * Retro rows (`retro-*` engines) are the one exception: they are
 * RECONSTRUCTIONS computed from the rebuildable `statcast_events` corpus,
 * not observations, so a re-run REPLACES the row under the same identity
 * (upsert) and stamps the current MODEL_VERSION. See
 * docs/forecast-verification.md#retro-rows-are-reconstructions.
 *
 * Engines snapshotted here call the same canonical L1/L2 primitives the
 * product surfaces use — capture never re-implements forecast math.
 */

export type ForecastEngine =
  | 'pitcher-start'
  | 'batter-day'
  | 'batter-week'
  | 'points-pitcher-start'
  | 'points-batter-day'
  // Retro twins: the same engines run after the fact on as-of inputs
  // (src/lib/retro/). Separate keys so they never pool with live captures.
  | 'retro-pitcher-start'
  | 'retro-batter-day';

export const isRetroEngine = (engine: string): boolean => engine.startsWith('retro-');

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
/** Pitcher knobs move ~1-2% per start (log-SD ≈ 0.02); 3 decimals would
 *  quantise them at a tenth of that spread, so they keep one more. */
const round4 = (n: number) => Number(n.toFixed(4));

/** Today's date in ET — MLB game dates are ET-anchored. */
export function todayEt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/** Whole days between ET-today and a game date (0 = day-of, negative → past). */
export function leadDaysFor(gameDate: string): number {
  const ms = Date.parse(`${gameDate}T00:00:00Z`) - Date.parse(`${todayEt()}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday starting the current-or-next Mon–Sun window (today, if Monday). */
export function nextMondayEt(): string {
  const today = todayEt();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysIso(today, (8 - dow) % 7);
}

export async function insertSnapshots(rows: SnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const lead = new Map(rows.map(r => [r.gameDate, leadDaysFor(r.gameDate)]));
  // Past games can't be forecast — a "snapshot" written after the fact
  // would poison the ledger with hindsight. Retro engines are the explicit
  // exception: they ARE after-the-fact rebuilds, keyed separately, with a
  // nominal lead of 0 (the concept doesn't apply to them).
  const valid = rows.filter(r => isRetroEngine(r.engine) || (lead.get(r.gameDate) ?? -1) >= 0);
  if (valid.length === 0) return 0;
  const toValues = (rs: SnapshotRow[]) =>
    rs.map(r => ({
      gameDate: r.gameDate,
      engine: r.engine,
      mlbId: r.mlbId,
      playerName: r.playerName,
      leagueKey: r.leagueKey ?? '',
      leadDays: isRetroEngine(r.engine) ? 0 : lead.get(r.gameDate)!,
      predicted: r.predicted,
      context: r.context,
      modelVersion: MODEL_VERSION,
    }));
  const live = valid.filter(r => !isRetroEngine(r.engine));
  const retro = valid.filter(r => isRetroEngine(r.engine));
  let written = 0;
  if (live.length) {
    // Observations: first write wins, forever.
    const inserted = await getDb()
      .insert(forecastSnapshots)
      .values(toValues(live))
      .onConflictDoNothing()
      .returning({ id: forecastSnapshots.id });
    written += inserted.length;
  }
  if (retro.length) {
    // Reconstructions: the current build's rebuild of that date replaces
    // any earlier one under the same identity. Scoped by construction —
    // only rows whose engine key starts with 'retro-' reach this branch.
    const upserted = await getDb()
      .insert(forecastSnapshots)
      .values(toValues(retro))
      .onConflictDoUpdate({
        target: [
          forecastSnapshots.gameDate,
          forecastSnapshots.engine,
          forecastSnapshots.mlbId,
          forecastSnapshots.leagueKey,
          forecastSnapshots.leadDays,
        ],
        set: {
          playerName: sql`excluded.player_name`,
          predicted: sql`excluded.predicted`,
          context: sql`excluded.context`,
          modelVersion: sql`excluded.model_version`,
          capturedAt: sql`now()`,
        },
      })
      .returning({ id: forecastSnapshots.id });
    written += upserted.length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Engine: pitcher-start — every probable starter on a slate, league-free
// ---------------------------------------------------------------------------

/** Game statuses it's still honest to forecast from. Anything in-progress
 *  or finished is information leakage, not a prediction. */
const PREGAME_STATUSES = new Set(['Scheduled', 'Pre-Game', 'Warmup', 'Delayed Start']);

/**
 * Only regular-season games are gradable. The All-Star game is `gameType`
 * 'A' and is a real trap: its "probable starters" and posted lineup look
 * exactly like a normal slate, so without this guard an exhibition lands in
 * the ledger and is graded against a game log that (rightly) never counts
 * it. Games with no `gameType` are admitted — the field is optional and its
 * absence means the source didn't say, not that the game is exhibition.
 */
const isGradableGame = (g: { gameType?: string }) => g.gameType == null || g.gameType === 'R';

/**
 * Snapshot the L2 game forecast (`buildGameForecast`) for every talent-
 * stamped probable on the slate. League-independent raw stat lines —
 * this is the engine-bias workhorse: ~15–30 starts captured per day.
 */
export interface SlateCaptureOptions {
  /** Engine key to stamp — the live default or its retro twin. */
  engine?: 'pitcher-start' | 'retro-pitcher-start' | 'batter-day' | 'retro-batter-day';
  /** Retro: the slate is historical, so every game is Final — skip the
   *  pregame-only honesty guard (the as-of context supplies the honesty). */
  includeFinal?: boolean;
}

export async function capturePitcherSlate(
  gameDate: string,
  games: EnrichedGame[],
  opts: SlateCaptureOptions = {},
): Promise<number> {
  const engine = (opts.engine ?? 'pitcher-start') as 'pitcher-start' | 'retro-pitcher-start';
  const rows: SnapshotRow[] = [];
  for (const game of games) {
    if (!isGradableGame(game)) continue;
    if (!opts.includeFinal && !PREGAME_STATUSES.has(game.status)) continue;
    for (const isHome of [true, false]) {
      const pp = isHome ? game.homeProbablePitcher : game.awayProbablePitcher;
      if (!pp?.talent || !pp.mlbId) continue;
      const oppTeam = isHome ? game.awayTeam : game.homeTeam;
      const ownTeam = isHome ? game.homeTeam : game.awayTeam;
      const opposing = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;
      const forecast = buildGameForecast({
        pitcher: pp.talent,
        game,
        isHome,
        opposingOffense: await getTeamOffense(oppTeam.mlbId),
        opposingPitcher: opposing?.talent ?? null,
        ownOffense: await getTeamOffense(ownTeam.mlbId),
      });
      const g = forecast.expectedPerGame;
      // Composite 0-100 under the league-free default cats — captured so
      // the scorecard can test discrimination (do 80s out-produce 55s?).
      const rating = getPitcherRating({ forecast, scoredCategories: DEFAULT_SCORED_CATS, focusMap: {} });
      // Per-stat modifier attribution (2026-09-04), the same shape as the
      // batter rows: `knobs.<knob>.<stat>` is the multiplier that knob
      // applied to that stat's RATE (per PA for k/bb/hr/h, per 9 for er;
      // ip/pa are the volume terms, moved by opp only), and `mods.<stat>`
      // is their product — in-game rate ÷ talent rate. Rate, not count:
      // predicted.k = rate × forecast PA, so pred ÷ mods is the talent
      // rate at the forecast exposure, exactly as on the batter side.
      const knobs: Record<string, Record<string, number>> = {};
      const mods: Record<string, number> = {};
      for (const [knob, perStat] of Object.entries(forecast.knobs)) {
        for (const [stat, mult] of Object.entries(perStat ?? {}) as [PitcherKnobStat, number][]) {
          if (!Number.isFinite(mult)) continue;
          (knobs[knob] ??= {})[stat] = round4(mult);
          mods[stat] = (mods[stat] ?? 1) * mult;
        }
      }
      for (const stat of Object.keys(mods)) mods[stat] = round4(mods[stat]);
      rows.push({
        gameDate,
        engine,
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
          // Breakdown-UI multipliers, one scalar per knob for the whole
          // start (>1 boosts the pitcher). Kept for the scorecard's knob
          // slices and for continuity with pre-2026-09-04 rows, but NOT
          // what the forecast applies: `platoon`/`velocity` never touch a
          // stat line and `opp`/`platoon` read the same OPS scalar. The
          // fit reads `knobs` / `mods` below.
          mults: Object.fromEntries(
            Object.entries(forecast.multipliers).map(([k, m]) => [k, round3(m.multiplier)]),
          ),
          knobs,
          mods,
          // P(W) decomposition (2026-07-25): lets the next calibration
          // pass grade P(team win), credit share, and the run rates
          // separately — the first W pass had to reverse-engineer the
          // total and couldn't isolate which part was wrong.
          wParts: {
            pTeam: round3(forecast.probabilities.wParts.pTeam),
            credit: round3(forecast.probabilities.wParts.credit),
            rs: round3(forecast.probabilities.wParts.rs),
            ra: round3(forecast.probabilities.wParts.ra),
            ownOffenseKnown: forecast.probabilities.wParts.ownOffenseKnown,
          },
          // Joinability + candidate-confounder screen (2026-07, see
          // docs/forecast-verification.md#snapshot-context): gamePk makes
          // post-game facts (umpire, catcher, days of rest) recoverable at
          // analysis time without pre-game fetches; the weather block
          // freezes the FORECAST weather the model actually priced — it
          // drifts until first pitch, so it can't be reconstructed later.
          gamePk: game.gamePk,
          gameTimeUtc: game.gameDate,
          venueId: game.venue.mlbId,
          throws: pp.talent.throws,
          oppSpMlbId: opposing?.mlbId ?? null,
          tempF: game.weather.temperature,
          windMph: game.weather.windSpeed,
          windDir: game.weather.windDirection,
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
  opts: SlateCaptureOptions = {},
): Promise<number> {
  const engine = (opts.engine ?? 'batter-day') as 'batter-day' | 'retro-batter-day';
  const byMlbId = new Map<number, ActiveBatter & { isHome: boolean; game: EnrichedGame }>();
  for (const game of games) {
    if (!isGradableGame(game)) continue;
    if (!opts.includeFinal && !PREGAME_STATUSES.has(game.status)) continue;
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
            game,
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
    // Modifier attribution. `mods` = adjusted / talent-baseline ratio per
    // stat (every knob combined) — the legacy combined dial. `knobs` (since
    // 2026-09-01) = the same ratio decomposed per L2 knob, knob-first
    // (`knobs.park.hr`, `knobs.pitcher.tb`, ...) mirroring the pitcher
    // engine's `mults`. The fit layer needs the decomposition: with only
    // the combined ratio, park / platoon / opposing-pitcher effects can't
    // be separated no matter how much data accrues.
    const mods: Record<string, number> = {};
    const knobs: Record<string, Record<string, number>> = {};
    for (const [key, statId] of BATTER_STAT_KEYS) {
      const cat = proj.byCategory.get(statId);
      if (cat) predicted[key] = cat.expectedCount;
      const rated = day.rating.categories.find(c => c.statId === statId);
      if (rated && rated.baseline > 1e-9) mods[key] = round3(rated.expected / rated.baseline);
      for (const [knob, mult] of Object.entries(rated?.knobs ?? {})) {
        if (typeof mult !== 'number' || !Number.isFinite(mult)) continue;
        (knobs[knob] ??= {})[key] = round3(mult);
      }
    }
    rows.push({
      gameDate,
      engine,
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
        knobs,
        spShare: day.rating.spShare != null ? round3(day.rating.spShare) : null,
        // Joinability + candidate-confounder screen (2026-07, see
        // docs/forecast-verification.md#snapshot-context). On doubleheader
        // days these describe game 1 (the dedup map keeps the first
        // pregame game); the doubleHeader flag above lets the screen
        // exclude those rows.
        gamePk: batter.game.gamePk,
        gameTimeUtc: batter.game.gameDate,
        venueId: batter.game.venue.mlbId,
        oppSpMlbId: (batter.isHome
          ? batter.game.awayProbablePitcher
          : batter.game.homeProbablePitcher)?.mlbId ?? null,
        tempF: batter.game.weather.temperature,
        windMph: batter.game.weather.windSpeed,
        windDir: batter.game.weather.windDirection,
      },
    });
  }
  return insertSnapshots(rows);
}

// ---------------------------------------------------------------------------
// Engine: batter-week — the roster page's substrate (talent × typical-week
// playing time), graded against the next Mon–Sun window
// ---------------------------------------------------------------------------

/** stat_id → predicted key, for reading weekly counts off a neutral
 *  PlayerProjection.byCategory. Inverse of BATTER_STAT_KEYS. */
const STAT_ID_TO_KEY = new Map(BATTER_STAT_KEYS.map(([key, id]) => [id, key]));

/**
 * Snapshot the neutral-week batter projections the roster page's value
 * cards are built on (post playing-time scaling — exactly what "Your
 * Batters" / "Upgrade Targets" consume, before leverage weighting).
 *
 * Unlike batter-day, this deliberately ignores the schedule and the
 * lineup — it claims "a typical week of this player is worth X". Grading
 * it against the next Mon–Sun window is what verifies the playing-time
 * half of the roster value (a batter-day snapshot only exists on days
 * the player was already in a lineup, so it can never see "we thought
 * he plays 5.5 games a week but he plays 4").
 */
export async function captureBatterWeek(
  leagueKey: string,
  rostered: PlayerProjection[],
  freeAgents: PlayerProjection[],
): Promise<number> {
  const windowStart = nextMondayEt();
  const windowEnd = addDaysIso(windowStart, 6);
  const rows: SnapshotRow[] = [];
  for (const [projections, owned] of [[rostered, true], [freeAgents, false]] as const) {
    for (const proj of projections) {
      if (!proj.mlbId || proj.mlbId <= 0) continue;
      const predicted: Record<string, number> = {};
      let weeklyPA = 0;
      for (const [statId, agg] of proj.byCategory) {
        const key = STAT_ID_TO_KEY.get(statId);
        if (!key) continue;
        predicted[key] = agg.expectedCount;
        // Counting-cat denominator = playing-time-scaled weekly PA.
        weeklyPA = Math.max(weeklyPA, agg.expectedDenom);
      }
      if (Object.keys(predicted).length === 0 || weeklyPA <= 0) continue;
      predicted.pa = weeklyPA;
      rows.push({
        gameDate: windowStart,
        engine: 'batter-week',
        mlbId: proj.mlbId,
        playerName: proj.name,
        leagueKey,
        predicted,
        context: { owned, teamAbbr: proj.teamAbbr, windowEnd, windowDays: 7 },
      });
    }
  }
  return insertSnapshots(rows);
}

export function captureBatterWeekInBackground(
  leagueKey: string,
  rostered: PlayerProjection[],
  freeAgents: PlayerProjection[],
): void {
  const windowStart = nextMondayEt();
  inBackground(`batter-week:${leagueKey}:${windowStart}:${leadDaysFor(windowStart)}`, () =>
    captureBatterWeek(leagueKey, rostered, freeAgents),
  );
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
  // Key the memo on how many capturable probables the slate carries, like
  // the batter wrapper does with posted lineups. Probables fill in through
  // the day (and can vanish entirely when the ESPN feed fails — Aug 2026);
  // a zero-row "success" must not pin the date until the process restarts.
  const probables = games.filter(g => PREGAME_STATUSES.has(g.status)).reduce(
    (n, g) => n + (g.homeProbablePitcher?.talent ? 1 : 0) + (g.awayProbablePitcher?.talent ? 1 : 0),
    0,
  );
  if (probables === 0) return;
  inBackground(`pitcher-start:${gameDate}:${lead}:${probables}`, () =>
    capturePitcherSlate(gameDate, games),
  );
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
  // Row count in the memo key: the pitcher board can be empty while the
  // batter board is full (no probables — ESPN outage, Aug 2026), and a
  // batter-only capture must not pin the window against the pitchers that
  // show up on the next request. Mapping rows is pure and cheap.
  const rows = pointsSnapshotRows(leagueKey, analysis);
  if (rows.length === 0) return;
  const memoKey = `points:${leagueKey}:${windowStart}:${leadDaysFor(windowStart)}:${rows.length}`;
  inBackground(memoKey, () => insertSnapshots(rows));
}
