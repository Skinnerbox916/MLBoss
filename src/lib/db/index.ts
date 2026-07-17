// DB barrel — the durable ledger (Postgres via Drizzle).
//
// Cache-shaped data does NOT belong here: anything rebuildable from
// upstream APIs goes through Redis (src/lib/fantasy/cache.ts). This layer
// holds what can't be refetched — users, preferences, forecast snapshots.
// See docs/data-architecture.md#the-three-storage-legs.

export { getDb, type Db } from './client';
export {
  users,
  userPrefs,
  forecastSnapshots,
  playerGameActuals,
  type UserRole,
} from './schema';
export { upsertUserOnLogin, roleFromEnv } from './users';
