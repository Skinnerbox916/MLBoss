import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js keeps env in .env.local, which drizzle-kit does not auto-load.
config({ path: '.env.local' });

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
