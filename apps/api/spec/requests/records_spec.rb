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
end
