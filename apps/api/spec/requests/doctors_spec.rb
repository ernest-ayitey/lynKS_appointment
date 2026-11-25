require_relative '../spec_helper'

RSpec.describe 'GET /api/v1/departments' do
  let!(:user) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  def get_departments(token)
    get '/api/v1/departments', {}, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  it 'rejects a request with no access token' do
    get '/api/v1/departments'
    expect(last_response.status).to eq(401)
  end

  it 'returns an empty array when there are no departments' do
    get_departments(TokenService.issue_access_token(user))
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq([])
  end

  it 'returns each department with its doctor_count' do
    department = Department.create(name: 'Cardiology')

    get_departments(TokenService.issue_access_token(user))
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq(
      [{ 'id' => department.id, 'name' => 'Cardiology', 'doctor_count' => 0 }]
    )
  end
end
