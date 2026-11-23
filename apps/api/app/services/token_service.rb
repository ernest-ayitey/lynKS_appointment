require 'jwt'
require 'securerandom'

class TokenService
  ALGORITHM = 'HS256'

  def self.issue_access_token(user)
    payload = {
      sub: user.id,
      role: user.role,
      exp: Time.now.to_i + ENV['JWT_ACCESS_TTL_SECONDS'].to_i
    }
    JWT.encode(payload, ENV['JWT_SECRET'], ALGORITHM)
  end

  def self.decode_access_token(jwt)
    JWT.decode(jwt, ENV['JWT_SECRET'], true, algorithm: ALGORITHM).first
  rescue JWT::DecodeError
    nil
  end

  def self.issue_refresh_token(user, remember_me:)
    raw = SecureRandom.hex(32)
    ttl_days = remember_me ? ENV['REFRESH_TOKEN_TTL_DAYS_REMEMBER'].to_i : ENV['REFRESH_TOKEN_TTL_DAYS'].to_i

    RefreshToken.create(
      user: user,
      token_hash: RefreshToken.hash_token(raw),
      remember_me: remember_me,
      expires_at: Time.now + ttl_days * 86_400
    )

    raw
  end

  def self.rotate_refresh_token(raw)
    hash = RefreshToken.hash_token(raw)

    # Atomically claim the token: only a row that is currently unrevoked and
    # unexpired gets revoked_at set, and only by whichever caller's UPDATE
    # reaches MySQL first. If two callers race on the same raw token, at
    # most one UPDATE affects a row, so a token can only ever be redeemed
    # once, even under concurrent rotation attempts.
    claimed = RefreshToken
              .where(token_hash: hash, revoked_at: nil)
              .where { expires_at > Time.now }
              .update(revoked_at: Time.now)
    return nil unless claimed == 1

    token = RefreshToken.first(token_hash: hash)
    user = token&.user

    # A locked or deactivated account must not be able to extend its session
    # off a refresh token that was issued before the block. Failing the same
    # way as any other invalid token keeps the caller's handling uniform. The
    # claim above already revoked the row, which is correct: the token is
    # dead and the account has to go through login (or a reset) to recover.
    return nil if user.nil? || user.signin_blocked?

    new_raw = issue_refresh_token(user, remember_me: token.remember_me)
    [new_raw, user]
  end

  def self.revoke_refresh_token(raw)
    token = RefreshToken.first(token_hash: RefreshToken.hash_token(raw))
    return nil if token.nil?

    token.update(revoked_at: Time.now)
  end
end
