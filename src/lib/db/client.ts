import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Singleton Postgres client, same shape as the Redis singleton in
// src/lib/redis.ts. The pool is created lazily on first use — neither
// `new Pool` nor `drizzle()` open a connection, but constructing eagerly
// at import time would still throw on a missing DATABASE_URL in contexts
// that never touch the DB (builds, scripts).

export type Db = NodePgDatabase<typeof schema>;

class PgClient {
  private static instance: Db | null = null;
  private static pool: Pool | null = null;

  public static getInstance(): Db {
    if (!PgClient.instance) {
      const url = process.env.DATABASE_URL;
      if (!url) {
        throw new Error('DATABASE_URL is not set — see src/constants/envSchema.ts');
      }
      PgClient.pool = new Pool({ connectionString: url });
      PgClient.pool.on('error', (err) => {
        console.error('❌ Postgres pool error:', err);
      });
      PgClient.instance = drizzle(PgClient.pool, { schema });
    }
    return PgClient.instance;
  }

  public static async disconnect(): Promise<void> {
    if (PgClient.pool) {
      await PgClient.pool.end();
      PgClient.pool = null;
      PgClient.instance = null;
    }
  }
}

export function getDb(): Db {
  return PgClient.getInstance();
}
