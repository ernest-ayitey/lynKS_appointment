import { IsNotEmpty, IsString } from 'class-validator';

export class StaffTwoStepVerifyDto {
  @IsString()
  @IsNotEmpty()
  sessionToken!: string;

  @IsString()
  @IsNotEmpty()
  requestId!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}
