import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Enforces `@RequirePermission(key)` on a route: the request's decoded
 * JWT `permissions` array (set on `request.user` by `JwtAuthGuard` +
 * `JwtStrategy`) must include `key`, or this throws `ForbiddenException`
 * (403) — independent of any frontend hiding of the corresponding UI.
 * Must run after `JwtAuthGuard` (e.g. `@UseGuards(JwtAuthGuard,
 * PermissionsGuard)`) so `request.user` is populated. A route with no
 * `@RequirePermission` metadata is allowed through unchanged.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const permissions: string[] = request.user?.permissions ?? [];

    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenException(`Missing required permission: ${requiredPermission}`);
    }

    return true;
  }
}
