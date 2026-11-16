import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { OtpPurpose } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/auth/otp.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Patient OTP auth (e2e)', () => {
  let app: INestApplication;
  let otpService: OtpService;
  let prisma: PrismaService;

  // Track everything created so we can clean up afterwards and keep
  // repeated test runs idempotent (phone numbers are unique per-test, so
  // collisions across runs aren't a correctness issue, but we still tidy
  // up to avoid leaving junk rows behind).
  const createdPhones: string[] = [];
  let phoneCounter = 0;

  function uniquePhone(): string {
    phoneCounter += 1;
    return `+1555${Date.now()}${phoneCounter}`.slice(0, 20);
  }

  async function generateOtp(phone: string): Promise<{ requestId: string; code: string }> {
    createdPhones.push(phone);
    const { requestId, code } = await otpService.generate(phone, OtpPurpose.PATIENT_LOGIN);
    return { requestId, code };
  }

  function wrongCodeFor(code: string): string {
    return code === '000000' ? '111111' : '000000';
  }

  async function generateStaffTwoStepOtp(
    phone: string,
  ): Promise<{ requestId: string; code: string }> {
    createdPhones.push(phone);
    const { requestId, code } = await otpService.generate(phone, OtpPurpose.STAFF_TWO_STEP);
    return { requestId, code };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    otpService = moduleRef.get(OtpService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    const accounts = await prisma.account.findMany({
      where: { phone: { in: createdPhones } },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);

    if (accountIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { subjectId: { in: accountIds } } });
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    }
    await prisma.otpCode.deleteMany({ where: { destination: { in: createdPhones } } });

    await app.close();
  });

  it('creates a new Account on first-ever verify-otp for a phone number', async () => {
    const phone = uniquePhone();
    const { requestId, code } = await generateOtp(phone);

    const existingBefore = await prisma.account.findUnique({ where: { phone } });
    expect(existingBefore).toBeNull();

    const response = await request(app.getHttpServer())
      .post('/auth/patient/verify-otp')
      .send({ requestId, code });

    expect(response.status).toBe(200);
    expect(typeof response.body.accessToken).toBe('string');
    expect(typeof response.body.refreshToken).toBe('string');
    expect(typeof response.body.accountId).toBe('string');

    const account = await prisma.account.findUnique({ where: { phone } });
    expect(account).not.toBeNull();
    expect(account?.id).toBe(response.body.accountId);
  });

  it('rejects verify-otp with the wrong code', async () => {
    const phone = uniquePhone();
    const { requestId, code } = await generateOtp(phone);

    const response = await request(app.getHttpServer())
      .post('/auth/patient/verify-otp')
      .send({ requestId, code: wrongCodeFor(code) });

    expect(response.status).toBe(401);
  });

  it('rejects a valid STAFF_TWO_STEP code at the patient verify-otp endpoint', async () => {
    // The code and requestId are genuine, unexpired and unconsumed —
    // they were simply issued for the staff 2-step flow. Redeeming one
    // here must not mint patient tokens (nor create an Account) for the
    // phone number it was sent to.
    const phone = uniquePhone();
    const { requestId, code } = await generateStaffTwoStepOtp(phone);

    const response = await request(app.getHttpServer())
      .post('/auth/patient/verify-otp')
      .send({ requestId, code });

    expect(response.status).toBe(401);
    expect(await prisma.account.findUnique({ where: { phone } })).toBeNull();

    // The OTP was rejected on purpose alone: it is still unconsumed and
    // the code was genuinely correct.
    const otp = await prisma.otpCode.findUnique({ where: { id: requestId } });
    expect(otp?.consumedAt).toBeNull();
    expect(await otpService.verify(requestId, code)).toBe(true);
  });

  it('rejects verify-otp reusing an already-consumed code', async () => {
    const phone = uniquePhone();
    const { requestId, code } = await generateOtp(phone);

    const first = await request(app.getHttpServer())
      .post('/auth/patient/verify-otp')
      .send({ requestId, code });
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer())
      .post('/auth/patient/verify-otp')
      .send({ requestId, code });
    expect(second.status).toBe(401);
  });

  it('rejects verify-otp after 5 wrong attempts even with the correct code', async () => {
    const phone = uniquePhone();
    const { requestId, code } = await generateOtp(phone);
    const wrong = wrongCodeFor(code);

    for (let i = 0; i < 5; i += 1) {
      const attempt = await request(app.getHttpServer())
        .post('/auth/patient/verify-otp')
        .send({ requestId, code: wrong });
      expect(attempt.status).toBe(401);
    }

    const finalAttempt = await request(app.getHttpServer())
      .post('/auth/patient/verify-otp')
      .send({ requestId, code });
    expect(finalAttempt.status).toBe(401);
  });

  it('rotates refresh tokens and rejects a reused (already-rotated) refresh token', async () => {
    const phone = uniquePhone();
    const { requestId, code } = await generateOtp(phone);

    const verifyResponse = await request(app.getHttpServer())
      .post('/auth/patient/verify-otp')
      .send({ requestId, code });
    const originalRefreshToken: string = verifyResponse.body.refreshToken;

    const rotateResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: originalRefreshToken });

    expect(rotateResponse.status).toBe(200);
    expect(typeof rotateResponse.body.accessToken).toBe('string');
    expect(typeof rotateResponse.body.refreshToken).toBe('string');
    expect(rotateResponse.body.refreshToken).not.toBe(originalRefreshToken);

    const reuseResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: originalRefreshToken });
    expect(reuseResponse.status).toBe(401);

    const freshRotateResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotateResponse.body.refreshToken });
    expect(freshRotateResponse.status).toBe(200);
  });

  it('returns a requestId and expiresInSeconds from request-otp, without leaking the code', async () => {
    const phone = uniquePhone();
    createdPhones.push(phone);

    const response = await request(app.getHttpServer())
      .post('/auth/patient/request-otp')
      .send({ phone });

    expect(response.status).toBe(200);
    expect(typeof response.body.requestId).toBe('string');
    expect(response.body.expiresInSeconds).toBeGreaterThan(0);
    expect(response.body.expiresInSeconds).toBeLessThanOrEqual(600);
    expect(response.body.code).toBeUndefined();
  });

  it('rejects request-otp with a missing phone', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/patient/request-otp')
      .send({});

    expect(response.status).toBe(400);
  });

  it('logs out by revoking the refresh token, making a later refresh fail', async () => {
    const phone = uniquePhone();
    const { requestId, code } = await generateOtp(phone);

    const verifyResponse = await request(app.getHttpServer())
      .post('/auth/patient/verify-otp')
      .send({ requestId, code });
    const refreshToken: string = verifyResponse.body.refreshToken;

    const logoutResponse = await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken });
    expect(logoutResponse.status).toBe(204);

    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });
});
