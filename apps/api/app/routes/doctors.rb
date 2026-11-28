require 'json'
require 'date'
require_relative 'api_base'

# Routes mounted at '/api/v1' for departments, doctors, and their
# availability. Error responses all go through ApiRoutes#halt_json_error so
# the whole file shares one envelope; see ApiRoutes for its shape. Every
# route here needs at least a valid session — role restrictions, where
# needed, come per-route in later tasks (3, 4, 5, 6) that extend this file.
class DoctorRoutes < ApiRoutes
  helpers AuthHelpers

  SLOT_LENGTH_MESSAGE = 'Slot length must evenly divide the session window'
  BREAK_ALIGNMENT_MESSAGE = 'Break must align with a slot boundary'
  BREAK_LENGTH_MESSAGE = 'Break length must be a whole number of slots'

  DEFAULT_SESSION_SETTINGS = {
    start_time: '09:00',
    end_time: '17:00',
    slot_length_minutes: 20,
    max_patients_per_day: nil,
    break_start: nil,
    break_end: nil
  }.freeze

  TIME_OF_DAY = /\A([01]\d|2[0-3]):([0-5]\d)\z/
  ISO_DATE = /\A\d{4}-\d{2}-\d{2}\z/
  ISO_MONTH = /\A\d{4}-(0[1-9]|1[0-2])\z/

  # No Settings table exists yet to make this admin-configurable. Once one
  # does, this should become `max_booking_window_days` read per-clinic
  # instead of a hardcoded constant.
  MAX_BOOKING_WINDOW_DAYS = 180

  NOT_FOUND_MESSAGE = 'Not found'

  INVALID_DATES_MESSAGE = 'Enter valid dates (YYYY-MM-DD)'
  DATES_TOO_FAR_MESSAGE = "Dates must be within #{MAX_BOOKING_WINDOW_DAYS} days from today".freeze
  DATES_IN_PAST_MESSAGE = 'Dates must not be in the past'
  DATE_HAS_APPROVED_APPOINTMENT_MESSAGE = "This day has an approved appointment and can't be closed"

  # Scoped to this file's own paths rather than a blanket `before` so a
  # request for a path this file doesn't define (e.g. '/auth/does-not-exist',
  # reached here via Rack::Cascade after HealthRoutes/AuthRoutes also 404)
  # falls through to ApiRoutes' `not_found` (404) instead of this filter
  # intercepting it with a 401 before Sinatra's own routing gets a chance to
  # run — Rack::Cascade only continues past a 404, not a 401, so a blanket
  # filter here would break the 404 cascade for every app mounted after this
  # one. Add each new path here as Tasks 3-6 extend this file; every route in
  # it still needs at least a valid session, same as a blanket filter would
  # enforce, without that side effect.
  before('/departments') { authenticate! }
  before('/doctors') { authenticate! }

  # `authenticate!` must run before `require_role!` in this same filter:
  # `require_role!` reads `current_user.role`, which only exists once
  # `authenticate!` has populated it.
  before('/doctor/session-settings') { authenticate!; require_role!('doctor') }
  before('/doctor/availability') { authenticate!; require_role!('doctor') }

  # Public to any authenticated role (a patient needs these to render a
  # booking calendar) — deliberately no `require_role!`.
  before('/doctors/:id/availability') { authenticate! }
  before('/doctors/:id/slots') { authenticate! }

  before('/doctor/session-settings') do
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

  before('/doctor/availability') do
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

  # `doctor_count` counts only the doctors `GET /doctors` would actually
  # list: counting every profile row regardless of its user's role/status
  # would promise patients doctors they can't then see or book.
  get '/departments' do
    json(Department.all.map do |d|
      { id: d.id,
        name: d.name,
        doctor_count: d.doctor_profiles_dataset.where(user_id: User.active_doctors.select(:id)).count }
    end)
  end

  # Only doctors whose account is active are patient-facing: account
  # lockout after 5 failed logins is already live in the merged backend, so
  # a locked (or otherwise blocked) doctor must not appear here. That filter
  # is `User.active_doctors`, shared with every other patient-facing doctor
  # lookup in this file.
  get '/doctors' do
    profiles = DoctorProfile.eager(:department, :user).where(user_id: User.active_doctors.select(:id))

    # An empty `department_id` (`/doctors?department_id=`) means "no filter",
    # the same as omitting it — not a filter that matches nothing. A blank
    # string is truthy in Ruby, so this needs the explicit check.
    department_id = params['department_id']
    profiles = profiles.where(department_id: department_id) unless department_id.nil? || department_id == ''

    json(profiles.all.map do |profile|
      {
        id: profile.user.id,
        first_name: profile.user.first_name,
        last_name: profile.user.last_name,
        department: { id: profile.department.id, name: profile.department.name },
        specialty_title: profile.specialty_title
      }
    end)
  end

  get '/doctor/session-settings' do
    settings = DoctorSessionSettings.first(user_id: current_user.id)
    json(session_settings_json(settings))
  end

  put '/doctor/session-settings' do
    start_time = @payload['start_time']
    end_time = @payload['end_time']
    slot_length_minutes = @payload['slot_length_minutes']
    max_patients_per_day = @payload['max_patients_per_day']
    break_start = @payload['break_start']
    break_end = @payload['break_end']

    start_minutes = parse_time_of_day(start_time)
    end_minutes = parse_time_of_day(end_time)
    break_given = !break_start.nil? || !break_end.nil?

    errors = {}
    errors[:start_time] = 'Enter a valid start time (HH:MM)' if start_minutes.nil?
    errors[:end_time] = 'Enter a valid end time (HH:MM)' if end_minutes.nil?
    unless slot_length_minutes.is_a?(Integer) && slot_length_minutes > 0
      errors[:slot_length_minutes] = 'Slot length must be a positive number of minutes'
    end
    unless max_patients_per_day.nil? || (max_patients_per_day.is_a?(Integer) && max_patients_per_day > 0)
      errors[:max_patients_per_day] = 'Max patients per day must be a positive number'
    end

    break_start_minutes = nil
    break_end_minutes = nil
    if break_given
      if break_start.nil? || break_end.nil?
        errors[:break_start] = 'Break start and end must be set together'
      else
        break_start_minutes = parse_time_of_day(break_start)
        break_end_minutes = parse_time_of_day(break_end)
        errors[:break_start] = 'Enter a valid break start time (HH:MM)' if break_start_minutes.nil?
        errors[:break_end] = 'Enter a valid break end time (HH:MM)' if break_end_minutes.nil?
      end
    end
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    errors[:end_time] = 'End time must be after start time' if end_minutes <= start_minutes
    if break_start_minutes && break_end_minutes && break_end_minutes <= break_start_minutes
      errors[:break_end] = 'Break end must be after break start'
    end
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    # Both break edges must land on the slot grid stepped from start_time:
    # a misaligned `break_start` would make `generate_slots` emit a slot only
    # partially inside the break, and a break whose *duration* isn't a whole
    # number of slots shifts every post-break boundary off the grid — which
    # is what lets the net window below divide evenly while the final slot
    # still runs past `end_time`. (Counterexample the duration check exists
    # to reject: 08:00-12:10, 30-minute slots, break 10:00-10:10 — net window
    # 240 divides by 30, yet the last slot would start at 12:00 and end at
    # 12:30.)
    #
    # Checked *before* the window-divisibility rule below so a break-shaped
    # mistake reports against the break rather than being misattributed to
    # slot_length_minutes. Once both pass, break duration is a multiple of
    # slot_length_minutes, so the net window divides evenly if and only if
    # `end_time - start_time` does — which is exactly the condition that
    # makes `generate_slots`' last slot end at `end_time` rather than past it.
    if break_start_minutes && break_end_minutes
      if (break_start_minutes - start_minutes) % slot_length_minutes != 0
        errors[:break_start] = BREAK_ALIGNMENT_MESSAGE
      end
      if (break_end_minutes - break_start_minutes) % slot_length_minutes != 0
        errors[:break_end] = BREAK_LENGTH_MESSAGE
      end
    end

    if errors.empty?
      window = end_minutes - start_minutes
      window -= (break_end_minutes - break_start_minutes) if break_start_minutes && break_end_minutes

      errors[:slot_length_minutes] = SLOT_LENGTH_MESSAGE if window <= 0 || (window % slot_length_minutes) != 0
    end
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    settings = DoctorSessionSettings.find_or_create(user: current_user)
    settings.update(
      start_time: start_time,
      end_time: end_time,
      slot_length_minutes: slot_length_minutes,
      max_patients_per_day: max_patients_per_day,
      break_start: break_start,
      break_end: break_end
    )

    json(session_settings_json(settings))
  end

  get '/doctor/availability' do
    month = resolve_month_param(params['month'])

    json(days: available_dates_in_month(current_user, month))
  end

  put '/doctor/availability' do
    set_dates = Array(@payload['set']).select { |d| d.is_a?(String) }
    unset_dates = Array(@payload['unset']).select { |d| d.is_a?(String) }
    all_dates = set_dates + unset_dates

    parsed_by_date = {}
    invalid_dates = []
    all_dates.each do |date_string|
      parsed = parse_availability_date(date_string)
      parsed.nil? ? invalid_dates << date_string : parsed_by_date[date_string] = parsed
    end

    # Range rules, all-or-nothing like the malformed-date case above: one bad
    # date rejects the whole request.
    #
    # The lower bound is asymmetric on purpose. *Marking* a past date
    # available is always a client bug — no patient can book it — so `set`
    # is rejected below today. *Unmarking* one is legitimate cleanup of
    # stale rows, so `unset` skips the lower bound (it's still parsed for
    # format, and still subject to the upper bound). Both arrays keep the
    # upper bound: a date past the booking window is meaningless either way.
    errors = {}
    if invalid_dates.any?
      errors[:dates] = INVALID_DATES_MESSAGE
    else
      today = Date.today
      max_date = today + MAX_BOOKING_WINDOW_DAYS
      if set_dates.any? { |d| parsed_by_date[d] < today }
        errors[:dates] = DATES_IN_PAST_MESSAGE
      elsif parsed_by_date.values.any? { |date| date > max_date }
        errors[:dates] = DATES_TOO_FAR_MESSAGE
      end
    end
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    # A day holding an `approved` OR `arrived` appointment can't be closed —
    # the patient was already told yes, and an `arrived` patient is already
    # physically at the clinic, so that case is if anything more locked-in
    # than merely `approved`. Deliberately `%w[approved arrived]` rather
    # than reusing `Appointment::OCCUPYING_STATUSES` (`%w[pending approved
    # arrived]`) directly: `OCCUPYING_STATUSES` also includes `pending`,
    # but a merely `pending` appointment doesn't lock the day here — nothing
    # has been promised to that patient yet — and the test immediately
    # below this one locks in that exact behavior. Checked before the
    # transaction opens, same as the format/range checks above, so this
    # rejection is all-or-nothing with the rest of the request rather than
    # a partial write.
    if unset_dates.any? { |d| !Appointment.where(doctor_id: current_user.id, date: parsed_by_date[d], status: %w[approved arrived]).empty? }
      errors[:dates] = DATE_HAS_APPROVED_APPOINTMENT_MESSAGE
    end
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, errors unless errors.empty?

    # `unset` wins when a date appears in both: write the deletions first,
    # then only insert the `set` dates that weren't also unset.
    DB.transaction do
      unset_dates.each { |d| DoctorAvailabilityDay.where(user_id: current_user.id, date: parsed_by_date[d]).delete }
      (set_dates - unset_dates).each { |d| DoctorAvailabilityDay.find_or_create(user_id: current_user.id, date: parsed_by_date[d]) }
    end

    months_touched = all_dates.map { |d| d[0, 7] }.uniq
    days = months_touched.flat_map { |month| available_dates_in_month(current_user, month) }.uniq.sort

    json(days: days)
  end

  # Public counterpart to `GET /doctor/availability`, keyed by `:id` in the
  # path instead of `current_user` and open to any authenticated role. Uses
  # the same locked/deactivated exclusion as `GET /doctors` — and treats
  # that exclusion as "not found" rather than merely filtered, so a patient
  # who already has the id can't route around the list filter.
  get '/doctors/:id/availability' do
    doctor = active_doctor(params['id'])
    halt_json_error 404, NOT_FOUND_MESSAGE unless doctor

    month = resolve_month_param(params['month'])
    json(days: available_dates_in_month(doctor, month))
  end

  # The slots the doctor's session settings produce for the given date, but
  # only on a date the doctor has actually marked available — an unavailable
  # date has no bookable slots at all, so it returns an empty list rather
  # than a full day of slots that only look bookable. Consistent with
  # `GET /doctors/:id/availability`: a date missing from that response has no
  # slots here either.
  #
  # Also excludes any slot already held by a `pending`, `approved`, or
  # `arrived` appointment (`Appointment::OCCUPYING_STATUSES`) — a slot a
  # patient can't actually book must not be offered as if it were open. A
  # `declined` or `cancelled` appointment never occupies its slot, so it's
  # left untouched.
  get '/doctors/:id/slots' do
    doctor = active_doctor(params['id'])
    halt_json_error 404, NOT_FOUND_MESSAGE unless doctor

    date = resolve_date_param(params['date'])
    if available_day?(doctor, date)
      slots = generate_slots(DoctorSessionSettings.first(user_id: doctor.id))
      occupied_times = Appointment.where(doctor_id: doctor.id, date: date,
                                          status: Appointment::OCCUPYING_STATUSES).select_map(:time)
      excluded_times = occupied_times
      # For today only, also exclude any slot whose time has already
      # passed — a date in the future is necessarily entirely ahead of the
      # clock, so this only needs to run when `date == Date.today`.
      excluded_times += slots.select { |slot| parse_time_of_day(slot) <= current_minute_of_day } if date == Date.today
      json(slots: slots - excluded_times)
    else
      json(slots: [])
    end
  end

  helpers do
    def session_settings_json(settings)
      return DEFAULT_SESSION_SETTINGS unless settings

      {
        start_time: settings.start_time,
        end_time: settings.end_time,
        slot_length_minutes: settings.slot_length_minutes,
        max_patients_per_day: settings.max_patients_per_day,
        break_start: settings.break_start,
        break_end: settings.break_end
      }
    end

    # Returns the minute-of-day (0-1439) for a "HH:MM" string, or nil for
    # anything else, so malformed input becomes a 422 rather than reaching
    # arithmetic or the database.
    def parse_time_of_day(value)
      return nil unless value.is_a?(String)

      match = TIME_OF_DAY.match(value)
      return nil unless match

      (match[1].to_i * 60) + match[2].to_i
    end

    # The current minute-of-day (0-1439), for comparing against a parsed
    # "HH:MM" slot when deciding whether a same-day slot is still ahead of
    # the clock. Uses `Time.now` (wall clock), not `Date.today`.
    def current_minute_of_day
      now = Time.now
      (now.hour * 60) + now.min
    end

    # Returns the parsed Date, or nil for anything that isn't a well-formed
    # "YYYY-MM-DD" string (including calendar-invalid values like
    # 2027-02-30), so a malformed value becomes a 422 rather than reaching
    # the database.
    def parse_availability_date(value)
      return nil unless value.is_a?(String) && ISO_DATE.match?(value)

      Date.iso8601(value)
    rescue ArgumentError
      nil
    end

    # The sorted "YYYY-MM-DD" dates `user` has marked available within the
    # given "YYYY-MM" month.
    #
    # `is_available: true` is redundant today — `PUT /doctor/availability`
    # deletes rows rather than flipping the flag, so only `true` rows exist —
    # but it's the column's whole point, and stating it here means a future
    # feature that *does* write a `false` row (an explicitly-closed holiday,
    # say) can't have it silently read back as available.
    def available_dates_in_month(user, month)
      year, month_number = month.split('-').map(&:to_i)
      start_date = Date.new(year, month_number, 1)
      end_date = Date.new(year, month_number, -1)

      DoctorAvailabilityDay.where(user_id: user.id, date: start_date..end_date, is_available: true)
                            .order(:date).select_map(:date).map(&:iso8601)
    end

    # Whether `user` has marked the single `date` available. Same row shape
    # and same `is_available: true` filter as `available_dates_in_month`,
    # narrowed to one day.
    def available_day?(user, date)
      !DoctorAvailabilityDay.where(user_id: user.id, date: date, is_available: true).empty?
    end

    # An active (not locked/deactivated/invited) doctor by user id, or nil.
    # Shares `User.active_doctors` with `GET /doctors` and `doctor_count`, so
    # a locked or deactivated doctor id 404s here the same way it's excluded
    # from that list — and can't drift apart from it.
    def active_doctor(id)
      User.active_doctors.where(id: id).first
    end

    # Resolves the `month` query param per this file's shared contract: a
    # missing/blank value defaults to the current month; a
    # present-but-unparseable one halts with 422.
    def resolve_month_param(raw)
      return Date.today.strftime('%Y-%m') if raw.nil? || raw == ''

      halt_json_error 422, VALIDATION_FAILED_MESSAGE, month: 'Enter a valid month (YYYY-MM)' unless raw.is_a?(String) && ISO_MONTH.match?(raw)

      raw
    end

    # Resolves the `date` query param per this file's shared contract: a
    # missing/blank value defaults to today; a present-but-unparseable one
    # halts with 422. Returns a Date.
    def resolve_date_param(raw)
      return Date.today if raw.nil? || raw == ''

      parsed = parse_availability_date(raw)
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, date: 'Enter a valid date (YYYY-MM-DD)' if parsed.nil?

      parsed
    end

    # The "HH:MM" slots a doctor's session settings produce: starting at
    # `start_time`, stepping by `slot_length_minutes`, stopping before
    # `end_time`, skipping any slot whose start falls inside
    # `[break_start, break_end)`. `settings` may be nil (no row saved yet),
    # in which case DEFAULT_SESSION_SETTINGS applies, same as
    # `session_settings_json`.
    #
    # Exact and gap-free only because Task 4's PUT validation guarantees
    # break_start is itself one of this same step sequence from start_time
    # — this method does no realigning of its own.
    def generate_slots(settings)
      start_minutes = parse_time_of_day(settings&.start_time || DEFAULT_SESSION_SETTINGS[:start_time])
      end_minutes = parse_time_of_day(settings&.end_time || DEFAULT_SESSION_SETTINGS[:end_time])
      slot_length_minutes = settings&.slot_length_minutes || DEFAULT_SESSION_SETTINGS[:slot_length_minutes]
      break_start_minutes = settings&.break_start ? parse_time_of_day(settings.break_start) : nil
      break_end_minutes = settings&.break_end ? parse_time_of_day(settings.break_end) : nil

      slots = []
      minute = start_minutes
      while minute < end_minutes
        in_break = break_start_minutes && break_end_minutes &&
                   minute >= break_start_minutes && minute < break_end_minutes
        slots << format_time_of_day(minute) unless in_break
        minute += slot_length_minutes
      end
      slots
    end

    # The "HH:MM" string for a minute-of-day (0-1439) — the inverse of
    # `parse_time_of_day`.
    def format_time_of_day(minutes)
      format('%02d:%02d', minutes / 60, minutes % 60)
    end
  end
end
