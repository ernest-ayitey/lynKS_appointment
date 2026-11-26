class Appointment < Sequel::Model(:appointments)
  plugin :timestamps, update_on_create: true

  many_to_one :patient, class: :User, key: :patient_id
  many_to_one :doctor, class: :User, key: :doctor_id

  STATUSES = %w[pending approved declined cancelled completed no_show].freeze
  VISIT_TYPES = %w[new_consultation follow_up review_results].freeze

  # Statuses that hold a slot — a pending request or an approved booking
  # both occupy the doctor's (date, time) slot and must be considered by
  # double-booking checks and availability math. Declined/cancelled/
  # completed appointments do not.
  OCCUPYING_STATUSES = %w[pending approved].freeze
end
