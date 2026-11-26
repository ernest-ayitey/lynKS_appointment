class DoctorSessionSettings < Sequel::Model(:doctor_session_settings)
  plugin :timestamps, update_on_create: true

  many_to_one :user
end
