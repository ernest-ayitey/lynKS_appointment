class DoctorAvailabilityDay < Sequel::Model(:doctor_availability_days)
  plugin :timestamps, update_on_create: true

  many_to_one :user
end
