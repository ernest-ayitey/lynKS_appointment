class PasswordResetToken < Sequel::Model(:password_reset_tokens)
  plugin :timestamps

  many_to_one :user

  def expired?
    expires_at < Time.now
  end

  def used?
    !used_at.nil?
  end
end
