import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, RefreshResult, RequestOtpResult, VerifyOtpResult } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshDto } from './dto/refresh.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('patient/request-otp')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestOtpDto): Promise<RequestOtpResult> {
    return this.authService.requestOtp(dto.phone);
  }

  @Post('patient/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto): Promise<VerifyOtpResult> {
    const result = await this.authService.verifyOtp(dto.requestId, dto.code);
    if (!result) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto): Promise<RefreshResult> {
    const result = await this.authService.refresh(dto.refreshToken);
    if (!result) {
      throw new UnauthorizedException('Invalid, expired, or already-rotated refresh token');
    }
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }
}
