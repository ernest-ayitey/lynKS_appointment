import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { RefreshTokenSubjectType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hmacSha256Hex } from './hash.util';

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_TTL_DAYS = 30;
const ACCESS_TOKEN_TTL = '15m';
const SESSION_TOKEN_TTL = '10m';

export interface AccessTokenClaims {
  sub: string;
  subjectType: 'ACCOUNT' | 'STAFF';
  permissions: string[];
  staffUserLocationId?: string;
}

/**
 * Payload for the short-lived "session token" used between staff
 * password-login and completion of 2-step verification. Deliberately
 * distinct (and distinguishable) from `AccessTokenClaims` — it carries no
 * permissions and is never accepted as an API bearer token.
 */
export interface SessionTokenPayload {
  staffUserId: string;
  twoStepVerified: boolean;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  issueAccessToken(claims: AccessTokenClaims): string {
    const { sub, ...payload } = claims;
    return this.jwt.sign(payload, { subject: sub, expiresIn: ACCESS_TOKEN_TTL });
  }

  /** Short-lived (10 min) token bridging staff password-login and 2-step verification. */
  issueSessionToken(payload: SessionTokenPayload): string {
    return this.jwt.sign(payload, { expiresIn: SESSION_TOKEN_TTL });
  }

  /**
   * Verifies `token` was issued by `issueSessionToken` (correct signature,
   * not expired) and carries the expected shape. Returns null for any
   * other token (malformed, wrong secret, expired, or a differently
   * shaped JWT such as an access token) rather than throwing.
   */
  verifySessionToken(token: string): SessionTokenPayload | null {
    let decoded: Record<string, unknown>;
    try {
      decoded = this.jwt.verify<Record<string, unknown>>(token);
    } catch {
      return null;
    }

    if (typeof decoded.staffUserId !== 'string' || typeof decoded.twoStepVerified !== 'boolean') {
      return null;
    }
    return { staffUserId: decoded.staffUserId, twoStepVerified: decoded.twoStepVerified };
  }

  async issueRefreshToken(
    subjectType: RefreshTokenSubjectType,
    subjectId: string,
  ): Promise<string> {
    const rawToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { subjectType, subjectId, tokenHash, expiresAt },
    });

    return rawToken;
  }

  /**
   * Validates `rawToken`, revokes it, and issues a fresh access/refresh
   * pair for the same subject. Returns null if the token is unknown,
   * already revoked (including a previously-rotated token being
   * replayed), or expired.
   */
  async rotateRefreshToken(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    const existing = await this.findValidToken(rawToken);
    if (!existing) {
      return null;
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const claims = await this.buildClaims(existing.subjectType, existing.subjectId);
    const accessToken = this.issueAccessToken(claims);
    const refreshToken = await this.issueRefreshToken(existing.subjectType, existing.subjectId);

    return { accessToken, refreshToken };
  }

  /** Idempotent: revoking an unknown or already-revoked token is a no-op. */
  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async findValidToken(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });

    if (!existing || existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return existing;
  }

  private async buildClaims(
    subjectType: RefreshTokenSubjectType,
    subjectId: string,
  ): Promise<AccessTokenClaims> {
    if (subjectType === 'STAFF') {
      return this.buildStaffClaims(subjectId);
    }
    return { sub: subjectId, subjectType: 'ACCOUNT', permissions: [] };
  }

  // Staff permission/location resolution is exercised fully by Task 3
  // (staff login), but is implemented here since TokenService is shared
  // infrastructure and the schema it reads already exists.
  private async buildStaffClaims(staffUserId: string): Promise<AccessTokenClaims> {
    const staffUser = await this.prisma.staffUser.findUnique({
      where: { id: staffUserId },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
        staffUserLocations: true,
      },
    });

    const permissions =
      staffUser?.role.rolePermissions
        .filter((rolePermission) => rolePermission.allowed)
        .map((rolePermission) => rolePermission.permission.key) ?? [];

    return {
      sub: staffUserId,
      subjectType: 'STAFF',
      permissions,
      staffUserLocationId: staffUser?.staffUserLocations[0]?.locationId,
    };
  }

  private hashToken(rawToken: string): string {
    return hmacSha256Hex(rawToken, this.getSecret());
  }

  private getSecret(): string {
    const secret = this.config.get<string>('TOKEN_HASH_SECRET');
    if (!secret) {
      throw new Error('TOKEN_HASH_SECRET is not set');
    }
    return secret;
  }
}
