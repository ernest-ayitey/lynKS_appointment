require_relative '../spec_helper'

RSpec.describe DoctorProfile do
  it 'round-trips its department and user associations' do
    department = Department.create(name: 'Cardiology')
    user = User.create(role: 'doctor', username: 'docA', email: 'doca@x.com',
      first_name: 'Dana', last_name: 'Who', password: 'Sup3r!word')
    profile = DoctorProfile.create(user: user, department: department,
      specialty_title: 'Cardiologist')

    expect(profile.department.name).to eq('Cardiology')
    expect(user.doctor_profile.specialty_title).to eq('Cardiologist')
  end
end
