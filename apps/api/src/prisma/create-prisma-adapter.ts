import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Prisma 7 requires an explicit driver adapter at runtime. MySQL and
 * MariaDB share the same `mysql` provider and wire protocol, so the
 * MariaDB adapter is the correct one for both — see
 * https://pris.ly/d/driver-adapters.
 *
 * Shared by `PrismaService` (app runtime) and `prisma/seed.ts` (seed
 * script, run outside of Nest's DI) so the connection setup lives in
 * one place.
 */
export function createPrismaAdapter(): PrismaMariaDb {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  return new PrismaMariaDb(databaseUrl);
}
