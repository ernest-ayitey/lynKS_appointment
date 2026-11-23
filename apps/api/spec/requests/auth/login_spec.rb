require_relative '../../spec_helper'

RSpec.describe 'POST /api/v1/auth/login' do
  let!(:user) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'Ernest', last_name: 'A', password: 'Sup3r!word')
  end

  it 'logs in with correct credentials' do
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)
    body = JSON.parse(last_response.body)
    expect(body['access_token']).to be_a(String)
    expect(body['user']['username']).to eq('ernesta')
    expect(last_response.headers['Set-Cookie']).to include('refresh_token=')
  end

  it 'rejects the wrong password without revealing which field was wrong' do
    post '/api/v1/auth/login', { username: 'ernesta', password: 'nope' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(401)
    expect(JSON.parse(last_response.body)['error']).to eq('Incorrect username or password')
  end

  it 'locks the account after 5 failed attempts and rejects the 6th even with the right password' do
    5.times do
      post '/api/v1/auth/login', { username: 'ernesta', password: 'nope' }.to_json,
           { 'CONTENT_TYPE' => 'application/json' }
    end
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(423)
    expect(user.reload.status).to eq('locked')
  end

  it 'rejects a deactivated account' do
    user.update(status: 'deactivated')
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(403)
  end

  it 'sets a long-lived cookie only when remember_me is true' do
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word', remember_me: true }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.headers['Set-Cookie']).to match(/refresh_token=.*Max-Age/)

    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word', remember_me: false }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.headers['Set-Cookie']).not_to match(/Max-Age/)
  end
end
