require 'sinatra/base'
require 'sinatra/json'
require 'json'

# Routes mounted at '/api/v1/auth'. Task 7 starts this file with login;
# later tasks (8, 10, 12) add refresh/logout/password-reset routes here.
class AuthRoutes < Sinatra::Base
  helpers Sinatra::JSON
  helpers AuthHelpers

  MAX_FAILED_LOGIN_ATTEMPTS = 5
  ACCOUNT_DISABLED_MESSAGE = "This account can't sign in right now"

  before do
    if request.body
      request.body.rewind
      @payload = JSON.parse(request.body.read)
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

    user = username && User.find_by_username_ci(username)

    # A locked account always gets the lockout response (423), whether this
    # request is the one that trips the lock or a later attempt against an
    # already-locked account. A deactivated account gets a plain 403.
    halt 423, json(error: ACCOUNT_DISABLED_MESSAGE) if user&.status == 'locked'
    halt 403, json(error: ACCOUNT_DISABLED_MESSAGE) if user&.status == 'deactivated'

    unless user && user.authenticate(password)
      if user
        new_count = user.failed_login_count + 1
        if new_count >= MAX_FAILED_LOGIN_ATTEMPTS
          user.update(failed_login_count: new_count, status: 'locked', locked_at: Time.now)
          halt 423, json(error: ACCOUNT_DISABLED_MESSAGE)
        else
          user.update(failed_login_count: new_count)
        end
      end
      halt 401, json(error: 'Incorrect username or password')
    end

    user.update(failed_login_count: 0)

    access_token = TokenService.issue_access_token(user)
    raw_refresh_token = TokenService.issue_refresh_token(user, remember_me: remember_me)
    set_refresh_cookie(raw_refresh_token, remember_me: remember_me)

    json(
      access_token: access_token,
      must_change_password: user.must_change_password,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name
      }
    )
  end

  post '/auth/refresh' do
    raw_refresh_token = request.cookies['refresh_token']
    halt 401, json(error: 'Session expired, please sign in again') if raw_refresh_token.nil? || raw_refresh_token.empty?

    result = TokenService.rotate_refresh_token(raw_refresh_token)
    halt 401, json(error: 'Session expired, please sign in again') if result.nil?

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
    halt 422, json(error: 'Invalid username format') unless username_format_valid?(username)

    json(available: User.find_by_username_ci(username).nil?)
  end

  # Sets the refresh token as an HttpOnly cookie. Reused by Tasks 8
  # (refresh), 10, and 12 wherever a refresh token needs to be (re)issued.
  def set_refresh_cookie(raw_token, remember_me:)
    attributes = ["refresh_token=#{raw_token}", 'Path=/']
    if remember_me
      max_age = ENV['REFRESH_TOKEN_TTL_DAYS_REMEMBER'].to_i * 86_400
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
    /\A[A-Za-z0-9._]{4,20}\z/.match?(username) if username
  end
end
