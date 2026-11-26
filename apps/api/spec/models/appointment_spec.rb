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

  def build_appointment(overrides = {})
    department = Department.create(name: "Cardiology-#{SecureRandom.hex(4)}")
    unique_id = SecureRandom.hex(4)
    patient = User.create(role: 'patient', username: "patient-#{unique_id}", email: "patient-#{unique_id}@x.com",
      first_name: 'Pat', last_name: 'Ient', password: 'Sup3r!word')
    doctor = User.create(role: 'doctor', username: "doctor-#{unique_id}", email: "doctor-#{unique_id}@x.com",
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
    DoctorProfile.create(user: doctor, department: department, specialty_title: 'Cardiologist')

    Appointment.new(
      patient_id: patient.id,
      doctor_id: doctor.id,
      department_id: department.id,
      date: Date.new(2026, 12, 1),
      time: '09:00',
      duration_minutes: 30,
      visit_type: 'new_consultation',
      reason: 'Checkup',
      submitted_at: Time.now,
      **overrides
    )
  end

  it 'rejects a status outside the known set' do
    appointment = build_appointment(status: 'bogus')
    expect(appointment).not_to be_valid
    expect(appointment.errors[:status]).not_to be_empty
  end

  it 'rejects a decline_reason_code outside the known set, but allows nil' do
    declined = build_appointment(status: 'declined', decline_reason_code: 'not_a_real_reason')
    expect(declined).not_to be_valid

    pending_one = build_appointment(status: 'pending', decline_reason_code: nil)
    expect(pending_one).to be_valid
  end
end
