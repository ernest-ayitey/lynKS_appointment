require_relative '../spec_helper'

RSpec.describe Mailer do
  it 'logs the message in log delivery mode' do
    expect(Mailer.deliver(to: 'a@b.com', subject: 'Hi', body: 'Body')).to be true
  end

  # Task 3: when a caller passes `appointment:`, `Mailer.deliver` also
  # records an `AppointmentEmail` row for it, alongside its existing
  # delivery behavior — this is what lets Task 4's
  # `GET /doctor/dashboard/emails` attribute an email back to the
  # appointment it concerned.
  it 'logs an AppointmentEmail when appointment: is passed' do
    department = Department.create(name: 'Cardiology')
    doctor = User.create(role: 'doctor', username: 'docmail', email: 'docmail@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
    patient = User.create(role: 'patient', username: 'patmail', email: 'patmail@x.com',
      first_name: 'Pat', last_name: 'Ient', password: 'Sup3r!word')
    appointment = Appointment.create(
      patient_id: patient.id, doctor_id: doctor.id, department_id: department.id,
      date: Date.today + 1, time: '09:00', duration_minutes: 20, visit_type: 'new_consultation',
      reason: 'Routine check-up', status: 'pending', submitted_at: Time.now
    )

    expect(
      Mailer.deliver(to: doctor.email, subject: 'New appointment added to your schedule', body: 'Body',
                      appointment: appointment)
    ).to be true

    expect(AppointmentEmail.count).to eq(1)
    logged = AppointmentEmail.first
    expect(logged.appointment_id).to eq(appointment.id)
    expect(logged.recipient_email).to eq(doctor.email)
    expect(logged.subject).to eq('New appointment added to your schedule')
    expect(logged.sent_at).not_to be_nil
  end

  # Existing call shape (e.g. the password-reset email in auth.rb) passes
  # no `appointment:` keyword at all — that must keep logging nothing, the
  # same as before this feature existed.
  it 'does not log anything when appointment: is omitted' do
    Mailer.deliver(to: 'a@b.com', subject: 'Hi', body: 'Body')
    expect(AppointmentEmail.count).to eq(0)
  end
end
