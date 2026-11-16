import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Not explicitly named in the task brief's file list (which only calls
 * out `staff-login.dto.ts` and `staff-two-step-verify.dto.ts`), but
 * `POST /auth/staff/two-step/request` has its own distinct body shape
 * (`{ sessionToken }` only, no `requestId`/`code`), so it gets its own
 * DTO rather than sharing one — matching this module's existing
 * one-DTO-per-endpoint convention (see `request-otp.dto.ts` /
 * `verify-otp.dto.ts`).
 */
export class StaffTwoStepRequestDto {
  @IsString()
  @IsNotEmpty()
  sessionToken!: string;
}
