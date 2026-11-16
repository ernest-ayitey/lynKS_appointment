import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
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

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestPermissionsController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    tokenService = moduleRef.get(TokenService);
  });

  afterAll(async () => {
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
});
