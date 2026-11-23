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
    token = RefreshToken.first(token_hash: RefreshToken.hash_token(raw))
    return nil if token.nil? || token.expired? || token.revoked?

    token.update(revoked_at: Time.now)
    new_raw = issue_refresh_token(token.user, remember_me: token.remember_me)
    [new_raw, token.user]
  end

  def self.revoke_refresh_token(raw)
    token = RefreshToken.first(token_hash: RefreshToken.hash_token(raw))
    return nil if token.nil?

    token.update(revoked_at: Time.now)
  end
end
