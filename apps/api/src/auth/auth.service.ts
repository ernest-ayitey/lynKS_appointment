import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcrypt';
import { OtpPurpose, RefreshTokenSubjectType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
  ) {}

  async requestOtp(phone: string): Promise<RequestOtpResult> {
    const { requestId, expiresAt, code } = await this.otpService.generate(
      phone,
      OtpPurpose.PATIENT_LOGIN,
    );

    // No SMS gateway exists yet (out of scope for this task) — log the
    // code so it can be delivered/observed in development instead of
    // silently dropping it. Never return it in the HTTP response.
    this.logger.debug(`OTP for ${phone} (requestId=${requestId}): ${code}`);

    const expiresInSeconds = Math.max(
      0,
      Math.round((expiresAt.getTime() - Date.now()) / 1000),
    );
    return { requestId, expiresInSeconds };
  }

  async verifyOtp(requestId: string, code: string): Promise<VerifyOtpResult | null> {
    const otp = await this.prisma.otpCode.findUnique({ where: { id: requestId } });
    if (!otp) {
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
   * infrastructure as patient login) against the staff user's email —
   * `StaffUser` has no phone field in the schema, so email is the only
   * contact channel available for `STAFF_TWO_STEP` delivery.
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
      staffUser.email,
      OtpPurpose.STAFF_TWO_STEP,
    );

    // No SMS/email gateway exists yet (out of scope for this task) — log
    // the code so it can be observed in development. Never return it in
    // the HTTP response.
    this.logger.debug(`Staff 2-step OTP for ${staffUser.email} (requestId=${requestId}): ${code}`);

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
}
