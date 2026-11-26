# Sinatra helpers module reused by every authenticated route in this and
# future plans. A route class registers it with `helpers AuthHelpers` and
# calls `authenticate!` in a `before` block (or at the top of an action) to
# require a valid access token.
module AuthHelpers
  def authenticate!
    header = request.env['HTTP_AUTHORIZATION']
    scheme, jwt = header.to_s.split(' ', 2)
    claims = TokenService.decode_access_token(jwt) if scheme == 'Bearer' && jwt
    halt 401, json(error: 'Unauthorized') if claims.nil?

    @current_user_id = claims['sub']

    # Access tokens are self-contained and short-lived, so an account that is
    # locked or deactivated mid-session would otherwise keep working until
    # its current access token expired. This is the chokepoint every
    # authenticated route goes through, so the status check belongs here.
    halt 401, json(error: 'Unauthorized') if current_user.nil? || current_user.signin_blocked?

    @current_user_id
  end

  def current_user
    @current_user ||= User[@current_user_id]
  end

  # Call after `authenticate!` in a route's `before` block to restrict it to
  # specific roles. Reads the already-memoized `current_user` rather than
  # decoding the token a second time.
  def require_role!(*roles)
    halt 403, json(error: 'Forbidden') unless roles.include?(current_user.role)
  end
end
