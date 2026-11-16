import { join } from 'path';
import { defineConfig, env } from 'prisma/config';

// Node 20.6+ loads a .env file natively; best-effort so CI/deploy
// environments that inject DATABASE_URL directly still work without
// a local .env file present. Resolved relative to this config file so
// it works regardless of the shell's current working directory.
try {
  process.loadEnvFile(join(__dirname, '.env'));
} catch {
  // no .env file present — rely on already-exported env vars.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
