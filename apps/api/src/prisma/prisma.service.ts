import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from './create-prisma-adapter';

/**
 * Thin wrapper around PrismaClient that hooks into Nest's module
 * lifecycle so the DB connection is opened/closed alongside the app.
 *
 * Prisma 7 requires an explicit driver adapter at runtime — MySQL and
 * MariaDB both use `@prisma/adapter-mariadb` (they share the same
 * `mysql` provider and wire protocol).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: createPrismaAdapter() });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
