require_relative '../config/environment'
require 'date'

# Demo departments and doctors for local dev, so there's someone to book
# against ahead of the Admin plan's real account-creation UI.
#
# Idempotent: safe to run more than once. Departments and doctor users are
# looked up by their natural key (name / username) and only created if
# missing; profile/settings/availability rows use find_or_create too, so a
# second run just confirms what's already there instead of duplicating it.
DEPARTMENTS = [
  {
    name: 'General Medicine',
    doctor: {
      username: 'dr.mensah',
      email: 'dr.mensah@lynks.demo',
      first_name: 'Kwame',
      last_name: 'Mensah',
      password: 'Doctor123!',
      specialty_title: 'General Practitioner'
    }
  },
  {
    name: 'Pediatrics',
    doctor: {
      username: 'dr.owusu',
      email: 'dr.owusu@lynks.demo',
      first_name: 'Ama',
      last_name: 'Owusu',
      password: 'Doctor123!',
      specialty_title: 'Pediatrician'
    }
  },
  {
    name: 'Dermatology',
    doctor: {
      username: 'dr.asante',
      email: 'dr.asante@lynks.demo',
      first_name: 'Yaw',
      last_name: 'Asante',
      password: 'Doctor123!',
      specialty_title: 'Dermatologist'
    }
  }
].freeze

# Every weekday (Mon-Fri) in a given month.
def weekdays_in(year, month)
  (Date.new(year, month, 1)..Date.new(year, month, -1)).select { |d| (1..5).cover?(d.wday) }
end

this_month = Date.today
next_month = this_month.next_month
AVAILABILITY_DATES = (weekdays_in(this_month.year, this_month.month) +
                       weekdays_in(next_month.year, next_month.month)).freeze

DEPARTMENTS.each do |dept_attrs|
  department = Department.find_or_create(name: dept_attrs[:name])
  puts "Department: #{department.name} (id=#{department.id})"

  doctor_attrs = dept_attrs[:doctor]
  just_created = false
  user = User.find_or_create(username: doctor_attrs[:username]) do |u|
    u.role = 'doctor'
    u.status = 'active'
    u.must_change_password = false
    u.email = doctor_attrs[:email]
    u.first_name = doctor_attrs[:first_name]
    u.last_name = doctor_attrs[:last_name]
    u.password = doctor_attrs[:password]
    just_created = true
  end

  if just_created
    puts "  Created doctor #{user.first_name} #{user.last_name} " \
         "- username: #{doctor_attrs[:username]}, password: #{doctor_attrs[:password]}"
  else
    puts "  Doctor #{doctor_attrs[:username]} already exists (id=#{user.id})"
  end

  DoctorProfile.find_or_create(user_id: user.id) do |profile|
    profile.department_id = department.id
    profile.specialty_title = doctor_attrs[:specialty_title]
  end

  DoctorSessionSettings.find_or_create(user_id: user.id)

  AVAILABILITY_DATES.each do |date|
    DoctorAvailabilityDay.find_or_create(user_id: user.id, date: date)
  end
  puts "  Availability ensured for #{AVAILABILITY_DATES.size} weekdays " \
       "(#{AVAILABILITY_DATES.first} .. #{AVAILABILITY_DATES.last})"
end

puts 'Seed complete.'
