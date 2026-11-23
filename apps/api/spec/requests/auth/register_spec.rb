require_relative '../../spec_helper'

RSpec.describe 'POST /api/v1/auth/register' do
  let(:valid_params) do
    { first_name: 'Ernest', last_name: 'A', date_of_birth: '1990-01-01',
      gender: 'male', email: 'e@x.com', phone: '0555', username: 'ernesta',
      password: 'Sup3r!word', password_confirmation: 'Sup3r!word', accept_terms: true }
  end

  it 'creates a patient account and logs in' do
    post '/api/v1/auth/register', valid_params.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(201)
    body = JSON.parse(last_response.body)
    expect(body['user']['role']).to eq('patient')
    expect(body['access_token']).to be_a(String)
  end

  it 'rejects a duplicate username' do
    User.create(role: 'patient', username: 'ernesta', email: 'x@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/register', valid_params.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end

  it 'rejects a weak password' do
    post '/api/v1/auth/register', valid_params.merge(password: 'weak', password_confirmation: 'weak').to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end

  it 'rejects unaccepted terms' do
    post '/api/v1/auth/register', valid_params.merge(accept_terms: false).to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end

  it 'ignores a role/status/must_change_password override attempt' do
    post '/api/v1/auth/register',
      valid_params.merge(role: 'admin', status: 'active', must_change_password: false).to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(201)

    body = JSON.parse(last_response.body)
    expect(body['user']['role']).to eq('patient')

    persisted = User.find_by_username_ci('ernesta')
    expect(persisted.role).to eq('patient')
  end
end
