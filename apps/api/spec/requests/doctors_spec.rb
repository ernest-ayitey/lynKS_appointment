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

RSpec.describe 'GET /api/v1/doctors/:id/availability' do
  let!(:patient) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  let!(:doctor) do
    User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
  end

  def get_public_availability(token, doctor_id, query = {})
    get "/api/v1/doctors/#{doctor_id}/availability", query, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  def put_own_availability(token, body)
    put '/api/v1/doctor/availability', body.to_json,
        { 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'CONTENT_TYPE' => 'application/json' }
  end

  it "returns the same dates as the doctor's own GET /doctor/availability" do
    put_own_availability(TokenService.issue_access_token(doctor), { set: %w[2027-01-05 2027-01-20] })

    get_public_availability(TokenService.issue_access_token(patient), doctor.id, month: '2027-01')
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq('days' => %w[2027-01-05 2027-01-20])
  end

  it 'succeeds for a patient-role caller since this path has no role restriction' do
    get_public_availability(TokenService.issue_access_token(patient), doctor.id, month: '2027-01')
    expect(last_response.status).to eq(200)
  end

  it 'defaults to the current month when the month param is omitted' do
    today = Date.today
    put_own_availability(TokenService.issue_access_token(doctor), { set: [today.iso8601] })

    get_public_availability(TokenService.issue_access_token(patient), doctor.id)
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq('days' => [today.iso8601])
  end

  it 'rejects an unparseable month with 422' do
    get_public_availability(TokenService.issue_access_token(patient), doctor.id, month: 'foo')
    expect(last_response.status).to eq(422)
  end

  it 'returns 404 for an unknown doctor id' do
    get_public_availability(TokenService.issue_access_token(patient), -1, month: '2027-01')
    expect(last_response.status).to eq(404)
  end

  it 'returns 404 for a locked doctor id, not just omitting it like the list does' do
    locked_doctor = User.create(role: 'doctor', username: 'docL', email: 'docl@x.com',
      first_name: 'Lee', last_name: 'Locked', password: 'Sup3r!word', status: 'locked')

    get_public_availability(TokenService.issue_access_token(patient), locked_doctor.id, month: '2027-01')
    expect(last_response.status).to eq(404)
  end

  it 'returns 404 for a deactivated doctor id' do
    deactivated_doctor = User.create(role: 'doctor', username: 'docD', email: 'docd@x.com',
      first_name: 'Dee', last_name: 'Active', password: 'Sup3r!word', status: 'deactivated')

    get_public_availability(TokenService.issue_access_token(patient), deactivated_doctor.id, month: '2027-01')
    expect(last_response.status).to eq(404)
  end
end

RSpec.describe 'GET /api/v1/doctors/:id/slots' do
  let!(:patient) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
                first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  let!(:doctor) do
    User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
  end

  def get_slots(token, doctor_id, query = {})
    get "/api/v1/doctors/#{doctor_id}/slots", query, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  def put_session_settings(token, body)
    put '/api/v1/doctor/session-settings', body.to_json,
        { 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'CONTENT_TYPE' => 'application/json' }
  end

  it 'returns the default-schedule slots when the doctor has no session settings row yet' do
    get_slots(TokenService.issue_access_token(patient), doctor.id, date: '2027-01-05')
    expect(last_response.status).to eq(200)

    # Defaults are 09:00-17:00 in 20-minute slots with no break: 480 / 20 = 24 slots.
    body = JSON.parse(last_response.body)
    expect(body['slots'].length).to eq(24)
    expect(body['slots'].first).to eq('09:00')
    expect(body['slots'].last).to eq('16:40')
  end

  it 'returns the exact count and spacing implied by saved session settings, with no break' do
    put_session_settings(
      TokenService.issue_access_token(doctor),
      { start_time: '09:00', end_time: '17:00', slot_length_minutes: 20,
        max_patients_per_day: nil, break_start: nil, break_end: nil }
    )

    get_slots(TokenService.issue_access_token(patient), doctor.id, date: '2027-01-05')
    expect(last_response.status).to eq(200)

    # 09:00-17:00 is 480 minutes; 480 / 20 = 24 slots, stepping from 09:00 and
    # stopping before 17:00 (last slot starts at 16:40).
    expect(JSON.parse(last_response.body)).to eq(
      'slots' => %w[
        09:00 09:20 09:40 10:00 10:20 10:40 11:00 11:20 11:40 12:00 12:20 12:40
        13:00 13:20 13:40 14:00 14:20 14:40 15:00 15:20 15:40 16:00 16:20 16:40
      ]
    )
  end

  it 'skips the slot(s) that fall inside the configured break' do
    put_session_settings(
      TokenService.issue_access_token(doctor),
      { start_time: '08:00', end_time: '12:00', slot_length_minutes: 30,
        max_patients_per_day: nil, break_start: '10:00', break_end: '10:30' }
    )

    get_slots(TokenService.issue_access_token(patient), doctor.id, date: '2027-01-05')
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq('slots' => %w[08:00 08:30 09:00 09:30 10:30 11:00 11:30])
  end

  it 'succeeds for a patient-role caller since this path has no role restriction' do
    get_slots(TokenService.issue_access_token(patient), doctor.id, date: '2027-01-05')
    expect(last_response.status).to eq(200)
  end

  it 'defaults to today when the date param is omitted' do
    get_slots(TokenService.issue_access_token(patient), doctor.id)
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)['slots'].first).to eq('09:00')
  end

  it 'rejects an unparseable date with 422' do
    get_slots(TokenService.issue_access_token(patient), doctor.id, date: 'not-a-date')
    expect(last_response.status).to eq(422)
  end

  it 'returns 404 for an unknown doctor id' do
    get_slots(TokenService.issue_access_token(patient), -1, date: '2027-01-05')
    expect(last_response.status).to eq(404)
  end

  it 'returns 404 for a locked doctor id, not just omitting it like the list does' do
    locked_doctor = User.create(role: 'doctor', username: 'docL', email: 'docl@x.com',
      first_name: 'Lee', last_name: 'Locked', password: 'Sup3r!word', status: 'locked')

    get_slots(TokenService.issue_access_token(patient), locked_doctor.id, date: '2027-01-05')
    expect(last_response.status).to eq(404)
  end

  it 'returns 404 for a deactivated doctor id' do
    deactivated_doctor = User.create(role: 'doctor', username: 'docD', email: 'docd@x.com',
      first_name: 'Dee', last_name: 'Active', password: 'Sup3r!word', status: 'deactivated')

    get_slots(TokenService.issue_access_token(patient), deactivated_doctor.id, date: '2027-01-05')
    expect(last_response.status).to eq(404)
  end
end
