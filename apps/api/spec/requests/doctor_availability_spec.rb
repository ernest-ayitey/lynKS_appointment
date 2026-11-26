require_relative '../spec_helper'

RSpec.describe 'GET/PUT /api/v1/doctor/availability' do
  let!(:doctor) do
    User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
  end

  let!(:patient) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  let!(:other_doctor) do
    User.create(role: 'doctor', username: 'docB', email: 'docb@x.com',
      first_name: 'Nour', last_name: 'Lo', password: 'Sup3r!word')
  end

  def get_availability(token, month)
    get '/api/v1/doctor/availability', { month: month }, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  def put_availability(token, body)
    put '/api/v1/doctor/availability', body.to_json,
        { 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'CONTENT_TYPE' => 'application/json' }
  end

  describe 'GET' do
    it 'returns only the available dates in the requested month' do
      put_availability(TokenService.issue_access_token(doctor),
                        { set: %w[2027-01-05 2027-01-20 2027-02-01] })

      get_availability(TokenService.issue_access_token(doctor), '2027-01')
      expect(last_response.status).to eq(200)
      expect(JSON.parse(last_response.body)).to eq('days' => %w[2027-01-05 2027-01-20])
    end

    it 'rejects a patient role' do
      get_availability(TokenService.issue_access_token(patient), '2027-01')
      expect(last_response.status).to eq(403)
    end

    it 'only ever reflects the authenticated doctor, never another doctor' do
      put_availability(TokenService.issue_access_token(doctor), { set: %w[2027-01-05] })
      put_availability(TokenService.issue_access_token(other_doctor), { set: %w[2027-01-06] })

      get_availability(TokenService.issue_access_token(doctor), '2027-01')
      expect(JSON.parse(last_response.body)).to eq('days' => %w[2027-01-05])
    end
  end

  describe 'PUT' do
    it 'creates rows for set dates, reflected by a later GET for that month' do
      put_availability(TokenService.issue_access_token(doctor), { set: %w[2027-03-10 2027-03-15] })
      expect(last_response.status).to eq(200)

      get_availability(TokenService.issue_access_token(doctor), '2027-03')
      expect(JSON.parse(last_response.body)).to eq('days' => %w[2027-03-10 2027-03-15])
    end

    it "returns the resulting days for the touched month in the PUT response itself" do
      put_availability(TokenService.issue_access_token(doctor), { set: %w[2027-03-05 2027-03-06] })
      expect(last_response.status).to eq(200)
      expect(JSON.parse(last_response.body)).to eq('days' => %w[2027-03-05 2027-03-06])
    end

    it 'removes previously-set dates named in unset' do
      put_availability(TokenService.issue_access_token(doctor), { set: %w[2027-03-10 2027-03-15] })

      put_availability(TokenService.issue_access_token(doctor), { unset: %w[2027-03-10] })
      expect(last_response.status).to eq(200)

      get_availability(TokenService.issue_access_token(doctor), '2027-03')
      expect(JSON.parse(last_response.body)).to eq('days' => %w[2027-03-15])
    end

    it 'lets unset win when the same date appears in both set and unset' do
      put_availability(TokenService.issue_access_token(doctor),
                        { set: %w[2027-03-10], unset: %w[2027-03-10] })
      expect(last_response.status).to eq(200)

      get_availability(TokenService.issue_access_token(doctor), '2027-03')
      expect(JSON.parse(last_response.body)).to eq('days' => [])
    end

    it 'rejects a date far outside the booking window, writing nothing' do
      far_future = (Date.today + 181).iso8601

      put_availability(TokenService.issue_access_token(doctor), { set: [far_future] })
      expect(last_response.status).to eq(422)
      expect(DoctorAvailabilityDay.where(user_id: doctor.id).count).to eq(0)
    end

    it 'rejects a date in the past, writing nothing' do
      put_availability(TokenService.issue_access_token(doctor), { set: %w[2019-01-05] })
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']['dates']).to eq('Dates must not be in the past')
      expect(DoctorAvailabilityDay.where(user_id: doctor.id).count).to eq(0)
    end

    # The lower bound is deliberately asymmetric: a doctor can't newly mark a
    # past date available, but must always be able to clear a stale one.
    it 'accepts an unset for a date in the past, removing the row' do
      past = Date.today - 30
      DoctorAvailabilityDay.create(user_id: doctor.id, date: past)

      put_availability(TokenService.issue_access_token(doctor), { unset: [past.iso8601] })
      expect(last_response.status).to eq(200)
      expect(DoctorAvailabilityDay.where(user_id: doctor.id, date: past).count).to eq(0)
    end

    it 'accepts an unset for a past date that was never set, as a no-op' do
      put_availability(TokenService.issue_access_token(doctor), { unset: %w[2019-01-05] })
      expect(last_response.status).to eq(200)
      expect(JSON.parse(last_response.body)).to eq('days' => [])
    end

    it 'still applies the upper bound to unset dates, unlike the lower bound' do
      far_future = (Date.today + 181).iso8601

      put_availability(TokenService.issue_access_token(doctor), { unset: [far_future] })
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']['dates'])
        .to eq('Dates must be within 180 days from today')
    end

    it 'rejects a past set date even when a past unset date in the same request is fine' do
      past = Date.today - 30
      DoctorAvailabilityDay.create(user_id: doctor.id, date: past)

      put_availability(TokenService.issue_access_token(doctor),
                        { set: [(Date.today - 1).iso8601], unset: [past.iso8601] })
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']['dates']).to eq('Dates must not be in the past')
      expect(DoctorAvailabilityDay.where(user_id: doctor.id, date: past).count).to eq(1)
    end

    it 'rejects yesterday, the first date outside the window' do
      put_availability(TokenService.issue_access_token(doctor), { set: [(Date.today - 1).iso8601] })
      expect(last_response.status).to eq(422)
      expect(DoctorAvailabilityDay.where(user_id: doctor.id).count).to eq(0)
    end

    it 'accepts today, the lower boundary of the booking window' do
      today = Date.today.iso8601

      put_availability(TokenService.issue_access_token(doctor), { set: [today] })
      expect(last_response.status).to eq(200)
      expect(JSON.parse(last_response.body)['days']).to include(today)
    end

    it 'rejects the whole request when one date is valid but in the past, writing none of it' do
      put_availability(TokenService.issue_access_token(doctor), { set: ['2027-03-10', '2019-01-05'] })
      expect(last_response.status).to eq(422)
      expect(DoctorAvailabilityDay.where(user_id: doctor.id).count).to eq(0)
    end

    it 'accepts a date exactly at the booking window boundary (today + 180 days)' do
      at_boundary = (Date.today + 180).iso8601

      put_availability(TokenService.issue_access_token(doctor), { set: [at_boundary] })
      expect(last_response.status).to eq(200)
      expect(JSON.parse(last_response.body)).to eq('days' => [at_boundary])
    end

    it 'rejects the whole request when one date is malformed, writing none of it' do
      put_availability(TokenService.issue_access_token(doctor),
                        { set: ['2027-03-10', 'not-a-date'] })
      expect(last_response.status).to eq(422)
      expect(DoctorAvailabilityDay.where(user_id: doctor.id).count).to eq(0)
    end

    it 'rejects the whole request when one date is valid but too far out, writing none of it' do
      far_future = (Date.today + 181).iso8601

      put_availability(TokenService.issue_access_token(doctor),
                        { set: ['2027-03-10', far_future] })
      expect(last_response.status).to eq(422)
      expect(DoctorAvailabilityDay.where(user_id: doctor.id).count).to eq(0)
    end

    it 'rejects a patient role' do
      put_availability(TokenService.issue_access_token(patient), { set: %w[2027-03-10] })
      expect(last_response.status).to eq(403)
    end

    it 'always scopes writes to current_user, ignoring any doctor id in the body' do
      put_availability(
        TokenService.issue_access_token(doctor),
        { set: %w[2027-03-10], user_id: other_doctor.id }
      )
      expect(last_response.status).to eq(200)

      expect(DoctorAvailabilityDay.where(user_id: other_doctor.id).count).to eq(0)
      expect(DoctorAvailabilityDay.where(user_id: doctor.id).count).to eq(1)
    end

    describe 'locking a day that holds an approved appointment' do
      let!(:department) { Department.create(name: 'Cardiology') }

      def create_appointment(status:, date:)
        Appointment.create(
          patient_id: patient.id, doctor_id: doctor.id, department_id: department.id,
          date: date, time: '09:00', duration_minutes: 20,
          visit_type: 'new_consultation', reason: 'Existing', status: status, submitted_at: Time.now
        )
      end

      it 'rejects the whole request when one unset date has an approved appointment, deleting nothing' do
        locked_date = Date.today + 10
        other_date = Date.today + 11
        DoctorAvailabilityDay.create(user_id: doctor.id, date: locked_date)
        DoctorAvailabilityDay.create(user_id: doctor.id, date: other_date)
        create_appointment(status: 'approved', date: locked_date)

        put_availability(TokenService.issue_access_token(doctor),
                          { unset: [locked_date.iso8601, other_date.iso8601] })
        expect(last_response.status).to eq(422)
        expect(DoctorAvailabilityDay.where(user_id: doctor.id, date: locked_date).count).to eq(1)
        expect(DoctorAvailabilityDay.where(user_id: doctor.id, date: other_date).count).to eq(1)
      end

      it 'succeeds normally when the appointment on that date is only pending, not approved' do
        date = Date.today + 10
        DoctorAvailabilityDay.create(user_id: doctor.id, date: date)
        create_appointment(status: 'pending', date: date)

        put_availability(TokenService.issue_access_token(doctor), { unset: [date.iso8601] })
        expect(last_response.status).to eq(200)
        expect(DoctorAvailabilityDay.where(user_id: doctor.id, date: date).count).to eq(0)
      end
    end
  end
end
