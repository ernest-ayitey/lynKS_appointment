require_relative '../../spec_helper'

RSpec.describe 'POST /api/v1/auth/logout' do
  it 'revokes the refresh token so it can no longer be used to refresh' do
    user = User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    cookie = last_response.headers['Set-Cookie']
    access_token = JSON.parse(last_response.body)['access_token']

    post '/api/v1/auth/logout', {}.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => cookie, 'HTTP_AUTHORIZATION' => "Bearer #{access_token}" }
    expect(last_response.status).to eq(204)

    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => cookie }
    expect(last_response.status).to eq(401)
  end
end
