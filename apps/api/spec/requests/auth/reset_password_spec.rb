require_relative '../../spec_helper'

RSpec.describe 'POST /api/v1/auth/password/reset' do
  let!(:user) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end
  let!(:token) { PasswordResetToken.create(user: user, token: 'tok123', expires_at: Time.now + 1800) }

  it 'resets the password and logs in' do
    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)
    expect(user.reload.authenticate('NewPass1!')).to be true
  end

  it 'rejects a token that was already used' do
    token.update(used_at: Time.now)
    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end

  it 'rejects an expired token' do
    token.update(expires_at: Time.now - 1)
    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end

  it 'revokes every existing refresh token for the user, not just the current session' do
    raw_a = TokenService.issue_refresh_token(user, remember_me: false)
    raw_b = TokenService.issue_refresh_token(user, remember_me: false)
    token_a = RefreshToken.first(token_hash: RefreshToken.hash_token(raw_a))
    token_b = RefreshToken.first(token_hash: RefreshToken.hash_token(raw_b))
    expect(token_a.revoked?).to be false
    expect(token_b.revoked?).to be false

    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)

    expect(token_a.reload.revoked?).to be true
    expect(token_b.reload.revoked?).to be true
    expect(RefreshToken.where(user_id: user.id, revoked_at: nil).count).to eq(1) # only the fresh token issued by this reset
  end
end
