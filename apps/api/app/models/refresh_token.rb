require_relative '../support/token_hashing'

class RefreshToken < Sequel::Model(:refresh_tokens)
  plugin :timestamps

  extend TokenHashing

  many_to_one :user

  def expired?
    expires_at < Time.now
  end

  def revoked?
    !revoked_at.nil?
  end
end
