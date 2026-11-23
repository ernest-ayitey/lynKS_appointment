require_relative '../../spec_helper'

# Covers AuthHelpers#authenticate!, the chokepoint every authenticated route
# goes through. Exercised here through '/auth/password/change' because that is
# the authenticated route this plan ships; the behaviour under test belongs to
# the helper, not to that route.
RSpec.describe 'authenticated access with a still-valid access token' do
  let!(:user) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  let(:access_token) do
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    JSON.parse(last_response.body)['access_token']
  end

  def get_change_password(token)
    post '/api/v1/auth/password/change',
         { current_password: 'Sup3r!word', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  it 'allows an active account' do
    get_change_password(access_token)
    expect(last_response.status).to eq(200)
  end

  it 'rejects an account locked after the access token was issued' do
    token = access_token
    user.update(status: 'locked', locked_at: Time.now)

    get_change_password(token)
    expect(last_response.status).to eq(401)
    expect(JSON.parse(last_response.body)['error']).to eq('Unauthorized')
  end

  it 'rejects an account deactivated after the access token was issued' do
    token = access_token
    user.update(status: 'deactivated', deactivated_at: Time.now)

    get_change_password(token)
    expect(last_response.status).to eq(401)
  end

  it 'rejects a token whose user no longer exists' do
    token = access_token
    RefreshToken.where(user_id: user.id).delete
    PasswordResetToken.where(user_id: user.id).delete
    user.delete

    get_change_password(token)
    expect(last_response.status).to eq(401)
  end

  it 'still allows an invited account completing its first login' do
    user.update(status: 'invited')

    get_change_password(access_token)
    expect(last_response.status).to eq(200)
  end
end
