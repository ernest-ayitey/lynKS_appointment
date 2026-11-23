require_relative '../../spec_helper'

RSpec.describe 'POST /api/v1/auth/password/reset' do
  let!(:user) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end
  let!(:token) do
    PasswordResetToken.create(user: user, token_digest: PasswordResetToken.hash_token('tok123'),
                              expires_at: Time.now + 1800)
  end

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

  it 'clears the lock so a locked account can sign in again afterward' do
    user.update(status: 'locked', locked_at: Time.now, failed_login_count: 5)

    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)

    expect(user.reload.status).to eq('active')
    expect(user.locked_at).to be_nil
    expect(user.failed_login_count).to eq(0)

    post '/api/v1/auth/login', { username: 'ernesta', password: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)
  end

  it 'rejects the reset for a deactivated account and hands out no session' do
    user.update(status: 'deactivated', deactivated_at: Time.now)

    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(403)
    expect(last_response.headers['Set-Cookie']).to be_nil
    expect(JSON.parse(last_response.body)).not_to have_key('access_token')

    expect(user.reload.status).to eq('deactivated')
    expect(user.authenticate('Sup3r!word')).to be true
    expect(token.reload.used?).to be false
  end

  it 'leaves an invited account on its invited status' do
    user.update(status: 'invited')

    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)
    expect(user.reload.status).to eq('invited')
  end

  it 'rejects a token that only matches the stored digest, not the stored value' do
    post '/api/v1/auth/password/reset',
         { token: token.token_digest, password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
    expect(user.reload.authenticate('Sup3r!word')).to be true
  end

  it 'claims the token atomically, so a request racing on a stale read cannot reuse it' do
    # Stands in for the TOCTOU window: this request read the row while it was
    # still unused, and a concurrent request consumed it before this one got
    # to its own write. The conditional UPDATE has to affect zero rows.
    stale_read = PasswordResetToken.first(id: token.id)
    allow(PasswordResetToken).to receive(:first).and_return(stale_read)
    token.update(used_at: Time.now)
    expect(stale_read.used?).to be false

    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }

    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)).to eq('error' => 'Invalid or expired reset link')
    expect(user.reload.authenticate('Sup3r!word')).to be true
  end

  it 'rejects a second use of the same link' do
    body = { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json
    post '/api/v1/auth/password/reset', body, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)

    post '/api/v1/auth/password/reset',
         { token: 'tok123', password: 'Other2@pass', password_confirmation: 'Other2@pass' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
    expect(user.reload.authenticate('NewPass1!')).to be true
  end

  it 'leaves nothing half-done when a write fails part-way through' do
    allow(RefreshToken).to receive(:where).and_raise(StandardError, 'boom')

    expect do
      post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
           { 'CONTENT_TYPE' => 'application/json' }
    end.to raise_error(StandardError, 'boom')

    expect(user.reload.authenticate('Sup3r!word')).to be true
    expect(token.reload.used?).to be false
  end
end
