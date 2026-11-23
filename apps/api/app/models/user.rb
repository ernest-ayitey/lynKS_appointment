require 'bcrypt'

class User < Sequel::Model(:users)
  plugin :timestamps, update_on_create: true

  ROLES = %w[patient doctor records admin].freeze
  STATUSES = %w[active invited locked deactivated].freeze

  def password=(raw)
    self.password_digest = BCrypt::Password.create(raw)
  end

  def authenticate(raw)
    BCrypt::Password.new(password_digest) == raw
  end

  def self.find_by_username_ci(username)
    where(Sequel.function(:lower, :username) => username.downcase).first
  end
end
