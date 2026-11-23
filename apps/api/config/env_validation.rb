# Boot-time validation for the configuration the auth system can't work
# without. Everything here used to be read with a plain ENV['...'] at the
# point of use, which degrades silently in exactly the wrong direction: a
# missing JWT_SECRET signs tokens with nil, and a missing or unparseable TTL
# becomes 0 via #to_i, so every token is already expired when it is issued.
# Failing at boot turns all of that into one loud, obvious startup error.
module EnvValidation
  # Must be present and non-blank.
  REQUIRED_KEYS = %w[JWT_SECRET].freeze

  # Must be present and parse to an integer greater than zero.
  REQUIRED_POSITIVE_INTEGER_KEYS = %w[
    JWT_ACCESS_TTL_SECONDS
    REFRESH_TOKEN_TTL_DAYS
    REFRESH_TOKEN_TTL_DAYS_REMEMBER
  ].freeze

  class MissingConfiguration < StandardError; end

  def self.validate!(env = ENV)
    problems = []

    (REQUIRED_KEYS + REQUIRED_POSITIVE_INTEGER_KEYS).each do |key|
      value = env[key]
      problems << "#{key} is required but is not set" if value.nil?
      problems << "#{key} is required but is blank" if value.is_a?(String) && value.strip.empty?
    end

    REQUIRED_POSITIVE_INTEGER_KEYS.each do |key|
      value = env[key]
      next if value.nil? || value.strip.empty?

      parsed = Integer(value.strip, exception: false)
      next if parsed&.positive?

      problems << "#{key} must be a positive integer (got #{value.inspect})"
    end

    return true if problems.empty?

    raise MissingConfiguration, "Invalid environment configuration:\n  - #{problems.join("\n  - ")}"
  end
end
