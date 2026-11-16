import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccessTokenClaims, TokenService } from '../src/auth/token.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { RequirePermission } from '../src/auth/decorators/require-permission.decorator';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator';

// Throwaway controller used only to exercise JwtAuthGuard + PermissionsGuard
// against a real guarded endpoint, per the brief's Review Focus: a
// permission toggle must block the API directly, not just hide a button.
@Controller('test-permissions')
class TestPermissionsController {
  @Get('clinical-notes')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('clinical_notes.read')
  read(@CurrentUser() user: AccessTokenClaims) {
    return { ok: true, sub: user.sub };
  }
}

describe('PermissionsGuard (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let prisma: PrismaService;

  const createdStaffUserIds: string[] = [];
  const PASSWORD = 'correct-password-123';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestPermissionsController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    tokenService = moduleRef.get(TokenService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    await app.close();
  });

  it('allows a request whose JWT permissions include the required key', async () => {
    const token = tokenService.issueAccessToken({
      sub: 'staff-with-permission',
      subjectType: 'STAFF',
      permissions: ['clinical_notes.read'],
    });

    const response = await request(app.getHttpServer())
      .get('/test-permissions/clinical-notes')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, sub: 'staff-with-permission' });
  });

  it('returns 403 for a request whose JWT permissions do not include the required key, even for an authenticated staff user', async () => {
    const token = tokenService.issueAccessToken({
      sub: 'staff-without-permission',
      subjectType: 'STAFF',
      permissions: ['appointments.read'],
    });

    const response = await request(app.getHttpServer())
      .get('/test-permissions/clinical-notes')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('returns 401 for a request with no token at all', async () => {
    const response = await request(app.getHttpServer()).get('/test-permissions/clinical-notes');

    expect(response.status).toBe(401);
  });

  it('returns 401 for a request with a garbage/invalid token', async () => {
    const response = await request(app.getHttpServer())
      .get('/test-permissions/clinical-notes')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(response.status).toBe(401);
  });

  it('returns 401 for a valid, unexpired staff session token presented as a Bearer token', async () => {
    // A session token is signed by the same JwtService with the same
    // JWT_SECRET as an access token, so its signature verifies — only
    // the `typ` claim separates them. It carries no
    // sub/subjectType/permissions, so letting it through would populate
    // request.user with a permission-less non-subject.
    const role = await prisma.role.findFirstOrThrow();
    const staffUser = await prisma.staffUser.create({
      data: {
        name: 'Session Token Test Staff',
        email: `session-token-test-${Date.now()}@example.com`,
        phone: `+1555${Date.now()}`.slice(0, 20),
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        roleId: role.id,
        twoStepEnabled: false,
      },
    });
    createdStaffUserIds.push(staffUser.id);

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: staffUser.email, password: PASSWORD });
    const sessionToken: string = loginResponse.body.sessionToken;

    // The session token really is valid for its own purpose.
    expect(tokenService.verifySessionToken(sessionToken)).toEqual({
      staffUserId: staffUser.id,
      twoStepVerified: true,
    });

    const response = await request(app.getHttpServer())
      .get('/test-permissions/clinical-notes')
      .set('Authorization', `Bearer ${sessionToken}`);

    expect(response.status).toBe(401);
  });

  it('returns 401 for an access token presented to verifySessionToken', async () => {
    // The mirror image of the check above: an access token must not pass
    // as a session token on the staff 2-step / role-location endpoints.
    const accessToken = tokenService.issueAccessToken({
      sub: 'staff-access-token',
      subjectType: 'STAFF',
      permissions: ['clinical_notes.read'],
    });

    expect(tokenService.verifySessionToken(accessToken)).toBeNull();
  });
});
