import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Enforces a valid, unexpired Bearer access token (via `JwtStrategy`).
 * Throws `UnauthorizedException` (401) for a missing, malformed, expired,
 * or wrong-signature token. On success, populates `request.user` with the
 * decoded `AccessTokenClaims`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
