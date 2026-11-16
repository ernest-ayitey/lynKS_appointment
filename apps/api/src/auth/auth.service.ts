import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { compare } from 'bcrypt';
import { OtpPurpose, RefreshTokenSubjectType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { computeStaffPermissions, TokenService } from './token.service';

export interface RequestOtpResult {
  requestId: string;
  expiresInSeconds: number;
}

export interface VerifyOtpResult {
  accessToken: string;
  refreshToken: string;
  accountId: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface StaffLoginResult {
  sessionToken: string;
  requiresTwoStep: boolean;
}

export interface StaffTwoStepRequestResult {
  requestId: string;
}

export interface StaffTwoStepVerifyResult {
  sessionToken: string;
}

export interface RoleLocationOption {
  staffUserLocationId: string;
  roleName: string;
  locationName: string;
}

export interface StaffFinalTokens {
  accessToken: string;
  refreshToken: string;
}

export interface StaffRoleLocationOptions {
  options: RoleLocationOption[];
}

export type StaffRoleLocationResult = StaffFinalTokens | StaffRoleLocationOptions;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Logs an OTP code/destination for local development only. Nest's
   * default `ConsoleLogger` has `debug` enabled, so an unguarded
   * `logger.debug` would write plaintext codes and phone numbers to
   * stdout in production too — this keeps that strictly out of
   * production regardless of log-level configuration.
   */
  private logOtpForDevelopment(message: string): void {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    this.logger.debug(message);
  }

  async requestOtp(phone: string): Promise<RequestOtpResult> {
    const { requestId, expiresAt, code } = await this.otpService.generate(
      phone,
      OtpPurpose.PATIENT_LOGIN,
    );

    // No SMS gateway exists yet (out of scope for this task) — log the
    // code so it can be delivered/observed in development instead of
    // silently dropping it. Never return it in the HTTP response.
    this.logOtpForDevelopment(`OTP for ${phone} (requestId=${requestId}): ${code}`);

    const expiresInSeconds = Math.max(
      0,
      Math.round((expiresAt.getTime() - Date.now()) / 1000),
    );
    return { requestId, expiresInSeconds };
  }

  async verifyOtp(requestId: string, code: string): Promise<VerifyOtpResult | null> {
    const otp = await this.prisma.otpCode.findUnique({ where: { id: requestId } });
    // An OTP is only redeemable by the flow it was issued for. Without
    // the purpose check a pending STAFF_TWO_STEP code (issued to a staff
    // member's phone) could be redeemed here to mint patient tokens for
    // an Account created from that phone number, and vice versa — the
    // code is cross-flow interchangeable as far as `OtpService.verify`
    // is concerned, since it only matches code against requestId.
    if (!otp || otp.purpose !== OtpPurpose.PATIENT_LOGIN) {
      return null;
    }

    const isValid = await this.otpService.verify(requestId, code);
    if (!isValid) {
      return null;
    }

    const account = await this.prisma.account.upsert({
      where: { phone: otp.destination },
      update: {},
      create: { phone: otp.destination },
    });

    const accessToken = this.tokenService.issueAccessToken({
      sub: account.id,
      subjectType: 'ACCOUNT',
      permissions: [],
    });
    const refreshToken = await this.tokenService.issueRefreshToken(
      RefreshTokenSubjectType.ACCOUNT,
      account.id,
    );

    return { accessToken, refreshToken, accountId: account.id };
  }

  async refresh(refreshToken: string): Promise<RefreshResult | null> {
    return this.tokenService.rotateRefreshToken(refreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokenService.revokeRefreshToken(refreshToken);
  }

  /**
   * Password-login step for staff. Throws 401 for an unknown email or a
   * wrong password, and 403 for a deactivated account — deliberately
   * checked *after* the password is confirmed correct, so an
   * unauthenticated guesser can't use this endpoint as an oracle for
   * which accounts are deactivated.
   */
  async staffLogin(email: string, password: string): Promise<StaffLoginResult> {
    const staffUser = await this.prisma.staffUser.findUnique({ where: { email } });
    if (!staffUser) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await compare(password, staffUser.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (staffUser.deactivatedAt) {
      throw new ForbiddenException('This account has been deactivated');
    }

    const sessionToken = this.tokenService.issueSessionToken({
      staffUserId: staffUser.id,
      // No 2-step enabled means there is nothing left to verify — the
      // session is already fully verified.
      twoStepVerified: !staffUser.twoStepEnabled,
    });

    return { sessionToken, requiresTwoStep: staffUser.twoStepEnabled };
  }

  /**
   * Issues an OTP (via the shared `OtpService`, same SMS-OTP
   * infrastructure as patient login) against the staff user's phone.
   */
  async staffTwoStepRequest(sessionToken: string): Promise<StaffTwoStepRequestResult> {
    const payload = this.tokenService.verifySessionToken(sessionToken);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    const staffUser = await this.prisma.staffUser.findUnique({
      where: { id: payload.staffUserId },
    });
    if (!staffUser || staffUser.deactivatedAt) {
      throw new UnauthorizedException('Invalid session');
    }

    const { requestId, code } = await this.otpService.generate(
      staffUser.phone,
      OtpPurpose.STAFF_TWO_STEP,
    );

    // No SMS gateway exists yet (out of scope for this task) — log the
    // code so it can be observed in development. Never return it in the
    // HTTP response.
    this.logOtpForDevelopment(
      `Staff 2-step OTP for ${staffUser.phone} (requestId=${requestId}): ${code}`,
    );

    return { requestId };
  }

  async staffTwoStepVerify(
    sessionToken: string,
    requestId: string,
    code: string,
  ): Promise<StaffTwoStepVerifyResult> {
    const payload = this.tokenService.verifySessionToken(sessionToken);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    const staffUser = await this.prisma.staffUser.findUnique({
      where: { id: payload.staffUserId },
    });
    // Same check as `staffTwoStepRequest`: a staff user deactivated
    // after login must not be able to finish verifying an already-issued
    // session token.
    if (!staffUser || staffUser.deactivatedAt) {
      throw new UnauthorizedException('Invalid session');
    }

    // Confirm the OTP being redeemed was actually sent to *this* staff
    // user's phone. `otpService.verify` only checks the code against the
    // requestId — it has no notion of identity — so without this check
    // staff member A's valid session token could be "verified" by
    // supplying staff member B's pending OTP requestId + code, without A
    // ever having received B's code. Checked before the code comparison
    // so a mismatched OTP is rejected regardless of whether the code
    // itself happens to be correct. The purpose is checked here too, so
    // a PATIENT_LOGIN code (which may well have been issued to the same
    // phone number) can't be redeemed to complete staff 2-step.
    const otp = await this.prisma.otpCode.findUnique({ where: { id: requestId } });
    if (
      !otp ||
      otp.purpose !== OtpPurpose.STAFF_TWO_STEP ||
      otp.destination !== staffUser.phone
    ) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const isValid = await this.otpService.verify(requestId, code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const newSessionToken = this.tokenService.issueSessionToken({
      staffUserId: payload.staffUserId,
      twoStepVerified: true,
    });

    return { sessionToken: newSessionToken };
  }

  /**
   * Resolves which `StaffUserLocation` row (role + location pairing) an
   * already-logged-in staff user is acting as, and issues final
   * access/refresh tokens scoped to it.
   *
   * - Exactly one row: that row is used unconditionally — `staffUserLocationId`
   *   is ignored even if supplied. A single-role/location staff user must
   *   never be shown a picker (see plan's Review Focus).
   * - More than one row and no `staffUserLocationId`: returns the list of
   *   options for the client to present as a picker.
   * - More than one row and a `staffUserLocationId` that belongs to this
   *   staff user: issues final tokens scoped to it.
   * - More than one row and a `staffUserLocationId` that does not belong to
   *   this staff user: 400.
   */
  async resolveStaffRoleLocation(
    sessionToken: string,
    staffUserLocationId?: string,
  ): Promise<StaffRoleLocationResult> {
    const payload = this.tokenService.verifySessionToken(sessionToken);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    const staffUser = await this.prisma.staffUser.findUnique({
      where: { id: payload.staffUserId },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
        staffUserLocations: { include: { location: true } },
      },
    });
    // Same check as `staffTwoStepRequest`: a session token issued before
    // deactivation must not be exchangeable for final access/refresh
    // tokens. Having `StaffUserLocation` rows is not on its own evidence
    // that the owning staff user is still active.
    if (!staffUser || staffUser.deactivatedAt) {
      throw new UnauthorizedException('Invalid session');
    }

    if (staffUser.twoStepEnabled && !payload.twoStepVerified) {
      throw new UnauthorizedException('Two-step verification is required');
    }

    const rows = staffUser.staffUserLocations;

    // More than one assignment and the client hasn't chosen yet: hand back
    // the options instead of tokens. A staff user with a single assignment
    // never reaches this branch — see the exactly-one-row case below.
    if (rows.length > 1 && !staffUserLocationId) {
      return {
        options: rows.map((row) => ({
          staffUserLocationId: row.id,
          roleName: staffUser.role.name,
          locationName: row.location.name,
        })),
      };
    }

    // Exactly one assignment: use it directly, ignoring any
    // staffUserLocationId the client may have supplied. Otherwise, the
    // client must have chosen one of the (multiple) assignments above.
    const chosenRow =
      rows.length === 1 ? rows[0] : rows.find((row) => row.id === staffUserLocationId);
    if (!chosenRow) {
      if (rows.length === 0) {
        throw new ForbiddenException('No location assigned to this staff user');
      }
      throw new BadRequestException('staffUserLocationId does not belong to this staff user');
    }

    const permissions = computeStaffPermissions(staffUser.role);

    const accessToken = this.tokenService.issueAccessToken({
      sub: staffUser.id,
      subjectType: 'STAFF',
      permissions,
      staffUserLocationId: chosenRow.id,
    });
    const refreshToken = await this.tokenService.issueRefreshToken(
      RefreshTokenSubjectType.STAFF,
      staffUser.id,
    );

    return { accessToken, refreshToken };
  }
}
