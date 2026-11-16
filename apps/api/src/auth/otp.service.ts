import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashesEqual, hmacSha256Hex } from './hash.util';

const CODE_LENGTH = 6;
const CODE_SPACE = 10 ** CODE_LENGTH;
const EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export interface GeneratedOtp {
  requestId: string;
  expiresAt: Date;
  /**
   * The plaintext code, returned only to the direct caller (never
   * persisted). The caller is responsible for delivering it to the user
   * (e.g. via SMS); this task does not implement an SMS gateway, so
   * callers must not forward this value in any HTTP response.
   */
  code: string;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async generate(destination: string, purpose: OtpPurpose): Promise<GeneratedOtp> {
    const code = this.generateCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

    const otp = await this.prisma.otpCode.create({
      data: { destination, purpose, codeHash, expiresAt },
    });

    return { requestId: otp.id, expiresAt: otp.expiresAt, code };
  }

  /**
   * Verifies `code` against the OTP identified by `requestId`.
   *
   * Enforces single-use (returns false once `consumedAt` is set) and a
   * lockout after `MAX_ATTEMPTS` wrong guesses — once attempts reach the
   * limit, every subsequent call returns false regardless of the code
   * supplied, including the correct one.
   */
  async verify(requestId: string, code: string): Promise<boolean> {
    const otp = await this.prisma.otpCode.findUnique({ where: { id: requestId } });

    if (!otp || otp.consumedAt || otp.attempts >= MAX_ATTEMPTS) {
      return false;
    }
    if (otp.expiresAt.getTime() < Date.now()) {
      return false;
    }

    if (!hashesEqual(this.hashCode(code), otp.codeHash)) {
      await this.prisma.otpCode.update({
        where: { id: requestId },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }

    await this.prisma.otpCode.update({
      where: { id: requestId },
      data: { consumedAt: new Date() },
    });
    return true;
  }

  private generateCode(): string {
    return randomInt(0, CODE_SPACE).toString().padStart(CODE_LENGTH, '0');
  }

  private hashCode(code: string): string {
    return hmacSha256Hex(code, this.getSecret());
  }

  private getSecret(): string {
    const secret = this.config.get<string>('TOKEN_HASH_SECRET');
    if (!secret) {
      throw new Error('TOKEN_HASH_SECRET is not set');
    }
    return secret;
  }
}
