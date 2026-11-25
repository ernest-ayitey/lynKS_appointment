require_relative '../spec_helper'

RSpec.describe 'GET/PUT /api/v1/doctor/session-settings' do
  let!(:doctor) do
    User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
  end

  let!(:patient) do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  def get_settings(token)
    get '/api/v1/doctor/session-settings', {}, { 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
  end

  def put_settings(token, body)
    put '/api/v1/doctor/session-settings', body.to_json,
        { 'HTTP_AUTHORIZATION' => "Bearer #{token}", 'CONTENT_TYPE' => 'application/json' }
  end

  describe 'GET' do
    it 'returns the default settings when none exist yet' do
      get_settings(TokenService.issue_access_token(doctor))
      expect(last_response.status).to eq(200)
      expect(JSON.parse(last_response.body)).to eq(
        'start_time' => '09:00',
        'end_time' => '17:00',
        'slot_length_minutes' => 20,
        'max_patients_per_day' => nil,
        'break_start' => nil,
        'break_end' => nil
      )
    end

    it 'rejects a patient role' do
      get_settings(TokenService.issue_access_token(patient))
      expect(last_response.status).to eq(403)
    end
  end

  describe 'PUT' do
    let(:valid_body) do
      {
        start_time: '08:00',
        end_time: '12:00',
        slot_length_minutes: 30,
        max_patients_per_day: 16,
        break_start: '10:00',
        break_end: '10:30'
      }
    end

    it 'persists a valid body and a later GET reflects it' do
      put_settings(TokenService.issue_access_token(doctor), valid_body)
      expect(last_response.status).to eq(200)

      get_settings(TokenService.issue_access_token(doctor))
      expect(JSON.parse(last_response.body)).to eq(
        'start_time' => '08:00',
        'end_time' => '12:00',
        'slot_length_minutes' => 30,
        'max_patients_per_day' => 16,
        'break_start' => '10:00',
        'break_end' => '10:30'
      )
    end

    it 'upserts on a second PUT rather than failing on a duplicate row' do
      put_settings(TokenService.issue_access_token(doctor), valid_body)
      expect(last_response.status).to eq(200)

      second_body = valid_body.merge(end_time: '13:00')
      put_settings(TokenService.issue_access_token(doctor), second_body)
      expect(last_response.status).to eq(200)

      get_settings(TokenService.issue_access_token(doctor))
      expect(JSON.parse(last_response.body)['end_time']).to eq('13:00')
      expect(DoctorSessionSettings.where(user_id: doctor.id).count).to eq(1)
    end

    it 'rejects an end_time before start_time' do
      put_settings(TokenService.issue_access_token(doctor), valid_body.merge(start_time: '12:00', end_time: '08:00'))
      expect(last_response.status).to eq(422)
    end

    it "rejects a slot_length_minutes that doesn't evenly divide the session window" do
      # 08:00-12:00 minus a 10:00-10:30 break = 210 minutes, not divisible by 25.
      put_settings(TokenService.issue_access_token(doctor), valid_body.merge(slot_length_minutes: 25))
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']['slot_length_minutes'])
        .to eq('Slot length must evenly divide the session window')
    end

    it "rejects a break_start that doesn't align with a slot boundary" do
      # 30-minute slots from 08:00 land on 08:00, 08:30, 09:00, 09:30, 10:00... a
      # break starting at 10:15 falls inside a slot rather than at its boundary.
      put_settings(
        TokenService.issue_access_token(doctor),
        valid_body.merge(break_start: '10:15', break_end: '10:45')
      )
      expect(last_response.status).to eq(422)
      expect(JSON.parse(last_response.body)['errors']['break_start'])
        .to eq('Break must align with a slot boundary')
    end

    it 'rejects a patient role' do
      put_settings(TokenService.issue_access_token(patient), valid_body)
      expect(last_response.status).to eq(403)
    end

    it "always scopes to current_user, ignoring any doctor id in the body" do
      other_doctor = User.create(role: 'doctor', username: 'docB', email: 'docb@x.com',
        first_name: 'Nour', last_name: 'Lo', password: 'Sup3r!word')

      put_settings(
        TokenService.issue_access_token(doctor),
        valid_body.merge(id: other_doctor.id, user_id: other_doctor.id)
      )
      expect(last_response.status).to eq(200)

      get_settings(TokenService.issue_access_token(other_doctor))
      expect(JSON.parse(last_response.body)['start_time']).to eq('09:00')

      get_settings(TokenService.issue_access_token(doctor))
      expect(JSON.parse(last_response.body)['start_time']).to eq('08:00')
    end
  end
end
