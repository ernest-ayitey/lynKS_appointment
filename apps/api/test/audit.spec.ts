import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AuditService, AuditEntry } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuditService', () => {
  let app: INestApplication;
  let auditService: AuditService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    auditService = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up audit logs after each test
    await prisma.auditLog.deleteMany({});
  });

  it('persists an AuditLog row with the given actor, action, entity, and metadata', async () => {
    const entry: AuditEntry = {
      actorType: 'STAFF',
      actorId: 'actor-123',
      action: 'CREATE',
      entityType: 'APPOINTMENT',
      entityId: 'entity-456',
      metadata: { reason: 'initial booking' },
    };

    await auditService.record(entry);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: 'entity-456' },
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: 'actor-123',
      action: 'CREATE',
      entityType: 'APPOINTMENT',
      entityId: 'entity-456',
      metadata: { reason: 'initial booking' },
    });
  });

  it('persists an AuditLog without actorId when provided as null', async () => {
    const entry: AuditEntry = {
      actorType: 'SYSTEM',
      actorId: null,
      action: 'AUTO_CANCEL',
      entityType: 'APPOINTMENT',
      entityId: 'entity-789',
    };

    await auditService.record(entry);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: 'entity-789' },
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
      action: 'AUTO_CANCEL',
      entityType: 'APPOINTMENT',
      entityId: 'entity-789',
      metadata: null,
    });
  });

  it('persists an AuditLog without metadata when not provided', async () => {
    const entry: AuditEntry = {
      actorType: 'ACCOUNT',
      actorId: 'account-101',
      action: 'BOOK_APPOINTMENT',
      entityType: 'APPOINTMENT',
      entityId: 'entity-999',
    };

    await auditService.record(entry);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: 'entity-999' },
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorType: 'ACCOUNT',
      actorId: 'account-101',
      action: 'BOOK_APPOINTMENT',
      entityType: 'APPOINTMENT',
      entityId: 'entity-999',
      metadata: null,
    });
  });
});
