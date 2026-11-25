require_relative '../../spec_helper'

RSpec.describe 'POST /api/v1/auth/password/forgot' do
  it 'returns the same generic message whether or not the username exists' do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/password/forgot', { username: 'ernesta' }.to_json, { 'CONTENT_TYPE' => 'application/json' }
    existing_body = last_response.body
    expect(PasswordResetToken.count).to eq(1)

    post '/api/v1/auth/password/forgot', { username: 'nobody' }.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.body).to eq(existing_body)
    expect(PasswordResetToken.count).to eq(1)
  end

  it 'stores only a digest, and emails a link carrying the raw token in the path' do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')

    delivered = nil
    allow(Mailer).to receive(:deliver) { |args| delivered = args }

    post '/api/v1/auth/password/forgot', { username: 'ernesta' }.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)

    raw_token = delivered[:body][%r{/reset-password/(\h+)}, 1]
    expect(raw_token).not_to be_nil
    expect(delivered[:body]).to include("#{ENV['FRONTEND_URL']}/reset-password/#{raw_token}")
    expect(delivered[:body]).not_to include('reset-password?token=')

    stored = PasswordResetToken.first
    expect(stored.token_digest).to eq(PasswordResetToken.hash_token(raw_token))
    expect(stored.token_digest).not_to eq(raw_token)

    # The raw token from the link is what actually works.
    post '/api/v1/auth/password/reset',
         { token: raw_token, password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)
  end
end
