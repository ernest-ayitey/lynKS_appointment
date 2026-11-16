import { SetMetadata } from '@nestjs/common';

/** Metadata key `PermissionsGuard` reads to find the required permission key. */
export const PERMISSION_KEY = 'requirePermission';

/**
 * Marks a controller method as requiring the given permission key to be
 * present in the caller's JWT `permissions` claim. Must be paired with
 * `@UseGuards(JwtAuthGuard, PermissionsGuard)` — this decorator only
 * attaches metadata, it does not enforce anything by itself.
 */
export const RequirePermission = (key: string) => SetMetadata(PERMISSION_KEY, key);
