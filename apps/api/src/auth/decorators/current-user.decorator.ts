import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessTokenClaims } from '../token.service';

/**
 * Returns the decoded, validated JWT payload (`JwtStrategy.validate`'s
 * return value) that `JwtAuthGuard` attaches to `request.user`. Must be
 * used on a route guarded by `JwtAuthGuard` — on an unguarded route
 * `request.user` is undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenClaims => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
