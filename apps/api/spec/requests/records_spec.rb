require_relative '../spec_helper'

RSpec.describe 'GET /api/v1/records/queue' do
  let!(:department) { Department.create(name: 'Cardiology') }

  let!(:doctor) do
    User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
  end

  let!(:doctor_profile) do
    DoctorProfile.create(user: doctor, department: department, specialty_title: 'Cardiologist')
  end

  let!(:patient) do
    User.create(role: 'patient', username: 'patA', email: 'pata@x.com', phone: '5551234567',
      first_name: 'Pat', last_name: 'Ient', password: 'Sup3r!word')
  end

  let!(:records_user) do
    User.create(role: 'records', username: 'rec1', email: 'rec1@x.com',
      first_name: 'Rec', last_name: 'Ords', password: 'Sup3r!word')
  end

  def records_token
    TokenService.issue_access_token(records_user)
  end

  def get_queue(token, query = {})
    get '/api/v1/records/queue', query, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  def get_request(token, id)
    get "/api/v1/records/requests/#{id}", {}, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  # Builds a persisted appointment directly (bypassing POST's availability
  # checks, same precedent as appointments_spec.rb's `create_appointment`)
  # so these examples can freely control patient, doctor, status,
  # submitted_at, and decided_at.
  def create_appointment(patient: self.patient, doctor: self.doctor, department: self.department,
                          date: Date.today + 10, time: '09:00', status: 'pending',
                          submitted_at: Time.now, decided_at: nil)
    Appointment.create(
      patient_id: patient.id, doctor_id: doctor.id, department_id: department.id,
      date: date, time: time, duration_minutes: 20, visit_type: 'new_consultation',
      reason: 'Routine check-up', status: status, submitted_at: submitted_at, decided_at: decided_at
    )
  end

  describe 'GET /records/queue' do
    it 'lists pending requests by default, with stats computed across all statuses' do
      pending = create_appointment(status: 'pending', time: '09:00', submitted_at: Time.now - 3600)
      create_appointment(status: 'approved', time: '10:00', decided_at: Time.now)
      create_appointment(status: 'declined', time: '11:00', decided_at: Time.now)
      create_appointment(status: 'cancelled', time: '12:00')

      get_queue(records_token)

      expect(last_response.status).to eq(200)
      body = JSON.parse(last_response.body)

      expect(body['requests'].map { |r| r['id'] }).to eq([pending.id])
      expect(body['total']).to eq(1)
      expect(body['requests'].first['patient']).not_to have_key('email')
      expect(body['requests'].first['ref']).to eq(format('REQ-%05d', pending.id))

      expect(body['stats']).to eq(
        'pending' => 1,
        'approved_today' => 1,
        'declined_today' => 1,
        'oldest_waiting_at' => pending.submitted_at.iso8601
      )
    end

    %w[patient doctor].each do |role|
      it "rejects a #{role} role with 403" do
        other = User.create(role: role, username: "u#{role}q", email: "#{role}q@x.com",
          first_name: 'O', last_name: 'T', password: 'Sup3r!word')
        get_queue(TokenService.issue_access_token(other))
        expect(last_response.status).to eq(403)
      end
    end

    it 'filters by status, doctor_id, and search (patient/doctor name)' do
      doctor_b = User.create(role: 'doctor', username: 'docB', email: 'docb@x.com',
        first_name: 'Sam', last_name: 'Smith', password: 'Sup3r!word')
      DoctorProfile.create(user: doctor_b, department: department, specialty_title: 'GP')

      approved_a = create_appointment(status: 'approved', doctor: doctor, time: '09:00', decided_at: Time.now)
      approved_b = create_appointment(status: 'approved', doctor: doctor_b, time: '10:00', decided_at: Time.now)
      create_appointment(status: 'pending', doctor: doctor, time: '11:00')

      get_queue(records_token, status: 'approved')
      expect(JSON.parse(last_response.body)['requests'].map { |r| r['id'] }).to match_array([approved_a.id, approved_b.id])

      get_queue(records_token, status: 'approved', doctor_id: doctor_b.id)
      expect(JSON.parse(last_response.body)['requests'].map { |r| r['id'] }).to eq([approved_b.id])

      get_queue(records_token, status: 'approved', search: 'smith')
      expect(JSON.parse(last_response.body)['requests'].map { |r| r['id'] }).to eq([approved_b.id])

      get_queue(records_token, status: 'approved', search: 'pat')
      expect(JSON.parse(last_response.body)['requests'].map { |r| r['id'] }).to match_array([approved_a.id, approved_b.id])
    end
  end

  describe 'GET /records/requests/:id' do
    it "returns the request plus the patient's stats" do
      target = create_appointment(status: 'pending', time: '08:00')
      create_appointment(status: 'completed', date: Date.today - 20, time: '09:00')
      last_completed = create_appointment(status: 'completed', date: Date.today - 5, time: '09:30')
      create_appointment(status: 'no_show', date: Date.today - 10, time: '10:00')
      create_appointment(status: 'pending', date: Date.today + 5, time: '11:00')

      get_request(records_token, target.id)

      expect(last_response.status).to eq(200)
      body = JSON.parse(last_response.body)

      expect(body['request']['id']).to eq(target.id)
      expect(body['request']['patient']).to include('email' => patient.email, 'phone' => patient.phone)

      expect(body['patient_stats']).to eq(
        'previous_visits_count' => 2,
        'last_visit_date' => last_completed.date.iso8601,
        'no_show_count' => 1,
        'other_pending_count' => 1
      )
    end

    it 'returns 404 for a nonexistent id, and 403 for a non-records role' do
      get_request(records_token, 999_999)
      expect(last_response.status).to eq(404)

      target = create_appointment(status: 'pending')
      other = User.create(role: 'doctor', username: 'docforbidden', email: 'docforbidden@x.com',
        first_name: 'O', last_name: 'T', password: 'Sup3r!word')
      get_request(TokenService.issue_access_token(other), target.id)
      expect(last_response.status).to eq(403)
    end
  end

  def post_approve(token, id, body = {})
    post "/api/v1/records/requests/#{id}/approve", body.to_json,
         { 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'CONTENT_TYPE' => 'application/json' }
  end

  def post_approve_alternate(token, id, body = {})
    post "/api/v1/records/requests/#{id}/approve-alternate", body.to_json,
         { 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'CONTENT_TYPE' => 'application/json' }
  end

  # Relative to today, same reasoning as appointments_spec.rb's
  # `available_date`: this endpoint actively enforces the booking window, so
  # a hardcoded date would start failing once the calendar passed it.
  let!(:alternate_date) do
    date = Date.today + 15
    DoctorAvailabilityDay.create(user_id: doctor.id, date: date)
    date.iso8601
  end

  describe 'POST /records/requests/:id/approve' do
    # `create_appointment`'s default date (`Date.today + 10`) needs an
    # explicit available day — `available_day?` treats "no row" as
    # unavailable, and this plan's Fix 3 makes `approve` check that now.
    let!(:default_request_date_availability) do
      DoctorAvailabilityDay.create(user_id: doctor.id, date: Date.today + 10)
    end

    it 'approves a pending request, sets decided_at/decided_by, and emails patient+doctor' do
      deliveries = []
      allow(Mailer).to receive(:deliver) { |args| deliveries << args }

      target = create_appointment(status: 'pending')

      post_approve(records_token, target.id)
      expect(last_response.status).to eq(200)

      body = JSON.parse(last_response.body)
      expect(body['request']['status']).to eq('approved')

      row = Appointment[target.id]
      expect(row.status).to eq('approved')
      expect(row.decided_at).not_to be_nil
      expect(row.decided_by_user_id).to eq(records_user.id)

      expect(deliveries.size).to eq(2)
      expect(deliveries.map { |d| d[:to] }).to contain_exactly(patient.email, doctor.email)
    end

    # Task 3: approve sends two emails (doctor + patient), but only the
    # doctor-addressed one gets attributed to the appointment via
    # `AppointmentEmail` — Task 4's doctor dashboard only ever needs to show
    # the doctor their own copy, not the patient's.
    it 'logs the doctor-addressed approval email but not the patient-addressed one' do
      target = create_appointment(status: 'pending')

      post_approve(records_token, target.id)
      expect(last_response.status).to eq(200)

      expect(AppointmentEmail.count).to eq(1)
      logged = AppointmentEmail.first
      expect(logged.appointment_id).to eq(target.id)
      expect(logged.recipient_email).to eq(doctor.email)
      expect(logged.recipient_email).not_to eq(patient.email)
    end

    it 'stores internal_note when given' do
      target = create_appointment(status: 'pending')
      post_approve(records_token, target.id, internal_note: 'Checked insurance')
      expect(last_response.status).to eq(200)
      expect(Appointment[target.id].internal_note).to eq('Checked insurance')
    end

    it 'returns 404 for a nonexistent id' do
      post_approve(records_token, 999_999)
      expect(last_response.status).to eq(404)
    end

    %w[approved declined cancelled].each do |status|
      it "rejects a request that is already #{status}, with 422, and sends no email" do
        allow(Mailer).to receive(:deliver)
        target = create_appointment(status: status, decided_at: Time.now)

        post_approve(records_token, target.id)
        expect(last_response.status).to eq(422)
        expect(JSON.parse(last_response.body)['error']).to eq('This request has already been decided')
        expect(Mailer).not_to have_received(:deliver)
      end
    end

    %w[patient doctor].each do |role|
      it "rejects a #{role} role with 403" do
        other = User.create(role: role, username: "u#{role}appr", email: "#{role}appr@x.com",
          first_name: 'O', last_name: 'T', password: 'Sup3r!word')
        target = create_appointment(status: 'pending')
        post_approve(TokenService.issue_access_token(other), target.id)
        expect(last_response.status).to eq(403)
      end
    end

    it 'rejects with 422 when the doctor has since marked the day unavailable' do
      # A different date than `default_request_date_availability` covers, so
      # no row exists for it at all — `available_day?` treats that as
      # unavailable, exactly like a day the doctor explicitly closed after
      # this request was submitted.
      target = create_appointment(status: 'pending', date: Date.today + 11, time: '09:00')

      post_approve(records_token, target.id)
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['error']).to eq('Doctor is not available on this date')
      expect(Appointment[target.id].status).to eq('pending')
    end

    it 'rejects with 422 when the requested date has already passed' do
      past_date = Date.today - 3
      DoctorAvailabilityDay.create(user_id: doctor.id, date: past_date)
      target = create_appointment(status: 'pending', date: past_date, time: '09:00')

      post_approve(records_token, target.id)
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['error']).to eq('This time has already passed today')
      expect(Appointment[target.id].status).to eq('pending')
    end
  end

  describe 'POST /records/requests/:id/approve-alternate' do
    it 'moves the request to the given date/time and approves it, emailing patient+doctor with the NEW slot' do
      deliveries = []
      allow(Mailer).to receive(:deliver) { |args| deliveries << args }

      target = create_appointment(status: 'pending', time: '09:00')

      post_approve_alternate(records_token, target.id, date: alternate_date, time: '10:00')
      expect(last_response.status).to eq(200)

      body = JSON.parse(last_response.body)
      expect(body['request']).to include('status' => 'approved', 'date' => alternate_date, 'time' => '10:00')

      row = Appointment[target.id]
      expect(row.status).to eq('approved')
      expect(row.date.iso8601).to eq(alternate_date)
      expect(row.time).to eq('10:00')
      expect(row.decided_at).not_to be_nil
      expect(row.decided_by_user_id).to eq(records_user.id)

      expect(deliveries.size).to eq(2)
      expect(deliveries.map { |d| d[:to] }).to contain_exactly(patient.email, doctor.email)
      deliveries.each do |delivery|
        expect(delivery[:body]).to include(alternate_date)
        expect(delivery[:body]).to include('10:00')
      end
    end

    it 'rejects an alternate slot already held by another appointment, with 422 on `time`' do
      other_patient = User.create(role: 'patient', username: 'patB', email: 'patb@x.com',
        first_name: 'Other', last_name: 'Patient', password: 'Sup3r!word')
      create_appointment(patient: other_patient, status: 'approved', date: Date.iso8601(alternate_date), time: '10:00')

      target = create_appointment(status: 'pending', time: '09:00')

      post_approve_alternate(records_token, target.id, date: alternate_date, time: '10:00')
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']).to have_key('time')

      row = Appointment[target.id]
      expect(row.status).to eq('pending')
      expect(row.time).to eq('09:00')
    end

    it 'rejects a malformed or unavailable alternate date/time with field-level 422s' do
      target = create_appointment(status: 'pending', time: '09:00')

      post_approve_alternate(records_token, target.id, date: 'not-a-date', time: '10:00')
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']).to have_key('date')

      post_approve_alternate(records_token, target.id, date: alternate_date, time: '23:45')
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']).to have_key('time')

      unavailable_date = (Date.today + 16).iso8601
      post_approve_alternate(records_token, target.id, date: unavailable_date, time: '10:00')
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']).to have_key('date')

      row = Appointment[target.id]
      expect(row.status).to eq('pending')
      expect(row.time).to eq('09:00')
    end

    it 'returns 404 for a nonexistent id' do
      post_approve_alternate(records_token, 999_999, date: alternate_date, time: '10:00')
      expect(last_response.status).to eq(404)
    end

    it 'rejects a request that is already decided, with 422' do
      target = create_appointment(status: 'approved', decided_at: Time.now)
      post_approve_alternate(records_token, target.id, date: alternate_date, time: '10:00')
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['error']).to eq('This request has already been decided')
    end

    %w[patient doctor].each do |role|
      it "rejects a #{role} role with 403" do
        other = User.create(role: role, username: "u#{role}alt", email: "#{role}alt@x.com",
          first_name: 'O', last_name: 'T', password: 'Sup3r!word')
        target = create_appointment(status: 'pending')
        post_approve_alternate(TokenService.issue_access_token(other), target.id, date: alternate_date, time: '10:00')
        expect(last_response.status).to eq(403)
      end
    end
  end

  def post_decline(token, id, body = {})
    post "/api/v1/records/requests/#{id}/decline", body.to_json,
         { 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'CONTENT_TYPE' => 'application/json' }
  end

  def post_undo(token, id)
    post "/api/v1/records/requests/#{id}/undo", nil,
         { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  describe 'POST /records/requests/:id/decline' do
    it 'declines a pending request with a valid reason, emailing the patient only' do
      deliveries = []
      allow(Mailer).to receive(:deliver) { |args| deliveries << args }

      target = create_appointment(status: 'pending')

      post_decline(records_token, target.id, decline_reason_code: 'slot_taken', decline_message: 'please rebook')
      expect(last_response.status).to eq(200)

      body = JSON.parse(last_response.body)
      expect(body['request']['status']).to eq('declined')
      expect(body['request']['decline_reason_code']).to eq('slot_taken')
      expect(body['request']['decline_message']).to eq('please rebook')

      row = Appointment[target.id]
      expect(row.status).to eq('declined')
      expect(row.decided_at).not_to be_nil
      expect(row.decided_by_user_id).to eq(records_user.id)
      expect(row.decline_reason_code).to eq('slot_taken')
      expect(row.decline_message).to eq('please rebook')

      expect(deliveries.size).to eq(1)
      expect(deliveries.first[:to]).to eq(patient.email)
    end

    # Task 3: decline's one email is patient-addressed, with no
    # `appointment:` passed to `Mailer.deliver` for it (see records.rb's
    # `deliver_declined_email`) — nothing should be logged.
    it 'does not log anything on decline' do
      target = create_appointment(status: 'pending')

      post_decline(records_token, target.id, decline_reason_code: 'slot_taken')
      expect(last_response.status).to eq(200)

      expect(AppointmentEmail.count).to eq(0)
    end

    it "includes the decline_reason_code's mapped label in the patient email, with the message appended when given" do
      deliveries = []
      allow(Mailer).to receive(:deliver) { |args| deliveries << args }

      target = create_appointment(status: 'pending')
      post_decline(records_token, target.id, decline_reason_code: 'needs_referral', decline_message: 'See a GP first.')

      expect(deliveries.first[:body]).to include('Reason from Records: Needs referral first')
      expect(deliveries.first[:body]).to include('Message from Records: See a GP first.')
    end

    it "includes the decline_reason_code's mapped label in the patient email even with no decline_message given" do
      deliveries = []
      allow(Mailer).to receive(:deliver) { |args| deliveries << args }

      target = create_appointment(status: 'pending')
      post_decline(records_token, target.id, decline_reason_code: 'doctor_unavailable')

      expect(deliveries.first[:body]).to include('Reason from Records: Doctor unavailable')
      expect(deliveries.first[:body]).not_to include('Message from Records:')
    end

    it 'rejects a missing or out-of-set decline_reason_code with a field-level 422' do
      target = create_appointment(status: 'pending')

      post_decline(records_token, target.id, decline_message: 'no reason given')
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']).to have_key('decline_reason_code')

      post_decline(records_token, target.id, decline_reason_code: 'not_a_real_code')
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']).to have_key('decline_reason_code')

      expect(Appointment[target.id].status).to eq('pending')
    end

    %w[approved declined cancelled].each do |status|
      it "rejects a request that is already #{status}, with 422, and sends no email" do
        allow(Mailer).to receive(:deliver)
        target = create_appointment(status: status, decided_at: Time.now)

        post_decline(records_token, target.id, decline_reason_code: 'slot_taken')
        expect(last_response.status).to eq(422)
        expect(JSON.parse(last_response.body)['error']).to eq('This request has already been decided')
        expect(Mailer).not_to have_received(:deliver)
      end
    end

    it 'returns 404 for a nonexistent id' do
      post_decline(records_token, 999_999, decline_reason_code: 'slot_taken')
      expect(last_response.status).to eq(404)
    end

    %w[patient doctor].each do |role|
      it "rejects a #{role} role with 403" do
        other = User.create(role: role, username: "u#{role}dec", email: "#{role}dec@x.com",
          first_name: 'O', last_name: 'T', password: 'Sup3r!word')
        target = create_appointment(status: 'pending')
        post_decline(TokenService.issue_access_token(other), target.id, decline_reason_code: 'slot_taken')
        expect(last_response.status).to eq(403)
      end
    end
  end

  describe 'POST /records/requests/:id/undo' do
    it 'reverts a declined request back to pending and clears decision fields, leaving internal_note untouched' do
      allow(Mailer).to receive(:deliver)
      target = create_appointment(status: 'declined', decided_at: Time.now)
      target.update(decided_by_user_id: records_user.id, decline_reason_code: 'slot_taken',
                     decline_message: 'please rebook', internal_note: 'Checked insurance')

      post_undo(records_token, target.id)
      expect(last_response.status).to eq(200)

      body = JSON.parse(last_response.body)
      expect(body['request']['status']).to eq('pending')

      row = Appointment[target.id]
      expect(row.status).to eq('pending')
      expect(row.decided_at).to be_nil
      expect(row.decided_by_user_id).to be_nil
      expect(row.decline_reason_code).to be_nil
      expect(row.decline_message).to be_nil
      expect(row.internal_note).to eq('Checked insurance')

      expect(Mailer).not_to have_received(:deliver)
    end

    it 'reverts an approved request back to pending and clears decision fields' do
      target = create_appointment(status: 'approved', decided_at: Time.now)
      target.update(decided_by_user_id: records_user.id)

      post_undo(records_token, target.id)
      expect(last_response.status).to eq(200)
      expect(Appointment[target.id].status).to eq('pending')
    end

    it 'undoes a declined request back to pending when its old slot is still free' do
      target = create_appointment(status: 'declined', time: '09:00', decided_at: Time.now)

      post_undo(records_token, target.id)
      expect(last_response.status).to eq(200)
      expect(Appointment[target.id].status).to eq('pending')
    end

    it 'rejects undoing a declined request with 422 when another appointment now occupies that exact slot' do
      target = create_appointment(status: 'declined', time: '09:00', decided_at: Time.now)

      other_patient = User.create(role: 'patient', username: 'patC', email: 'patc@x.com',
        first_name: 'Other', last_name: 'Taker', password: 'Sup3r!word')
      create_appointment(patient: other_patient, status: 'pending', time: '09:00')

      post_undo(records_token, target.id)
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['error']).to eq('This time has already been booked')

      row = Appointment[target.id]
      expect(row.status).to eq('declined')
    end

    it "undoing an approved request is unaffected by self-exclusion — it already occupies its own slot" do
      target = create_appointment(status: 'approved', time: '09:00', decided_at: Time.now)

      post_undo(records_token, target.id)
      expect(last_response.status).to eq(200)
      expect(Appointment[target.id].status).to eq('pending')
    end

    it 'rejects a request that is still pending, with 422, and sends no email' do
      allow(Mailer).to receive(:deliver)
      target = create_appointment(status: 'pending')

      post_undo(records_token, target.id)
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['error']).to eq('This request is still pending — there is nothing to undo')
      expect(Mailer).not_to have_received(:deliver)
    end

    it 'returns 404 for a nonexistent id' do
      post_undo(records_token, 999_999)
      expect(last_response.status).to eq(404)
    end

    %w[patient doctor].each do |role|
      it "rejects a #{role} role with 403" do
        other = User.create(role: role, username: "u#{role}undo", email: "#{role}undo@x.com",
          first_name: 'O', last_name: 'T', password: 'Sup3r!word')
        target = create_appointment(status: 'declined', decided_at: Time.now)
        post_undo(TokenService.issue_access_token(other), target.id)
        expect(last_response.status).to eq(403)
      end
    end
  end
end
