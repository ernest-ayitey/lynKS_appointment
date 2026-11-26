require_relative '../spec_helper'

RSpec.describe Appointment do
  def create_patient
    User.create(role: 'patient', username: 'patientA', email: 'patienta@x.com',
      first_name: 'Pat', last_name: 'Ient', password: 'Sup3r!word')
  end

  def create_doctor(department)
    user = User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
    DoctorProfile.create(user: user, department: department, specialty_title: 'Cardiologist')
    user
  end

  it 'persists with the pending default status and populated timestamps' do
    department = Department.create(name: 'Cardiology')
    patient = create_patient
    doctor = create_doctor(department)

    appointment = Appointment.create(patient: patient, doctor: doctor, department_id: department.id,
      date: Date.new(2026, 12, 1), time: '09:00', duration_minutes: 30,
      visit_type: 'new_consultation', reason: 'Checkup', submitted_at: Time.now)

    expect(appointment.status).to eq('pending')
    expect(appointment.created_at).not_to be_nil
    expect(appointment.updated_at).not_to be_nil
  end

  it 'resolves patient and doctor independently to the correct users' do
    department = Department.create(name: 'Cardiology')
    patient = create_patient
    doctor = create_doctor(department)

    appointment = Appointment.create(patient: patient, doctor: doctor, department_id: department.id,
      date: Date.new(2026, 12, 1), time: '09:00', duration_minutes: 30,
      visit_type: 'new_consultation', reason: 'Checkup', submitted_at: Time.now)

    expect(appointment.patient.id).to eq(patient.id)
    expect(appointment.doctor.id).to eq(doctor.id)
    expect(appointment.patient.id).not_to eq(appointment.doctor.id)
  end

  it 'defines OCCUPYING_STATUSES as exactly pending and approved' do
    expect(Appointment::OCCUPYING_STATUSES).to eq(%w[pending approved])
  end
end
