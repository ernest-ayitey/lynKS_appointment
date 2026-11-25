require 'bcrypt'

class User < Sequel::Model(:users)
  plugin :timestamps, update_on_create: true

  one_to_one :doctor_profile

  ROLES = %w[patient doctor records admin].freeze
  STATUSES = %w[active invited locked deactivated].freeze

  # Deliberately a deny-list rather than an allow-list of 'active': an
  # 'invited' staff member still has to be able to sign in with their temp
  # password to complete their first login. Every place that grants or
  # extends access (login, refresh rotation, authenticate!, password reset)
  # goes through this one predicate.
  BLOCKED_STATUSES = %w[locked deactivated].freeze

  def password=(raw)
    self.password_digest = BCrypt::Password.create(raw)
  end

  def authenticate(raw)
    BCrypt::Password.new(password_digest) == raw
  end

  def signin_blocked?
    BLOCKED_STATUSES.include?(status)
  end

  def locked?
    status == 'locked'
  end

  def deactivated?
    status == 'deactivated'
  end

  # Returns nil for anything that isn't a string, so a request body like
  # `{"username": 123}` is an ordinary "no such user" rather than a 500 on
  # NoMethodError.
  def self.find_by_username_ci(username)
    return nil unless username.is_a?(String)

    where(Sequel.function(:lower, :username) => username.downcase).first
  end
end
