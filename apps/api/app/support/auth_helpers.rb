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
  end

  def current_user
    @current_user ||= User[@current_user_id]
  end
end
