require 'digest'

class RefreshToken < Sequel::Model(:refresh_tokens)
  plugin :timestamps

  many_to_one :user

  def self.hash_token(raw)
    Digest::SHA256.hexdigest(raw)
  end

  def expired?
    expires_at < Time.now
  end

  def revoked?
    !revoked_at.nil?
  end
end
