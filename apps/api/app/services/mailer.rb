class Mailer
  # `appointment:` is optional and purely additive: when a caller passes it
  # (the doctor-addressed approval email in records.rb), one
  # `AppointmentEmail` row is logged alongside the delivery below, so Task
  # 4's `GET /doctor/dashboard/emails` can attribute it back to the
  # appointment. Callers that omit it (the password-reset email in
  # auth.rb, and the patient-addressed/decline emails in records.rb) are
  # unchanged — delivery happens exactly as before, with nothing logged.
  def self.deliver(to:, subject:, body:, appointment: nil)
    if ENV['MAIL_DELIVERY_METHOD'] == 'log'
      puts "To: #{to}"
      puts "Subject: #{subject}"
      puts "Body: #{body}"
      if appointment
        AppointmentEmail.create(appointment_id: appointment.id, recipient_email: to, subject: subject,
                                 sent_at: Time.now)
      end
      true
    else
      raise NotImplementedError, "Delivery method #{ENV['MAIL_DELIVERY_METHOD']} not yet implemented"
    end
  end
end
