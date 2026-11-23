require_relative '../../spec_helper'

RSpec.describe 'POST /api/v1/auth/password/change' do
  let!(:user) { User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
    first_name: 'A', last_name: 'B', password: 'Sup3r!word', must_change_password: true) }

  def access_token_for(user)
    post '/api/v1/auth/login', { username: user.username, password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    JSON.parse(last_response.body)['access_token']
  end

  it 'changes the password and clears must_change_password' do
    token = access_token_for(user)
    post '/api/v1/auth/password/change',
      { current_password: 'Sup3r!word', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
    expect(last_response.status).to eq(200)
    expect(user.reload.must_change_password).to be false
    expect(user.authenticate('NewPass1!')).to be true

    body = JSON.parse(last_response.body)
    expect(body['access_token']).to be_a(String)
    expect(body['must_change_password']).to be false
    expect(body['user']['username']).to eq('ernesta')
  end

  it 'rejects the wrong current password' do
    token = access_token_for(user)
    post '/api/v1/auth/password/change',
      { current_password: 'wrong', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
    expect(last_response.status).to eq(422)
  end

  it 'rejects an unauthenticated request' do
    post '/api/v1/auth/password/change',
      { current_password: 'Sup3r!word', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(401)
  end

  it 'revokes every other session and re-establishes the caller\'s own' do
    other_raw = TokenService.issue_refresh_token(user, remember_me: false)
    other_token = RefreshToken.first(token_hash: RefreshToken.hash_token(other_raw))

    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    caller_cookie = last_response.headers['Set-Cookie']
    token = JSON.parse(last_response.body)['access_token']

    post '/api/v1/auth/password/change',
      { current_password: 'Sup3r!word', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'HTTP_COOKIE' => caller_cookie }
    expect(last_response.status).to eq(200)
    new_cookie = last_response.headers['Set-Cookie']
    expect(new_cookie).to include('refresh_token=')
    expect(new_cookie).not_to eq(caller_cookie)

    # The other session is dead.
    expect(other_token.reload.revoked?).to be true
    post '/api/v1/auth/refresh', {}.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => "refresh_token=#{other_raw}" }
    expect(last_response.status).to eq(401)

    # The caller's pre-change cookie is dead too...
    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => caller_cookie }
    expect(last_response.status).to eq(401)

    # ...but the cookie the change handed back works.
    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => new_cookie }
    expect(last_response.status).to eq(200)
  end

  it 'keeps a remembered session remembered' do
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word', remember_me: true }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    caller_cookie = last_response.headers['Set-Cookie']
    token = JSON.parse(last_response.body)['access_token']

    post '/api/v1/auth/password/change',
      { current_password: 'Sup3r!word', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'HTTP_COOKIE' => caller_cookie }
    expect(last_response.status).to eq(200)
    expect(last_response.headers['Set-Cookie']).to match(/Max-Age/)
  end

  it 'issues a session-only cookie when the caller had no refresh cookie' do
    token = access_token_for(user)

    post '/api/v1/auth/password/change',
      { current_password: 'Sup3r!word', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
    expect(last_response.status).to eq(200)
    expect(last_response.headers['Set-Cookie']).to include('refresh_token=')
    expect(last_response.headers['Set-Cookie']).not_to match(/Max-Age/)
  end
end
