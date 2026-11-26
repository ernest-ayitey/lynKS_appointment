require_relative '../../spec_helper'

# Covers AuthHelpers#require_role!, which has no route of its own yet —
# Task 4 (doctor session settings) will be its first real caller. Exercised
# here through a throwaway route mounted only in this spec so the helper
# gets coverage before Task 4 needs it.
class RequireRoleTestRoutes < Sinatra::Base
  helpers Sinatra::JSON
  helpers AuthHelpers

  before { authenticate! }

  get '/doctor-only' do
    require_role!('doctor')
    json(ok: true)
  end
end

RSpec.describe 'AuthHelpers#require_role!' do
  let!(:doctor) do
    User.create(role: 'doctor', username: 'docdora', email: 'doc@x.com',
                first_name: 'Dora', last_name: 'Doc', password: 'Sup3r!word')
  end

  let!(:patient) do
    User.create(role: 'patient', username: 'patpete', email: 'pat@x.com',
                first_name: 'Pat', last_name: 'Pete', password: 'Sup3r!word')
  end

  def app
    RequireRoleTestRoutes
  end

  def access_token_for(user)
    TokenService.issue_access_token(user)
  end

  def get_doctor_only(token)
    get '/doctor-only', {}, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  it 'allows a user whose role is in the allowed list' do
    get_doctor_only(access_token_for(doctor))
    expect(last_response.status).to eq(200)
  end

  it 'rejects a user whose role is not in the allowed list' do
    get_doctor_only(access_token_for(patient))
    expect(last_response.status).to eq(403)
    expect(JSON.parse(last_response.body)['error']).to eq('Forbidden')
  end
end
