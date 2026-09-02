import {
  pgTable,
  text,
  timestamp,
  date,
  integer,
  jsonb,
  bigserial,
  primaryKey,
  uniqueIndex,
  index,
  smallint,
  real,
} from 'drizzle-orm/pg-core';

/**
 * Postgres schema — the durable ledger.
 *
 * Storage model (see docs/data-architecture.md#the-three-storage-legs):
 * Redis holds anything rebuildable from upstream APIs (cache, sessions).
 * Postgres holds anything witnessed or decided that can't be refetched:
 * who our users are, their preferences, and the forecast ledger.
 *
 * Everything user-owned is keyed by users.id (the Yahoo GUID) so the
 * schema is multi-tenant from day one, even while there's one user.
 */

export type UserRole = 'operator' | 'user';

export const users = pgTable('users', {
  /** Yahoo GUID — the same id the session and Redis `user:*` keys use. */
  id: text('id').primaryKey(),
  email: text('email').notNull().default(''),
  name: text('name').notNull().default(''),
  /** 'operator' unlocks /admin and /api/admin; everyone else is 'user'. */
  role: text('role', { enum: ['operator', 'user'] }).notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-user preferences that previously lived in browser localStorage
 * (concede/contest overrides, preferred depth targets). One row per
 * (user, key); value shape is owned by the consuming hook.
 */
export const userPrefs = pgTable(
  'user_prefs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/**
 * Forecast ledger — what a model predicted, frozen at capture time.
 * Rows are immutable and first-write-wins per identity: a snapshot is an
 * observation of model output whose inputs (probables, park, weather,
 * talent state) drift daily and can never be reconstructed later.
 *
 * `leagueKey` is '' for league-independent engines (raw stat-line
 * forecasts); set when the prediction depends on a league's scoring
 * profile (points engines). `predicted` and `context` field vocabulary
 * per engine: docs/forecast-verification.md#engines.
 */
export const forecastSnapshots = pgTable(
  'forecast_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Date the predicted game(s) occur, YYYY-MM-DD in ET. */
    gameDate: date('game_date').notNull(),
    engine: text('engine').notNull(),
    mlbId: integer('mlb_id').notNull(),
    playerName: text('player_name').notNull().default(''),
    leagueKey: text('league_key').notNull().default(''),
    /**
     * Days between capture and the game (0 = captured day-of). Part of the
     * identity: the same prediction re-observed closer to the game is a
     * different, sharper forecast worth grading separately.
     */
    leadDays: integer('lead_days').notNull().default(0),
    predicted: jsonb('predicted').$type<Record<string, number>>().notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    modelVersion: text('model_version').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('forecast_snapshots_identity').on(
      t.gameDate,
      t.engine,
      t.mlbId,
      t.leagueKey,
      t.leadDays,
    ),
    index('forecast_snapshots_date').on(t.gameDate),
  ],
);

/**
 * Actual stat lines for (player, date) — the other half of the grading
 * join. Refetchable from the MLB Stats API in principle, but materialized
 * here so scoring a season doesn't mean re-walking months of game logs.
 * `batting`/`pitching` are raw per-game counting lines; points and errors
 * are computed at scorecard time, never stored.
 */
export const playerGameActuals = pgTable(
  'player_game_actuals',
  {
    gameDate: date('game_date').notNull(),
    mlbId: integer('mlb_id').notNull(),
    status: text('status', { enum: ['played', 'no_game'] }).notNull(),
    batting: jsonb('batting').$type<Record<string, number>>(),
    pitching: jsonb('pitching').$type<Record<string, number>>(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameDate, t.mlbId] })],
);

/**
 * Raw Statcast pitch events — the retro corpus. One row per pitch, pulled
 * per game date from Savant's `statcast_search/csv` export. This is NOT
 * ledger data: it is refetchable and carries no forecast, so it is neither
 * immutable-by-contract nor first-write-wins in spirit — it is a rebuildable
 * bulk dataset that lives in Postgres because as-of-date aggregation
 * (every Savant leaderboard input the talent layer consumes, sliced to
 * "through the day before the game") is a SQL problem, not a cache problem.
 * See docs/data-architecture.md#the-three-storage-legs and
 * docs/forecast-verification.md (retro).
 *
 * Columns are the subset the engine's Savant-derived inputs are built from
 * (xwOBA / xBA / xSLG / xwOBAcon via the estimated_* fields + woba_value;
 * K% / BB% via `events`; hard-hit + barrel via launch_speed /
 * launch_speed_angle; whiff via `description`; velocity via release_speed
 * by pitch_type). Anything else is re-pullable.
 */
export const statcastEvents = pgTable(
  'statcast_events',
  {
    gamePk: integer('game_pk').notNull(),
    gameDate: date('game_date').notNull(),
    atBatNumber: integer('at_bat_number').notNull(),
    pitchNumber: integer('pitch_number').notNull(),
    inning: smallint('inning'),
    inningTopbot: text('inning_topbot'),
    batter: integer('batter').notNull(),
    pitcher: integer('pitcher').notNull(),
    stand: text('stand'),
    pThrows: text('p_throws'),
    homeTeam: text('home_team'),
    awayTeam: text('away_team'),
    pitchType: text('pitch_type'),
    releaseSpeed: real('release_speed'),
    description: text('description'),
    /** PA-ending result (strikeout, walk, single, ...); null on non-terminal pitches. */
    events: text('events'),
    bbType: text('bb_type'),
    launchSpeed: real('launch_speed'),
    launchAngle: real('launch_angle'),
    /** Savant batted-ball class; 6 = barrel. */
    launchSpeedAngle: smallint('launch_speed_angle'),
    estBa: real('est_ba'),
    estWoba: real('est_woba'),
    estSlg: real('est_slg'),
    wobaValue: real('woba_value'),
    wobaDenom: real('woba_denom'),
    babipValue: real('babip_value'),
    isoValue: real('iso_value'),
    balls: smallint('balls'),
    strikes: smallint('strikes'),
    outsWhenUp: smallint('outs_when_up'),
    /** Change in run expectancy on the pitch, batting-team perspective
     *  (positive = good for the offense). Summed ×100 / pitches it is
     *  Savant's pitcher run value per 100 (lower = better pitcher). */
    deltaRunExp: real('delta_run_exp'),
    /** Times the batter's lineup slot has come up vs this pitcher (1 = first PA). */
    nThruOrderPitcher: smallint('n_thruorder_pitcher'),
    pitcherDaysSincePrevGame: smallint('pitcher_days_since_prev_game'),
    batterDaysSincePrevGame: smallint('batter_days_since_prev_game'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gamePk, t.atBatNumber, t.pitchNumber] }),
    index('statcast_events_date').on(t.gameDate),
    index('statcast_events_batter_date').on(t.batter, t.gameDate),
    index('statcast_events_pitcher_date').on(t.pitcher, t.gameDate),
  ],
);
