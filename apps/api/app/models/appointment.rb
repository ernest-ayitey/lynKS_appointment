class Appointment < Sequel::Model(:appointments)
  plugin :timestamps, update_on_create: true
  plugin :validation_helpers

  many_to_one :patient, class: :User, key: :patient_id
  many_to_one :doctor, class: :User, key: :doctor_id

  STATUSES = %w[pending approved declined cancelled completed no_show].freeze
  VISIT_TYPES = %w[new_consultation follow_up review_results].freeze
  DECLINE_REASON_CODES = %w[doctor_unavailable slot_taken needs_referral other].freeze

  # Statuses that hold a slot — a pending request or an approved booking
  # both occupy the doctor's (date, time) slot and must be considered by
  # double-booking checks and availability math. Declined/cancelled/
  # completed appointments do not.
  OCCUPYING_STATUSES = %w[pending approved].freeze

  def validate
    self.status ||= 'pending' if new?
    super
    validates_includes STATUSES, :status
    validates_includes DECLINE_REASON_CODES, :decline_reason_code, allow_nil: true
  end
end
