class DoctorProfile < Sequel::Model(:doctor_profiles)
  plugin :timestamps, update_on_create: true

  many_to_one :user
  many_to_one :department
end
