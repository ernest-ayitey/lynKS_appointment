require 'json'
require 'date'
require_relative 'api_base'
require_relative 'doctors'

# Routes mounted at '/api/v1' for a patient booking and managing their own
# appointments. This task adds `POST /appointments`; Tasks 3 and 4 add more
# routes to this same file (viewing and cancelling a patient's own
# appointments).
class AppointmentRoutes < ApiRoutes
  helpers AuthHelpers

  DOCTOR_NOT_FOUND_MESSAGE = 'Select a valid doctor'
  DATE_INVALID_MESSAGE = 'Enter a valid date (YYYY-MM-DD)'
  DATE_OUT_OF_RANGE_MESSAGE = "Date must be today or within #{DoctorRoutes::MAX_BOOKING_WINDOW_DAYS} days from today".freeze
  DATE_UNAVAILABLE_MESSAGE = 'Doctor is not available on this date'
  TIME_UNAVAILABLE_MESSAGE = 'This time is not available'
  TIME_ALREADY_BOOKED_MESSAGE = 'This time has already been booked'
  VISIT_TYPE_MESSAGE = "Visit type must be one of: #{Appointment::VISIT_TYPES.join(', ')}".freeze
  REASON_REQUIRED_MESSAGE = 'Reason is required'

  ISO_DATE = /\A\d{4}-\d{2}-\d{2}\z/

  # Path-scoped rather than a blanket `before`, for the same Rack::Cascade
  # reason explained in doctors.rb's header comment: a request for a path
  # this file doesn't define must still be able to fall through to the next
  # mounted app's 404 rather than being intercepted here with a 401.
  before('/appointments') { authenticate!; require_role!('patient') }

  before('/appointments') do
    if request.body
      request.body.rewind
      parsed = JSON.parse(request.body.read)
      @payload = parsed.is_a?(Hash) ? parsed : {}
    else
      @payload = {}
    end
  rescue JSON::ParserError
    @payload = {}
  end

  post '/appointments' do
    doctor_id = @payload['doctor_id']
    date_param = @payload['date']
    time_param = @payload['time']
    visit_type = @payload['visit_type']
    reason = @payload['reason']
    sms_reminder_opt_in = @payload['sms_reminder_opt_in']

    errors = {}

    doctor = active_doctor_with_profile(doctor_id)
    errors[:doctor_id] = DOCTOR_NOT_FOUND_MESSAGE unless doctor

    date = parse_booking_date(date_param)
    errors[:date] = DATE_INVALID_MESSAGE if date.nil?

    unless visit_type.is_a?(String) && Appointment::VISIT_TYPES.include?(visit_type)
      errors[:visit_type] = VISIT_TYPE_MESSAGE
    end

    errors[:reason] = REASON_REQUIRED_MESSAGE unless reason.is_a?(String) && !reason.strip.empty?

    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    # Every check from here on depends on `doctor` and `date` already being
    # well-formed, so each halts on its own rather than being batched with
    # the independent field checks above.
    today = Date.today
    if date < today || date > today + DoctorRoutes::MAX_BOOKING_WINDOW_DAYS
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, date: DATE_OUT_OF_RANGE_MESSAGE
    end

    halt_json_error 422, VALIDATION_FAILED_MESSAGE, date: DATE_UNAVAILABLE_MESSAGE unless available_day?(doctor, date)

    settings = DoctorSessionSettings.first(user_id: doctor.id)
    slots = generate_slots(settings)
    unless time_param.is_a?(String) && slots.include?(time_param)
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, time: TIME_UNAVAILABLE_MESSAGE
    end

    duration_minutes = settings&.slot_length_minutes || DoctorRoutes::DEFAULT_SESSION_SETTINGS[:slot_length_minutes]

    # See the file comment above `occupied_slot?` for the concurrency-safety
    # reasoning behind wrapping the existence check and the insert in the
    # same transaction with `FOR UPDATE`. `halt` is deliberately called
    # *after* the transaction block, not inside it: `halt` works by `throw`,
    # not by raising an exception, and Sequel's transaction only rolls back
    # on a raised exception, so throwing through it would leave the
    # commit/rollback decision to chance.
    occupied = nil
    appointment = nil
    DB.transaction do
      occupied = occupied_slot?(doctor.id, date, time_param)
      unless occupied
        appointment = Appointment.create(
          patient_id: current_user.id,
          doctor_id: doctor.id,
          department_id: doctor.doctor_profile.department_id,
          date: date,
          time: time_param,
          duration_minutes: duration_minutes,
          visit_type: visit_type,
          reason: reason,
          status: 'pending',
          submitted_at: Time.now,
          sms_reminder_opt_in: sms_reminder_opt_in ? true : false
        )
      end
    end

    halt_json_error 422, VALIDATION_FAILED_MESSAGE, time: TIME_ALREADY_BOOKED_MESSAGE if occupied

    status 201
    json(appointment_json(appointment))
  end

  helpers do
    # An active (not locked/deactivated) doctor by id who also has a
    # DoctorProfile (needed below for department_id), or nil. Reuses
    # `User.active_doctors`, same as every other patient-facing doctor
    # lookup in doctors.rb.
    def active_doctor_with_profile(id)
      doctor = User.active_doctors.where(id: id).first
      return nil unless doctor && doctor.doctor_profile

      doctor
    end

    # Mirrors doctors.rb's `parse_availability_date` — kept as a small,
    # obviously-duplicated copy per this task's brief rather than a shared
    # helpers module, since DoctorRoutes' version is a private instance
    # method on a different route class. Keep the two in sync by hand if
    # either changes.
    def parse_booking_date(value)
      return nil unless value.is_a?(String) && ISO_DATE.match?(value)

      Date.iso8601(value)
    rescue ArgumentError
      nil
    end

    # Mirrors doctors.rb's `available_day?` — see the comment on
    # `parse_booking_date` above for why this is duplicated rather than
    # shared.
    def available_day?(user, date)
      !DoctorAvailabilityDay.where(user_id: user.id, date: date, is_available: true).empty?
    end

    # Mirrors doctors.rb's `generate_slots`, called here via the same
    # internal method (not an HTTP round-trip) so this file's notion of
    # "a valid slot" can never drift from what `GET /doctors/:id/slots`
    # reports — see the comment on `parse_booking_date` above for why this
    # is duplicated rather than shared.
    def generate_slots(settings)
      start_minutes = parse_time_of_day(settings&.start_time || DoctorRoutes::DEFAULT_SESSION_SETTINGS[:start_time])
      end_minutes = parse_time_of_day(settings&.end_time || DoctorRoutes::DEFAULT_SESSION_SETTINGS[:end_time])
      slot_length_minutes = settings&.slot_length_minutes || DoctorRoutes::DEFAULT_SESSION_SETTINGS[:slot_length_minutes]
      break_start_minutes = settings&.break_start ? parse_time_of_day(settings.break_start) : nil
      break_end_minutes = settings&.break_end ? parse_time_of_day(settings.break_end) : nil

      slots = []
      minute = start_minutes
      while minute < end_minutes
        in_break = break_start_minutes && break_end_minutes &&
                   minute >= break_start_minutes && minute < break_end_minutes
        slots << format('%02d:%02d', minute / 60, minute % 60) unless in_break
        minute += slot_length_minutes
      end
      slots
    end

    # Mirrors doctors.rb's `parse_time_of_day` — see the comment on
    # `parse_booking_date` above for why this is duplicated rather than
    # shared.
    def parse_time_of_day(value)
      return nil unless value.is_a?(String)

      match = DoctorRoutes::TIME_OF_DAY.match(value)
      return nil unless match

      (match[1].to_i * 60) + match[2].to_i
    end

    # Whether `doctor_id` already has a `pending` or `approved` appointment
    # for this exact (date, time). Must be called inside the same
    # `DB.transaction` as the `Appointment.create` it guards, with
    # `.for_update` held on this query, for the guarantee below to hold.
    #
    # `SELECT ... FOR UPDATE` locks the rows it *matches* — so once any
    # appointment occupies a given (doctor_id, date, time), every later
    # transaction that runs this same query for that slot blocks on that
    # row's lock until the first transaction commits or rolls back, then
    # sees it and refuses to insert a second one. That is the realistic
    # double-booking case this plan asks to guarantee against: two people
    # clicking "book" on a slot the UI has already shown as taken to one of
    # them.
    #
    # It does NOT lock against a concurrent insert of a brand new row when
    # zero rows currently match (the classic phantom-read gap: a `FOR
    # UPDATE` that matches nothing takes no lock to block a competing
    # insert). So two simultaneous *first-ever* bookings of the same
    # never-before-touched slot could both pass this check and both insert.
    # This plan's call (see Task 2's brief) is to accept that narrow race
    # — a single-clinic deployment, same millisecond, never-touched slot —
    # rather than pay for `SERIALIZABLE` isolation or a generated-column
    # unique index to close it.
    def occupied_slot?(doctor_id, date, time)
      !Appointment.where(doctor_id: doctor_id, date: date, time: time,
                          status: Appointment::OCCUPYING_STATUSES)
                  .for_update
                  .empty?
    end

    def appointment_json(appointment)
      doctor = appointment.doctor
      department = Department[appointment.department_id]
      {
        id: appointment.id,
        doctor: { id: doctor.id, first_name: doctor.first_name, last_name: doctor.last_name },
        department: { id: department.id, name: department.name },
        date: appointment.date.iso8601,
        time: appointment.time,
        duration_minutes: appointment.duration_minutes,
        visit_type: appointment.visit_type,
        reason: appointment.reason,
        status: appointment.status,
        submitted_at: appointment.submitted_at.iso8601
      }
    end
  end
end
