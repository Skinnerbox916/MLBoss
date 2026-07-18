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
