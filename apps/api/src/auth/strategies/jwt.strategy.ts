import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessTokenClaims } from '../token.service';

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

  validate(payload: AccessTokenClaims): AccessTokenClaims {
    return payload;
  }
}
