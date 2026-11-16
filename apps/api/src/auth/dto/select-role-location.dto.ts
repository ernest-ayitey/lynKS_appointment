import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Body for `POST /auth/staff/role-location`. `staffUserLocationId` is
 * optional on the first call (when the staff user has more than one
 * `StaffUserLocation` row, the response asks the client to choose one and
 * call back with it) and ignored entirely when the staff user has exactly
 * one row — see `AuthService.resolveStaffRoleLocation`.
 */
export class SelectRoleLocationDto {
  @IsString()
  @IsNotEmpty()
  sessionToken!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  staffUserLocationId?: string;
}
