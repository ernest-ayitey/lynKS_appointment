class Department < Sequel::Model(:departments)
  plugin :timestamps, update_on_create: true

  one_to_many :doctor_profiles
end
