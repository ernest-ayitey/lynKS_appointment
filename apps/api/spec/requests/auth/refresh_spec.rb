require_relative '../../spec_helper'

RSpec.describe 'POST /api/v1/auth/refresh' do
  it 'issues a new access token when the refresh cookie is valid, and rotates it' do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    cookie = last_response.headers['Set-Cookie']

    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => cookie }
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)['access_token']).to be_a(String)
    new_cookie = last_response.headers['Set-Cookie']
    expect(new_cookie).not_to eq(cookie)
  end

  it 'rejects a missing or invalid refresh cookie' do
    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(401)
  end

  it 'rejects a refresh once the account has been locked mid-session' do
    user = User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                       first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    cookie = last_response.headers['Set-Cookie']

    user.update(status: 'locked', locked_at: Time.now)

    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => cookie }
    expect(last_response.status).to eq(401)
  end

  it 'rejects a refresh once the account has been deactivated mid-session' do
    user = User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                       first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    cookie = last_response.headers['Set-Cookie']

    user.update(status: 'deactivated', deactivated_at: Time.now)

    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => cookie }
    expect(last_response.status).to eq(401)
  end
end
