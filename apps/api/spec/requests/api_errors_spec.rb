require_relative '../spec_helper'

RSpec.describe 'JSON error handling under /api/v1' do
  it 'returns a JSON 404 for an unmatched route' do
    post '/api/v1/auth/does-not-exist', {}.to_json, { 'CONTENT_TYPE' => 'application/json' }

    expect(last_response.status).to eq(404)
    expect(last_response.headers['Content-Type']).to include('application/json')
    expect(JSON.parse(last_response.body)).to eq('error' => 'Not found')
  end

  it 'returns a JSON 404 for an unmatched method on a known path' do
    get '/api/v1/auth/login'

    expect(last_response.status).to eq(404)
    expect(JSON.parse(last_response.body)).to eq('error' => 'Not found')
  end

  describe 'an unhandled exception' do
    # Sinatra re-raises instead of running error handlers in the test
    # environment, so the handler production relies on would never be
    # exercised. Turn that off for this example only.
    around do |example|
      original = AuthRoutes.settings.raise_errors?
      AuthRoutes.set(:raise_errors, false)
      example.run
      AuthRoutes.set(:raise_errors, original)
    end

    it 'renders the JSON error envelope instead of an HTML page' do
      allow(User).to receive(:find_by_username_ci).and_raise(StandardError, 'boom')

      post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
           { 'CONTENT_TYPE' => 'application/json' }

      expect(last_response.status).to eq(500)
      expect(last_response.headers['Content-Type']).to include('application/json')
      expect(JSON.parse(last_response.body)).to eq('error' => 'Something went wrong')
    end
  end
end

RSpec.describe 'bad input that used to reach the database or a string method' do
  it 'treats a non-string username on login as no such user' do
    post '/api/v1/auth/login', { username: 123, password: 'Sup3r!word' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }

    expect(last_response.status).to eq(401)
    expect(JSON.parse(last_response.body)['error']).to eq('Incorrect username or password')
  end

  it 'treats a missing username and password on login as no such user' do
    post '/api/v1/auth/login', {}.to_json, { 'CONTENT_TYPE' => 'application/json' }

    expect(last_response.status).to eq(401)
  end

  it 'rejects a non-string username on username-availability' do
    get '/api/v1/auth/username-availability'

    expect(last_response.status).to eq(422)
    body = JSON.parse(last_response.body)
    expect(body['error']).to eq('Invalid username format')
    expect(body['errors']).to eq('username' => 'Invalid username format')
  end

  it 'rejects a non-string username on register' do
    post '/api/v1/auth/register', { username: 123 }.to_json, { 'CONTENT_TYPE' => 'application/json' }

    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to include('username')
  end

  it 'rejects a non-object JSON body' do
    post '/api/v1/auth/register', '[1, 2, 3]', { 'CONTENT_TYPE' => 'application/json' }

    expect(last_response.status).to eq(422)
  end

  it 'rejects a non-string reset token' do
    post '/api/v1/auth/password/reset', { token: 123, password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }

    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)).to eq('error' => 'Invalid or expired reset link')
  end

  it 'treats a non-string username on password/forgot as no such user' do
    post '/api/v1/auth/password/forgot', { username: 123 }.to_json, { 'CONTENT_TYPE' => 'application/json' }

    expect(last_response.status).to eq(200)
    expect(PasswordResetToken.count).to eq(0)
  end
end

RSpec.describe 'the shared error envelope' do
  it 'omits errors when there are no field-level messages' do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')

    post '/api/v1/auth/login', { username: 'ernesta', password: 'nope' }.to_json,
         { 'CONTENT_TYPE' => 'application/json' }

    expect(JSON.parse(last_response.body).keys).to eq(['error'])
  end

  it 'carries both a summary and field messages for a validation failure' do
    post '/api/v1/auth/register', { username: 'ok' }.to_json, { 'CONTENT_TYPE' => 'application/json' }

    body = JSON.parse(last_response.body)
    expect(last_response.status).to eq(422)
    expect(body['error']).to eq('Please correct the highlighted fields')
    expect(body['errors']).to be_a(Hash)
  end

  it 'uses the same shape for an authentication failure' do
    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json' }

    expect(JSON.parse(last_response.body)).to eq('error' => 'Session expired, please sign in again')
  end
end
