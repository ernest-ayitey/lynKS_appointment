import { Injectable, Logger } from '@nestjs/common';
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
}
