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

  it "reflects a department's real doctor_count once a doctor profile exists" do
    department = Department.create(name: 'Cardiology')
    doctor = User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
    DoctorProfile.create(user: doctor, department: department, specialty_title: 'Cardiologist')

    get_departments(TokenService.issue_access_token(user))
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq(
      [{ 'id' => department.id, 'name' => 'Cardiology', 'doctor_count' => 1 }]
    )
  end
end

RSpec.describe 'GET /api/v1/doctors' do
  let!(:user) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  def get_doctors(token, query = {})
    get '/api/v1/doctors', query, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  it 'rejects a request with no access token' do
    get '/api/v1/doctors'
    expect(last_response.status).to eq(401)
  end

  it 'returns active doctors with their department and specialty' do
    cardiology = Department.create(name: 'Cardiology')
    doctor = User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
    DoctorProfile.create(user: doctor, department: cardiology, specialty_title: 'Cardiologist')

    get_doctors(TokenService.issue_access_token(user))
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq(
      [{
        'id' => doctor.id,
        'first_name' => 'Dana',
        'last_name' => 'Who',
        'department' => { 'id' => cardiology.id, 'name' => 'Cardiology' },
        'specialty_title' => 'Cardiologist'
      }]
    )
  end

  it 'filters by department_id when given' do
    cardiology = Department.create(name: 'Cardiology')
    neurology = Department.create(name: 'Neurology')
    cardio_doc = User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
    neuro_doc = User.create(role: 'doctor', username: 'docB', email: 'docb@x.com',
      first_name: 'Nour', last_name: 'Lo', password: 'Sup3r!word')
    DoctorProfile.create(user: cardio_doc, department: cardiology, specialty_title: 'Cardiologist')
    DoctorProfile.create(user: neuro_doc, department: neurology, specialty_title: 'Neurologist')

    get_doctors(TokenService.issue_access_token(user), department_id: cardiology.id)
    expect(last_response.status).to eq(200)
    body = JSON.parse(last_response.body)
    expect(body.map { |d| d['id'] }).to eq([cardio_doc.id])
  end

  it 'excludes a doctor whose account is locked' do
    department = Department.create(name: 'Cardiology')
    locked_doctor = User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word', status: 'locked')
    DoctorProfile.create(user: locked_doctor, department: department, specialty_title: 'Cardiologist')

    get_doctors(TokenService.issue_access_token(user))
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq([])
  end

  it 'never returns a patient-role user even if queried directly' do
    get_doctors(TokenService.issue_access_token(user))
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq([])
  end
end
