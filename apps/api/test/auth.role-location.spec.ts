import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { Location, Role, StaffUser } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Staff role/location resolution (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let prisma: PrismaService;
  let role: Role;
  let locations: Location[];

  const createdStaffUserIds: string[] = [];
  const PASSWORD = 'correct-password-123';

  let emailCounter = 0;
  function uniqueEmail(): string {
    emailCounter += 1;
    return `role-location-test-${Date.now()}-${emailCounter}@example.com`;
  }

  let phoneCounter = 0;
  function uniquePhone(): string {
    phoneCounter += 1;
    return `+1555${Date.now()}${phoneCounter}`.slice(0, 20);
  }

  async function createStaffUser(overrides: Partial<StaffUser> = {}): Promise<StaffUser> {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const staffUser = await prisma.staffUser.create({
      data: {
        name: 'Test Staff',
        email: uniqueEmail(),
        phone: uniquePhone(),
        passwordHash,
        roleId: role.id,
        twoStepEnabled: false,
        ...overrides,
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  async function loginAndGetSessionToken(staffUser: StaffUser): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: staffUser.email, password: PASSWORD });
    return response.body.sessionToken;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    tokenService = moduleRef.get(TokenService);
    prisma = moduleRef.get(PrismaService);

    role = await prisma.role.findFirstOrThrow();
    locations = await prisma.location.findMany({ take: 2 });
    if (locations.length < 2) {
      throw new Error('Expected at least 2 seeded locations for these tests');
    }
  });

  afterAll(async () => {
    await prisma.staffUserLocation.deleteMany({
      where: { staffUserId: { in: createdStaffUserIds } },
    });
    await prisma.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    await app.close();
  });

  describe('POST /auth/staff/role-location', () => {
    it('returns final tokens directly when the staff user has exactly one role/location', async () => {
      const staffUser = await createStaffUser();
      await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[0].id },
      });
      const sessionToken = await loginAndGetSessionToken(staffUser);

      const response = await request(app.getHttpServer())
        .post('/auth/staff/role-location')
        .send({ sessionToken });

      expect(response.status).toBe(200);
      expect(typeof response.body.accessToken).toBe('string');
      expect(typeof response.body.refreshToken).toBe('string');
      expect(response.body.options).toBeUndefined();
    });

    it('returns an options list when the staff user has more than one role/location and none was chosen', async () => {
      const staffUser = await createStaffUser();
      await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[0].id },
      });
      await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[1].id },
      });
      const sessionToken = await loginAndGetSessionToken(staffUser);

      const response = await request(app.getHttpServer())
        .post('/auth/staff/role-location')
        .send({ sessionToken });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toBeUndefined();
      expect(Array.isArray(response.body.options)).toBe(true);
      expect(response.body.options).toHaveLength(2);
      for (const option of response.body.options) {
        expect(typeof option.staffUserLocationId).toBe('string');
        expect(option.roleName).toBe(role.name);
        expect([locations[0].name, locations[1].name]).toContain(option.locationName);
      }
    });

    it('returns final tokens scoped to the chosen staffUserLocationId when provided', async () => {
      const staffUser = await createStaffUser();
      const rowA = await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[0].id },
      });
      await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[1].id },
      });
      const sessionToken = await loginAndGetSessionToken(staffUser);

      const response = await request(app.getHttpServer())
        .post('/auth/staff/role-location')
        .send({ sessionToken, staffUserLocationId: rowA.id });

      expect(response.status).toBe(200);
      expect(typeof response.body.accessToken).toBe('string');
      expect(typeof response.body.refreshToken).toBe('string');

      const decoded = tokenService['jwt'].decode(response.body.accessToken) as Record<
        string,
        unknown
      >;
      expect(decoded.staffUserLocationId).toBe(rowA.id);
      expect(decoded.subjectType).toBe('STAFF');
    });

    it('returns 400 when the provided staffUserLocationId does not belong to the staff user', async () => {
      const staffUser = await createStaffUser();
      await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[0].id },
      });
      await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[1].id },
      });
      const sessionToken = await loginAndGetSessionToken(staffUser);

      const response = await request(app.getHttpServer())
        .post('/auth/staff/role-location')
        .send({ sessionToken, staffUserLocationId: 'not-a-real-id' });

      expect(response.status).toBe(400);
    });

    it('rejects role-location resolution if two-step is required but not verified on the session token', async () => {
      const staffUser = await createStaffUser({ twoStepEnabled: true });
      await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[0].id },
      });
      const sessionToken = await loginAndGetSessionToken(staffUser);

      const response = await request(app.getHttpServer())
        .post('/auth/staff/role-location')
        .send({ sessionToken });

      expect(response.status).toBe(401);
    });

    it('allows role-location resolution once two-step has been verified', async () => {
      const staffUser = await createStaffUser({ twoStepEnabled: true });
      await prisma.staffUserLocation.create({
        data: { staffUserId: staffUser.id, locationId: locations[0].id },
      });
      const verifiedSessionToken = tokenService.issueSessionToken({
        staffUserId: staffUser.id,
        twoStepVerified: true,
      });

      const response = await request(app.getHttpServer())
        .post('/auth/staff/role-location')
        .send({ sessionToken: verifiedSessionToken });

      expect(response.status).toBe(200);
      expect(typeof response.body.accessToken).toBe('string');
    });

    it('rejects an invalid session token with 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/staff/role-location')
        .send({ sessionToken: 'not-a-real-session-token' });

      expect(response.status).toBe(401);
    });
  });
});
