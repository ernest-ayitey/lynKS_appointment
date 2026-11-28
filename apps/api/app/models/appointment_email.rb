class AppointmentEmail < Sequel::Model(:appointment_emails)
  many_to_one :appointment
end
