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

  # Relative to today (comfortably inside MAX_BOOKING_WINDOW_DAYS), not a
  # hardcoded future date: unlike doctors_spec.rb's slot-shape examples,
  # which hit a pure lookup endpoint with no date-window validation, this
  # endpoint actively enforces `date >= Date.today` (see the DATE_OUT_OF_RANGE
  # check in appointments.rb) — so a hardcoded date would silently start
  # failing every example below once the calendar passed it.
  let!(:available_date) do
    date = Date.today + 40
    DoctorAvailabilityDay.create(user_id: doctor.id, date: date)
    date.iso8601
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
    DoctorAvailabilityDay.create(user_id: locked_doctor.id, date: Date.iso8601(available_date))

    post_appointment(patient_token, valid_body.merge(doctor_id: -1))
    unknown_message = JSON.parse(last_response.body)['errors']['doctor_id']

    post_appointment(patient_token, valid_body.merge(doctor_id: locked_doctor.id))
    expect(last_response.status).to eq(422)
    expect(JSON.parse(last_response.body)['errors']['doctor_id']).to eq(unknown_message)
  end

  it "rejects a date the doctor hasn't marked available" do
    unavailable_date = (Date.today + 41).iso8601
    post_appointment(patient_token, valid_body.merge(date: unavailable_date))
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

RSpec.describe 'GET /api/v1/appointments and GET /api/v1/appointments/:id' do
  let!(:patient) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  let!(:other_patient) do
    User.create(role: 'patient', username: 'otherpat', email: 'other@x.com',
      first_name: 'O', last_name: 'P', password: 'Sup3r!word')
  end

  let!(:department) { Department.create(name: 'Cardiology') }

  let!(:doctor) do
    User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
  end

  let!(:doctor_profile) do
    DoctorProfile.create(user: doctor, department: department, specialty_title: 'Cardiologist')
  end

  def patient_token
    TokenService.issue_access_token(patient)
  end

  def other_patient_token
    TokenService.issue_access_token(other_patient)
  end

  def get_appointments(token, query = {})
    get '/api/v1/appointments', query, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  def get_appointment(token, id)
    get "/api/v1/appointments/#{id}", {}, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  # Builds a persisted appointment directly (bypassing POST's availability/
  # slot checks, which this file's booking specs already cover) so these
  # examples can freely control patient, doctor, date, and status.
  def create_appointment(patient:, doctor: self.doctor, department: self.department, date: Date.today + 10,
                          time: '09:00', status: 'pending')
    Appointment.create(
      patient_id: patient.id, doctor_id: doctor.id, department_id: department.id,
      date: date, time: time, duration_minutes: 20, visit_type: 'new_consultation',
      reason: 'Routine check-up', status: status, submitted_at: Time.now
    )
  end

  describe 'GET /appointments' do
    it 'rejects a request with no access token' do
      get '/api/v1/appointments'
      expect(last_response.status).to eq(401)
    end

    %w[doctor records admin].each do |role|
      it "rejects a #{role}-role caller with 403" do
        other = User.create(role: role, username: "u#{role}", email: "#{role}@x.com",
          first_name: 'O', last_name: 'T', password: 'Sup3r!word')
        get_appointments(TokenService.issue_access_token(other))
        expect(last_response.status).to eq(403)
      end
    end

    it "returns only the caller's own appointments, never another patient's" do
      mine = create_appointment(patient: patient)
      create_appointment(patient: other_patient)

      get_appointments(patient_token)

      expect(last_response.status).to eq(200)
      body = JSON.parse(last_response.body)
      expect(body['total']).to eq(1)
      expect(body['appointments'].map { |a| a['id'] }).to eq([mine.id])
    end

    it 'has the same per-appointment shape as POST' do
      appointment = create_appointment(patient: patient)

      get_appointments(patient_token)

      body = JSON.parse(last_response.body)['appointments'].first
      expect(body).to include(
        'id' => appointment.id,
        'doctor' => { 'id' => doctor.id, 'first_name' => 'Dana', 'last_name' => 'Who' },
        'department' => { 'id' => department.id, 'name' => 'Cardiology' },
        'date' => appointment.date.iso8601,
        'time' => '09:00',
        'duration_minutes' => 20,
        'visit_type' => 'new_consultation',
        'reason' => 'Routine check-up',
        'status' => 'pending'
      )
      expect(body['submitted_at']).not_to be_nil
    end

    it 'filters by a single status' do
      pending_appointment = create_appointment(patient: patient, status: 'pending')
      create_appointment(patient: patient, status: 'cancelled', time: '10:00')

      get_appointments(patient_token, status: 'pending')

      body = JSON.parse(last_response.body)
      expect(body['total']).to eq(1)
      expect(body['appointments'].map { |a| a['id'] }).to eq([pending_appointment.id])
    end

    it 'filters by a comma-separated list of statuses, matching either one' do
      declined = create_appointment(patient: patient, status: 'declined', time: '09:00')
      cancelled = create_appointment(patient: patient, status: 'cancelled', time: '10:00')
      create_appointment(patient: patient, status: 'pending', time: '11:00')

      get_appointments(patient_token, status: 'declined,cancelled')

      body = JSON.parse(last_response.body)
      expect(body['total']).to eq(2)
      expect(body['appointments'].map { |a| a['id'] }).to match_array([declined.id, cancelled.id])
    end

    it 'filters by search matching the doctor last name, case-insensitively' do
      other_doctor = User.create(role: 'doctor', username: 'docB', email: 'docb@x.com',
        first_name: 'Sam', last_name: 'Smith', password: 'Sup3r!word')
      DoctorProfile.create(user: other_doctor, department: department, specialty_title: 'GP')

      matching = create_appointment(patient: patient, doctor: doctor, time: '09:00')
      create_appointment(patient: patient, doctor: other_doctor, time: '10:00')

      get_appointments(patient_token, search: 'who')

      body = JSON.parse(last_response.body)
      expect(body['total']).to eq(1)
      expect(body['appointments'].map { |a| a['id'] }).to eq([matching.id])
    end

    it 'filters by from/to independently, narrowing the date range' do
      today = Date.today
      early = create_appointment(patient: patient, date: today + 5, time: '09:00')
      middle = create_appointment(patient: patient, date: today + 10, time: '09:00')
      late = create_appointment(patient: patient, date: today + 20, time: '09:00')

      get_appointments(patient_token, from: (today + 8).iso8601)
      body = JSON.parse(last_response.body)
      expect(body['appointments'].map { |a| a['id'] }).to match_array([middle.id, late.id])

      get_appointments(patient_token, to: (today + 15).iso8601)
      body = JSON.parse(last_response.body)
      expect(body['appointments'].map { |a| a['id'] }).to match_array([early.id, middle.id])

      get_appointments(patient_token, from: (today + 8).iso8601, to: (today + 15).iso8601)
      body = JSON.parse(last_response.body)
      expect(body['appointments'].map { |a| a['id'] }).to eq([middle.id])
    end
  end

  describe 'GET /appointments/:id' do
    it 'rejects a request with no access token' do
      appointment = create_appointment(patient: patient)
      get "/api/v1/appointments/#{appointment.id}"
      expect(last_response.status).to eq(401)
    end

    %w[doctor records admin].each do |role|
      it "rejects a #{role}-role caller with 403" do
        appointment = create_appointment(patient: patient)
        other = User.create(role: role, username: "u#{role}id", email: "#{role}id@x.com",
          first_name: 'O', last_name: 'T', password: 'Sup3r!word')
        get_appointment(TokenService.issue_access_token(other), appointment.id)
        expect(last_response.status).to eq(403)
      end
    end

    it "returns the caller's own appointment with the right shape" do
      appointment = create_appointment(patient: patient)

      get_appointment(patient_token, appointment.id)

      expect(last_response.status).to eq(200)
      body = JSON.parse(last_response.body)
      expect(body).to include(
        'id' => appointment.id,
        'doctor' => { 'id' => doctor.id, 'first_name' => 'Dana', 'last_name' => 'Who' },
        'department' => { 'id' => department.id, 'name' => 'Cardiology' },
        'status' => 'pending'
      )
    end

    it "404s for another patient's appointment" do
      appointment = create_appointment(patient: other_patient)

      get_appointment(patient_token, appointment.id)

      expect(last_response.status).to eq(404)
    end

    it 'returns the same 404 response shape for a nonexistent id as for an ownership mismatch' do
      other_owned = create_appointment(patient: other_patient)
      get_appointment(patient_token, other_owned.id)
      mismatch_body = last_response.body

      get_appointment(patient_token, other_owned.id + 999_999)
      expect(last_response.status).to eq(404)
      expect(last_response.body).to eq(mismatch_body)
    end
  end

  describe 'POST /appointments/:id/cancel' do
    def cancel_appointment(token, id)
      post "/api/v1/appointments/#{id}/cancel", {}, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
    end

    it 'rejects a request with no access token' do
      appointment = create_appointment(patient: patient)
      post "/api/v1/appointments/#{appointment.id}/cancel"
      expect(last_response.status).to eq(401)
    end

    %w[doctor records admin].each do |role|
      it "rejects a #{role}-role caller with 403" do
        appointment = create_appointment(patient: patient)
        other = User.create(role: role, username: "u#{role}cancel", email: "#{role}cancel@x.com",
          first_name: 'O', last_name: 'T', password: 'Sup3r!word')
        cancel_appointment(TokenService.issue_access_token(other), appointment.id)
        expect(last_response.status).to eq(403)
      end
    end

    it 'cancels a pending appointment' do
      appointment = create_appointment(patient: patient, status: 'pending')

      cancel_appointment(patient_token, appointment.id)

      expect(last_response.status).to eq(200)
      body = JSON.parse(last_response.body)
      expect(body['id']).to eq(appointment.id)
      expect(body['status']).to eq('cancelled')
      expect(appointment.refresh.status).to eq('cancelled')
    end

    it 'cancels an approved appointment (no cutoff yet)' do
      appointment = create_appointment(patient: patient, status: 'approved')

      cancel_appointment(patient_token, appointment.id)

      expect(last_response.status).to eq(200)
      expect(JSON.parse(last_response.body)['status']).to eq('cancelled')
    end

    it 'leaves OCCUPYING_STATUSES once cancelled, freeing the doctor/date/time slot' do
      appointment = create_appointment(patient: patient, status: 'approved', date: Date.today + 10, time: '09:00')
      expect(Appointment::OCCUPYING_STATUSES).to include(appointment.status)

      cancel_appointment(patient_token, appointment.id)
      expect(last_response.status).to eq(200)

      still_occupying = Appointment.where(doctor_id: doctor.id, date: Date.today + 10, time: '09:00',
                                           status: Appointment::OCCUPYING_STATUSES)
      expect(still_occupying).to be_empty
    end

    %w[cancelled completed no_show declined].each do |terminal_status|
      it "rejects cancelling an already-#{terminal_status} appointment with 422" do
        appointment = create_appointment(patient: patient, status: terminal_status)

        cancel_appointment(patient_token, appointment.id)

        expect(last_response.status).to eq(422)
        expect(JSON.parse(last_response.body)['error']).to eq('This appointment can no longer be cancelled')
        expect(appointment.refresh.status).to eq(terminal_status)
      end
    end

    it "404s for another patient's appointment" do
      appointment = create_appointment(patient: other_patient)

      cancel_appointment(patient_token, appointment.id)

      expect(last_response.status).to eq(404)
      expect(appointment.refresh.status).to eq('pending')
    end

    it '404s for a nonexistent id' do
      cancel_appointment(patient_token, 999_999)
      expect(last_response.status).to eq(404)
    end
  end
end
