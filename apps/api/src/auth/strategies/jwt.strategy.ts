import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ACCESS_TOKEN_TYPE, AccessTokenClaims } from '../token.service';

/**
 * Validates the Bearer access token issued by
 * `TokenService.issueAccessToken` against the same `JWT_SECRET` used to
 * sign it (see `AuthModule`'s `JwtModule.registerAsync`). On success, the
 * decoded payload (including the `sub` claim `jsonwebtoken` restores from
 * the `subject` sign option) is attached to `request.user` — this is the
 * object `@CurrentUser()` returns and `PermissionsGuard` reads
 * `permissions` from.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not set');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Only tokens minted by `TokenService.issueAccessToken` are accepted.
   * Session tokens (issued between staff password-login and 2-step
   * verification) are signed with the same secret by the same
   * `JwtService`, so the signature alone cannot tell them apart — the
   * `typ` claim does. Rejecting anything other than `typ: 'access'`
   * keeps a session token (which carries no `sub`/`subjectType`/
   * `permissions`) out of `request.user`.
   */
  validate(payload: AccessTokenClaims & { typ?: string }): AccessTokenClaims {
    if (payload.typ !== ACCESS_TOKEN_TYPE) {
      throw new UnauthorizedException('Invalid token type');
    }
    return payload;
  }
}
