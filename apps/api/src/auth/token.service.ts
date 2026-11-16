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

/**
 * Access tokens and session tokens are both JWTs signed with the same
 * `JWT_SECRET`, so a signature check alone cannot tell them apart. Every
 * token carries a `typ` claim naming which kind it is, and each consumer
 * rejects the other kind: `JwtStrategy` only accepts `access`,
 * `verifySessionToken` only accepts `session`.
 */
export const ACCESS_TOKEN_TYPE = 'access';
export const SESSION_TOKEN_TYPE = 'session';

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
 * permissions and is never accepted as an API bearer token: it is signed
 * with `typ: 'session'`, which `JwtStrategy` rejects.
 */
export interface SessionTokenPayload {
  staffUserId: string;
  twoStepVerified: boolean;
}

/**
 * Minimal shape `computeStaffPermissions` needs — matches a `Role` loaded
 * with `rolePermissions: { include: { permission: true } }`.
 */
export interface RoleWithPermissions {
  rolePermissions: Array<{ allowed: boolean; permission: { key: string } }>;
}

/**
 * Flattens a staff role's `RolePermission` rows into the `permission.key`
 * strings allowed for that role. Rows with `allowed: false` (and
 * permissions with no row at all) are excluded — a missing row means "not
 * allowed". Single source of truth, shared by `TokenService.buildStaffClaims`
 * (refresh-token rotation) and `AuthService.resolveStaffRoleLocation`
 * (staff role/location resolution), so both paths compute the same
 * permissions the same way.
 */
export function computeStaffPermissions(role: RoleWithPermissions | null | undefined): string[] {
  return (
    role?.rolePermissions
      .filter((rolePermission) => rolePermission.allowed)
      .map((rolePermission) => rolePermission.permission.key) ?? []
  );
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
    return this.jwt.sign(
      { ...payload, typ: ACCESS_TOKEN_TYPE },
      { subject: sub, expiresIn: ACCESS_TOKEN_TTL },
    );
  }

  /** Short-lived (10 min) token bridging staff password-login and 2-step verification. */
  issueSessionToken(payload: SessionTokenPayload): string {
    return this.jwt.sign(
      { ...payload, typ: SESSION_TOKEN_TYPE },
      { expiresIn: SESSION_TOKEN_TTL },
    );
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

    if (decoded.typ !== SESSION_TOKEN_TYPE) {
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
   * replayed), expired, or if the subject it belongs to can no longer
   * hold a session (a deleted or deactivated staff user) — rotation must
   * not keep minting valid access tokens for a staff member who has been
   * deactivated since the refresh token was issued.
   */
  async rotateRefreshToken(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    const existing = await this.findValidToken(rawToken);
    if (!existing) {
      return null;
    }

    // Claims are built before revoking, so a rotation refused because
    // the subject is gone/deactivated leaves the (useless) token as it
    // was rather than half-applying the rotation.
    const claims = await this.buildClaims(existing.subjectType, existing.subjectId);
    if (!claims) {
      return null;
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

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

  /** Returns null when the subject can no longer hold a session. */
  private async buildClaims(
    subjectType: RefreshTokenSubjectType,
    subjectId: string,
  ): Promise<AccessTokenClaims | null> {
    if (subjectType === 'STAFF') {
      return this.buildStaffClaims(subjectId);
    }
    return { sub: subjectId, subjectType: 'ACCOUNT', permissions: [] };
  }

  // Staff permission/location resolution is exercised fully by Task 3
  // (staff login), but is implemented here since TokenService is shared
  // infrastructure and the schema it reads already exists.
  //
  // Returns null — failing the whole rotation — for a staff user who no
  // longer exists or has been deactivated, rather than minting a token
  // with `permissions: []` for a nonexistent user or a still-valid token
  // for a deactivated one. Mirrors the `deactivatedAt` checks on the
  // staff login/2-step/role-location paths in `AuthService`.
  private async buildStaffClaims(staffUserId: string): Promise<AccessTokenClaims | null> {
    const staffUser = await this.prisma.staffUser.findUnique({
      where: { id: staffUserId },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
        staffUserLocations: true,
      },
    });
    if (!staffUser || staffUser.deactivatedAt) {
      return null;
    }

    const permissions = computeStaffPermissions(staffUser.role);

    return {
      sub: staffUserId,
      subjectType: 'STAFF',
      permissions,
      // The id of the StaffUserLocation row itself (not Location.id) — must
      // match the semantics AuthService.resolveStaffRoleLocation uses for
      // the same claim name. No schema support exists for persisting which
      // location a staff member most recently chose across a token
      // refresh, so this arbitrarily keeps using whichever row sorts
      // first; that's an accepted limitation, not something this fixes.
      staffUserLocationId: staffUser.staffUserLocations[0]?.id,
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
