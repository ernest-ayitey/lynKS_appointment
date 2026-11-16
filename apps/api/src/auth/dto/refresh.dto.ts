import { IsNotEmpty, IsString } from 'class-validator';

/** Shared by POST /auth/refresh and POST /auth/logout — both take { refreshToken }. */
export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
