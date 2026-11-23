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
end
