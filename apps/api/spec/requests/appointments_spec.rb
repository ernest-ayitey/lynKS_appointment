require_relative '../spec_helper'

RSpec.describe 'POST /api/v1/appointments' do
  let!(:patient) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  let!(:department) { Department.create(name: 'Cardiology') }

  let!(:doctor) do
    User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
  end

  let!(:doctor_profile) do
    DoctorProfile.create(user: doctor, department: department, specialty_title: 'Cardiologist')
  end

  let!(:available_date) do
    DoctorAvailabilityDay.create(user_id: doctor.id, date: Date.new(2027, 1, 5))
    '2027-01-05'
  end

  let(:valid_body) do
    {
      doctor_id: doctor.id,
      date: available_date,
      time: '09:00',
      visit_type: 'new_consultation',
      reason: 'Routine check-up',
      sms_reminder_opt_in: true
    }
  end

  def post_appointment(token, body)
    post '/api/v1/appointments', body.to_json,
         { 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'CONTENT_TYPE' => 'application/json' }
  end

  def patient_token
    TokenService.issue_access_token(patient)
  end

  def doctor_token
    TokenService.issue_access_token(doctor)
  end

  it 'rejects a request with no access token' do
    post '/api/v1/appointments', valid_body.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(401)
  end

  it 'creates a pending appointment for a valid patient booking, snapshotting duration and department' do
    post_appointment(patient_token, valid_body)

    expect(last_response.status).to eq(201)
    body = JSON.parse(last_response.body)
    expect(body).to include(
      'doctor' => { 'id' => doctor.id, 'first_name' => 'Dana', 'last_name' => 'Who' },
      'department' => { 'id' => department.id, 'name' => 'Cardiology' },
      'date' => available_date,
      'time' => '09:00',
      'duration_minutes' => 20,
      'visit_type' => 'new_consultation',
      'reason' => 'Routine check-up',
      'status' => 'pending'
    )
    expect(body['id']).to be_a(Integer)
    expect(body['submitted_at']).not_to be_nil

    row = Appointment.first(id: body['id'])
    expect(row.status).to eq('pending')
    expect(row.duration_minutes).to eq(20)
    expect(row.department_id).to eq(department.id)
    expect(row.patient_id).to eq(patient.id)
  end

  it "keeps the booked appointment's duration_minutes fixed even if the doctor later changes slot_length_minutes" do
    post_appointment(patient_token, valid_body)
    appointment_id = JSON.parse(last_response.body)['id']

    put '/api/v1/doctor/session-settings', {
      start_time: '09:00', end_time: '17:00', slot_length_minutes: 30,
      max_patients_per_day: nil, break_start: nil, break_end: nil
    }.to_json, { 'HTTP_AUTHORIZATION' => "Bearer #{doctor_token}", 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)

    expect(Appointment.first(id: appointment_id).duration_minutes).to eq(20)
  end

  %w[doctor records admin].each do |role|
    it "rejects a #{role}-role caller with 403" do
      other = User.create(role: role, username: "u#{role}", email: "#{role}@x.com",
        first_name: 'O', last_name: 'T', password: 'Sup3r!word')
      post_appointment(TokenService.issue_access_token(other), valid_body)
      expect(last_response.status).to eq(403)
    end
  end

  it 'rejects an unknown doctor_id with 422 (not 404)' do
    post_appointment(patient_token, valid_body.merge(doctor_id: -1))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('doctor_id')
  end

  it 'rejects a locked doctor_id with the same message as an unknown one' do
    locked_doctor = User.create(role: 'doctor', username: 'docL', email: 'docl@x.com',
      first_name: 'Lee', last_name: 'Locked', password: 'Sup3r!word', status: 'locked')
    DoctorProfile.create(user: locked_doctor, department: department, specialty_title: 'Cardiologist')
    DoctorAvailabilityDay.create(user_id: locked_doctor.id, date: Date.new(2027, 1, 5))

    post_appointment(patient_token, valid_body.merge(doctor_id: -1))
    unknown_message = JSON.parse(last_response.body)['errors']['doctor_id']

    post_appointment(patient_token, valid_body.merge(doctor_id: locked_doctor.id))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']['doctor_id']).to eq(unknown_message)
  end

  it "rejects a date the doctor hasn't marked available" do
    post_appointment(patient_token, valid_body.merge(date: '2027-01-06'))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('date')
  end

  it 'rejects a date more than MAX_BOOKING_WINDOW_DAYS out' do
    too_far = (Date.today + DoctorRoutes::MAX_BOOKING_WINDOW_DAYS + 1)
    DoctorAvailabilityDay.create(user_id: doctor.id, date: too_far)

    post_appointment(patient_token, valid_body.merge(date: too_far.iso8601))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('date')
  end

  it 'rejects a date in the past' do
    past_date = Date.today - 1
    DoctorAvailabilityDay.create(user_id: doctor.id, date: past_date)

    post_appointment(patient_token, valid_body.merge(date: past_date.iso8601))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('date')
  end

  it "rejects a time that isn't one of the doctor's generated slots" do
    post_appointment(patient_token, valid_body.merge(time: '09:05'))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('time')
  end

  it 'rejects a time that falls inside the configured break, mirroring GET /doctors/:id/slots' do
    put '/api/v1/doctor/session-settings', {
      start_time: '08:00', end_time: '12:00', slot_length_minutes: 30,
      max_patients_per_day: nil, break_start: '10:00', break_end: '10:30'
    }.to_json, { 'HTTP_AUTHORIZATION' => "Bearer #{doctor_token}", 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)

    get "/api/v1/doctors/#{doctor.id}/slots", { date: available_date },
        { 'HTTP_AUTHORIZATION' => "Bearer #{patient_token}" }
    slots = JSON.parse(last_response.body)['slots']
    expect(slots).not_to include('10:00')
    expect(slots).to include('10:30')

    post_appointment(patient_token, valid_body.merge(time: '10:00'))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('time')

    post_appointment(patient_token, valid_body.merge(time: '10:30'))
    expect(last_response.status).to eq(201)
  end

  it 'rejects a time already occupied by a pending appointment for that doctor/date/time' do
    Appointment.create(
      patient_id: patient.id, doctor_id: doctor.id, department_id: department.id,
      date: Date.iso8601(available_date), time: '09:00', duration_minutes: 20,
      visit_type: 'new_consultation', reason: 'Existing', status: 'pending', submitted_at: Time.now
    )

    post_appointment(patient_token, valid_body)
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('time')
  end

  it 'rejects a time already occupied by an approved appointment' do
    Appointment.create(
      patient_id: patient.id, doctor_id: doctor.id, department_id: department.id,
      date: Date.iso8601(available_date), time: '09:00', duration_minutes: 20,
      visit_type: 'new_consultation', reason: 'Existing', status: 'approved', submitted_at: Time.now
    )

    post_appointment(patient_token, valid_body)
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('time')
  end

  %w[declined cancelled].each do |status|
    it "allows booking a slot whose only existing appointment is #{status}" do
      Appointment.create(
        patient_id: patient.id, doctor_id: doctor.id, department_id: department.id,
        date: Date.iso8601(available_date), time: '09:00', duration_minutes: 20,
        visit_type: 'new_consultation', reason: 'Existing', status: status, submitted_at: Time.now
      )

      post_appointment(patient_token, valid_body)
      expect(last_response.status).to eq(201)
    end
  end

  it 'rejects a visit_type outside the enum' do
    post_appointment(patient_token, valid_body.merge(visit_type: 'surgery'))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('visit_type')
  end

  it 'rejects a missing reason' do
    body = valid_body.dup
    body.delete(:reason)
    post_appointment(patient_token, body)
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('reason')
  end

  it 'rejects a blank reason' do
    post_appointment(patient_token, valid_body.merge(reason: '   '))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']).to have_key('reason')
  end

  describe 'double-booking safety' do
    it 'reliably rejects a second booking attempt against an already-occupied slot, across repeated attempts' do
      post_appointment(patient_token, valid_body)
      expect(last_response.status).to eq(201)
      expect(Appointment.where(doctor_id: doctor.id, date: Date.iso8601(available_date), time: '09:00').count).to eq(1)

      20.times do
        post_appointment(patient_token, valid_body)
        expect(last_response.status).to eq(422)
      end

      expect(Appointment.where(doctor_id: doctor.id, date: Date.iso8601(available_date), time: '09:00').count).to eq(1)
    end
  end
end
