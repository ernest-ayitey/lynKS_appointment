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
end
