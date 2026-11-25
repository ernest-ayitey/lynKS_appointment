class Department < Sequel::Model(:departments)
  plugin :timestamps, update_on_create: true
end
