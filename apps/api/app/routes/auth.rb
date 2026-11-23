require 'date'
require 'json'
require 'securerandom'
require_relative 'api_base'

# Routes mounted at '/api/v1/auth'. Error responses all go through
# ApiRoutes#halt_json_error so the whole file shares one envelope; see
# ApiRoutes for its shape.
class AuthRoutes < ApiRoutes
  helpers AuthHelpers

  MAX_FAILED_LOGIN_ATTEMPTS = 5
  ACCOUNT_DISABLED_MESSAGE = "This account can't sign in right now"
  INVALID_CREDENTIALS_MESSAGE = 'Incorrect username or password'
  SESSION_EXPIRED_MESSAGE = 'Session expired, please sign in again'
  INVALID_RESET_LINK_MESSAGE = 'Invalid or expired reset link'
  USERNAME_FORMAT_MESSAGE = 'Invalid username format'
  PASSWORD_POLICY_MESSAGE = 'Password must be at least 8 characters and include a digit and a symbol'
  PASSWORD_MISMATCH_MESSAGE = "Passwords don't match"

  before do
    if request.body
      request.body.rewind
      parsed = JSON.parse(request.body.read)
      # A JSON body that isn't an object (`[1,2]`, `"x"`, `null`) must not
      # leave @payload as something that doesn't respond to #[] with a
      # string key.
      @payload = parsed.is_a?(Hash) ? parsed : {}
    else
      @payload = {}
    end
  rescue JSON::ParserError
    @payload = {}
  end

  post '/auth/login' do
    username = @payload['username']
    password = @payload['password']
    remember_me = @payload['remember_me'] == true

    user = User.find_by_username_ci(username)

    # A locked account always gets the lockout response (423), whether this
    # request is the one that trips the lock or a later attempt against an
    # already-locked account. A deactivated account gets a plain 403.
    halt_json_error 423, ACCOUNT_DISABLED_MESSAGE if user&.locked?
    halt_json_error 403, ACCOUNT_DISABLED_MESSAGE if user&.deactivated?

    unless user && user.authenticate(password)
      if user
        new_count = user.failed_login_count + 1
        if new_count >= MAX_FAILED_LOGIN_ATTEMPTS
          # Locking the account has to cut off the sessions it already has,
          # otherwise a brute-force that trips the lock leaves any session
          # opened earlier (or stolen) able to keep refreshing indefinitely.
          # savepoint: true so the pair stays atomic even if an outer
          # transaction is already open.
          DB.transaction(savepoint: true) do
            user.update(failed_login_count: new_count, status: 'locked', locked_at: Time.now)
            RefreshToken.where(user_id: user.id, revoked_at: nil).update(revoked_at: Time.now)
          end
          halt_json_error 423, ACCOUNT_DISABLED_MESSAGE
        else
          user.update(failed_login_count: new_count)
        end
      end
      halt_json_error 401, INVALID_CREDENTIALS_MESSAGE
    end

    user.update(failed_login_count: 0)

    json(session_payload(user, start_session(user, remember_me: remember_me)))
  end

  post '/auth/refresh' do
    raw_refresh_token = request.cookies['refresh_token']
    halt_json_error 401, SESSION_EXPIRED_MESSAGE if raw_refresh_token.nil? || raw_refresh_token.empty?

    result = TokenService.rotate_refresh_token(raw_refresh_token)
    halt_json_error 401, SESSION_EXPIRED_MESSAGE if result.nil?

    new_raw_refresh_token, user = result
    access_token = TokenService.issue_access_token(user)
    remember_me = RefreshToken.first(token_hash: RefreshToken.hash_token(new_raw_refresh_token)).remember_me
    set_refresh_cookie(new_raw_refresh_token, remember_me: remember_me)

    json(access_token: access_token)
  end

  post '/auth/logout' do
    authenticate!

    raw_refresh_token = request.cookies['refresh_token']
    TokenService.revoke_refresh_token(raw_refresh_token) if raw_refresh_token && !raw_refresh_token.empty?

    response.headers['Set-Cookie'] = 'refresh_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
    status 204
  end

  get '/auth/username-availability' do
    username = params['username']
    unless username_format_valid?(username)
      halt_json_error 422, USERNAME_FORMAT_MESSAGE, username: USERNAME_FORMAT_MESSAGE
    end

    json(available: User.find_by_username_ci(username).nil?)
  end

  post '/auth/register' do
    username = @payload['username']
    password = @payload['password']
    date_of_birth = @payload['date_of_birth']
    parsed_date_of_birth = parse_date(date_of_birth)

    errors = {}
    errors[:username] = USERNAME_FORMAT_MESSAGE unless username_format_valid?(username)
    errors[:username] = 'Username is already taken' if errors[:username].nil? && User.find_by_username_ci(username)
    errors[:password] = PASSWORD_POLICY_MESSAGE unless password_policy_valid?(password)
    errors[:password_confirmation] = PASSWORD_MISMATCH_MESSAGE unless password == @payload['password_confirmation']
    # The users table has these NOT NULL, and Sequel's typecaster rejects
    # non-string values for a string column, so without these checks
    # ordinary bad input reaches the database and surfaces as a 500.
    errors[:email] = 'Email is required' unless present_string?(@payload['email'])
    errors[:first_name] = 'First name is required' unless present_string?(@payload['first_name'])
    errors[:last_name] = 'Last name is required' unless present_string?(@payload['last_name'])
    errors[:phone] = 'Enter a valid phone number' unless optional_string?(@payload['phone'])
    errors[:gender] = 'Enter a valid gender' unless optional_string?(@payload['gender'])
    errors[:date_of_birth] = 'Enter a valid date of birth' if !date_of_birth.nil? && parsed_date_of_birth.nil?
    errors[:accept_terms] = 'You must accept the terms' unless @payload['accept_terms'] == true
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    user = User.create(
      role: 'patient',
      status: 'active',
      must_change_password: false,
      username: username,
      password: password,
      email: @payload['email'],
      phone: @payload['phone'],
      first_name: @payload['first_name'],
      last_name: @payload['last_name'],
      date_of_birth: parsed_date_of_birth,
      gender: @payload['gender']
    )

    status 201
    json(session_payload(user, start_session(user, remember_me: false)))
  end

  post '/auth/password/forgot' do
    username = @payload['username']
    user = User.find_by_username_ci(username)

    if user
      # Only the digest is persisted; the raw token leaves the server solely
      # inside the link below.
      raw_token = SecureRandom.hex(16)
      PasswordResetToken.create(
        user: user,
        token_digest: PasswordResetToken.hash_token(raw_token),
        expires_at: Time.now + 1800
      )

      # Path parameter, not a query string: the frontend route declared in
      # the design spec is '/reset-password/:token'.
      reset_link = "#{ENV['FRONTEND_URL']}/reset-password/#{raw_token}"
      Mailer.deliver(
        to: user.email,
        subject: 'Reset your password',
        body: "Use the link below to reset your password:\n\n#{reset_link}"
      )
    end

    # Same response whether or not the username exists, so the client can't
    # use this endpoint to probe which usernames are registered.
    json(message: 'If that username exists, a reset link has been sent')
  end

  post '/auth/password/reset' do
    raw_token = @payload['token']
    password = @payload['password']

    digest = raw_token.is_a?(String) ? PasswordResetToken.hash_token(raw_token) : nil
    reset_token = digest && PasswordResetToken.first(token_digest: digest)
    halt_json_error 422, INVALID_RESET_LINK_MESSAGE if reset_token.nil? || reset_token.expired? || reset_token.used?

    user = reset_token.user

    # A deactivated account is not reactivated — and is certainly not handed
    # a working session — by resetting its password. A locked one is: the
    # reset link is the self-service way out of a lockout, so the lock state
    # is cleared below once the new password is accepted.
    halt_json_error 403, ACCOUNT_DISABLED_MESSAGE if user.deactivated?

    errors = {}
    errors[:password] = PASSWORD_POLICY_MESSAGE unless password_policy_valid?(password)
    errors[:password_confirmation] = PASSWORD_MISMATCH_MESSAGE unless password == @payload['password_confirmation']
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    unlocked_status = user.locked? ? 'active' : user.status

    # The read above is only a fast path for the obvious rejections. The
    # claim itself has to be one conditional UPDATE keyed on the token still
    # being unused and unexpired, or two concurrent requests carrying the
    # same token could both pass the used?/expired? check above and both go
    # on to reset the password. Same pattern as
    # TokenService.rotate_refresh_token.
    #
    # The claim, the password write, and the session revocation share one
    # transaction so a failure part-way through can't burn the token without
    # changing the password (or vice versa). savepoint: true so the block
    # stays atomic even when it runs inside an outer transaction.
    claimed = 0
    DB.transaction(savepoint: true) do
      claimed = PasswordResetToken
                .where(token_digest: digest, used_at: nil)
                .where { expires_at > Time.now }
                .update(used_at: Time.now)
      # Nothing has been written yet, so leaving the block is enough.
      next unless claimed == 1

      user.update(password: password, failed_login_count: 0, locked_at: nil, status: unlocked_status)
      RefreshToken.where(user_id: user.id, revoked_at: nil).update(revoked_at: Time.now)
    end
    halt_json_error 422, INVALID_RESET_LINK_MESSAGE unless claimed == 1

    json(session_payload(user, start_session(user, remember_me: false)))
  end

  before '/auth/password/change' do
    authenticate!
  end

  post '/auth/password/change' do
    current_password = @payload['current_password']
    password = @payload['password']

    errors = {}
    errors[:current_password] = 'Incorrect current password' unless current_user.authenticate(current_password)
    errors[:password] = PASSWORD_POLICY_MESSAGE unless password_policy_valid?(password)
    errors[:password_confirmation] = PASSWORD_MISMATCH_MESSAGE unless password == @payload['password_confirmation']
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    # Changing a password has to end every other session the account has —
    # that is the whole point of changing it after a suspected compromise.
    # The caller's own session is re-established below, otherwise its next
    # refresh would 401 and we'd have traded one bug for another.
    raw_refresh_token = request.cookies['refresh_token']
    remember_me = remembered_session?(raw_refresh_token)

    DB.transaction(savepoint: true) do
      current_user.update(password: password, must_change_password: false)
      RefreshToken.where(user_id: current_user.id, revoked_at: nil).update(revoked_at: Time.now)
    end

    json(session_payload(current_user, start_session(current_user, remember_me: remember_me)))
  end

  # Whether the refresh token the caller presented was a "remember me" one,
  # so re-issuing the caller's session doesn't silently downgrade it.
  def remembered_session?(raw_token)
    return false if raw_token.nil? || raw_token.empty?

    RefreshToken.first(token_hash: RefreshToken.hash_token(raw_token))&.remember_me == true
  end

  # Issues the access/refresh pair for a newly established session and sets
  # the refresh cookie. Shared by login, register, and password reset.
  def start_session(user, remember_me:)
    raw_refresh_token = TokenService.issue_refresh_token(user, remember_me: remember_me)
    set_refresh_cookie(raw_refresh_token, remember_me: remember_me)
    TokenService.issue_access_token(user)
  end

  # The body every route that establishes a session returns, so the client
  # sees one shape no matter how the session began.
  def session_payload(user, access_token)
    {
      access_token: access_token,
      must_change_password: user.must_change_password,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name
      }
    }
  end

  # Sets the refresh token as an HttpOnly cookie. Reused by Tasks 8
  # (refresh), 10, and 12 wherever a refresh token needs to be (re)issued.
  def set_refresh_cookie(raw_token, remember_me:)
    attributes = ["refresh_token=#{raw_token}", 'Path=/']
    if remember_me
      max_age = Integer(ENV.fetch('REFRESH_TOKEN_TTL_DAYS_REMEMBER')) * 86_400
      attributes << "Max-Age=#{max_age}"
    end
    attributes << 'HttpOnly'
    attributes << 'SameSite=Lax'
    attributes << 'Secure' if ENV['RACK_ENV'] != 'test'
    response.headers['Set-Cookie'] = attributes.join('; ')
  end

  # Validates username format: 4-20 characters, alphanumeric plus dots and underscores.
  # Reused by Task 11 (register) and Task 10 (username-availability).
  def username_format_valid?(username)
    return false unless username.is_a?(String)

    /\A[A-Za-z0-9._]{4,20}\z/.match?(username)
  end

  # Validates password strength: at least 8 characters, with at least one
  # digit and one symbol. Reused by Task 11 (register), Task 12 (reset
  # password), and Task 13 (change password).
  def password_policy_valid?(password)
    return false unless password.is_a?(String)

    password.length >= 8 && password.match?(/\d/) && password.match?(/[^A-Za-z0-9]/)
  end

  def present_string?(value)
    value.is_a?(String) && !value.strip.empty?
  end

  def optional_string?(value)
    value.nil? || value.is_a?(String)
  end

  # Returns the parsed Date, or nil for anything that isn't an ISO-8601 date,
  # so a malformed value becomes a 422 rather than a typecaster blow-up.
  def parse_date(value)
    return nil unless value.is_a?(String)

    Date.iso8601(value)
  rescue ArgumentError
    nil
  end
end
