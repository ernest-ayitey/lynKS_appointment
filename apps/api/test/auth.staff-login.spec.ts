import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { OtpPurpose, Role, StaffUser } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/auth/otp.service';
import { TokenService } from '../src/auth/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Staff password login + 2-step verification (e2e)', () => {
  let app: INestApplication;
  let otpService: OtpService;
  let tokenService: TokenService;
  let prisma: PrismaService;
  let role: Role;

  const createdStaffUserIds: string[] = [];
  const PASSWORD = 'correct-password-123';

  let emailCounter = 0;
  function uniqueEmail(): string {
    emailCounter += 1;
    return `staff-login-test-${Date.now()}-${emailCounter}@example.com`;
  }

  async function createStaffUser(overrides: Partial<StaffUser> = {}): Promise<StaffUser> {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const staffUser = await prisma.staffUser.create({
      data: {
        name: 'Test Staff',
        email: uniqueEmail(),
        passwordHash,
        roleId: role.id,
        twoStepEnabled: false,
        ...overrides,
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    otpService = moduleRef.get(OtpService);
    tokenService = moduleRef.get(TokenService);
    prisma = moduleRef.get(PrismaService);

    role = await prisma.role.findFirstOrThrow();
  });

  afterAll(async () => {
    await prisma.otpCode.deleteMany({ where: { purpose: OtpPurpose.STAFF_TWO_STEP } });
    await prisma.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    await app.close();
  });

  describe('POST /auth/staff/login', () => {
    it('rejects login for a deactivated staff user with 403', async () => {
      const staffUser = await createStaffUser({ deactivatedAt: new Date() });

      const response = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email, password: PASSWORD });

      expect(response.status).toBe(403);
    });

    it('returns requiresTwoStep: true for a staff user with twoStepEnabled', async () => {
      const staffUser = await createStaffUser({ twoStepEnabled: true });

      const response = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email, password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.requiresTwoStep).toBe(true);
      expect(typeof response.body.sessionToken).toBe('string');
    });

    it('returns requiresTwoStep: false for a staff user without it', async () => {
      const staffUser = await createStaffUser({ twoStepEnabled: false });

      const response = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email, password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.requiresTwoStep).toBe(false);
      expect(typeof response.body.sessionToken).toBe('string');
    });

    it('rejects login with the wrong password with 401', async () => {
      const staffUser = await createStaffUser();

      const response = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email, password: 'wrong-password' });

      expect(response.status).toBe(401);
    });

    it('rejects login for an unknown email with 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: uniqueEmail(), password: PASSWORD });

      expect(response.status).toBe(401);
    });

    it('rejects a missing password with 400', async () => {
      const staffUser = await createStaffUser();

      const response = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email });

      expect(response.status).toBe(400);
    });

    it('issues a session token that is not yet two-step verified when two-step is enabled', async () => {
      const staffUser = await createStaffUser({ twoStepEnabled: true });

      const response = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email, password: PASSWORD });

      const payload = tokenService.verifySessionToken(response.body.sessionToken);
      expect(payload).toEqual({ staffUserId: staffUser.id, twoStepVerified: false });
    });

    it('issues an already-verified session token when two-step is disabled', async () => {
      const staffUser = await createStaffUser({ twoStepEnabled: false });

      const response = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email, password: PASSWORD });

      const payload = tokenService.verifySessionToken(response.body.sessionToken);
      expect(payload).toEqual({ staffUserId: staffUser.id, twoStepVerified: true });
    });
  });

  describe('POST /auth/staff/two-step/request', () => {
    it('triggers an OTP generation against the staff user email and returns a requestId', async () => {
      const staffUser = await createStaffUser({ twoStepEnabled: true });
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email, password: PASSWORD });

      const response = await request(app.getHttpServer())
        .post('/auth/staff/two-step/request')
        .send({ sessionToken: loginResponse.body.sessionToken });

      expect(response.status).toBe(200);
      expect(typeof response.body.requestId).toBe('string');

      const otp = await prisma.otpCode.findUnique({ where: { id: response.body.requestId } });
      expect(otp?.destination).toBe(staffUser.email);
      expect(otp?.purpose).toBe(OtpPurpose.STAFF_TWO_STEP);
    });

    it('rejects an invalid session token with 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/staff/two-step/request')
        .send({ sessionToken: 'not-a-real-session-token' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /auth/staff/two-step/verify', () => {
    async function loginAndRequestTwoStep(): Promise<{
      staffUser: StaffUser;
      sessionToken: string;
      requestId: string;
      code: string;
    }> {
      const staffUser = await createStaffUser({ twoStepEnabled: true });
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: staffUser.email, password: PASSWORD });
      const sessionToken: string = loginResponse.body.sessionToken;

      const { requestId, code } = await otpService.generate(
        staffUser.email,
        OtpPurpose.STAFF_TWO_STEP,
      );

      return { staffUser, sessionToken, requestId, code };
    }

    it('completes two-step verification and returns a session token with twoStepVerified: true', async () => {
      const { staffUser, sessionToken, requestId, code } = await loginAndRequestTwoStep();

      const response = await request(app.getHttpServer())
        .post('/auth/staff/two-step/verify')
        .send({ sessionToken, requestId, code });

      expect(response.status).toBe(200);
      expect(typeof response.body.sessionToken).toBe('string');

      const payload = tokenService.verifySessionToken(response.body.sessionToken);
      expect(payload).toEqual({ staffUserId: staffUser.id, twoStepVerified: true });
    });

    it('rejects an incorrect OTP code with 401', async () => {
      const { sessionToken, requestId, code } = await loginAndRequestTwoStep();
      const wrongCode = code === '000000' ? '111111' : '000000';

      const response = await request(app.getHttpServer())
        .post('/auth/staff/two-step/verify')
        .send({ sessionToken, requestId, code: wrongCode });

      expect(response.status).toBe(401);
    });

    it('rejects a session token that was not produced by a matching login', async () => {
      const { requestId, code } = await loginAndRequestTwoStep();

      const response = await request(app.getHttpServer())
        .post('/auth/staff/two-step/verify')
        .send({ sessionToken: 'not-a-real-session-token', requestId, code });

      expect(response.status).toBe(401);
    });
  });
});
