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
  TIME_IN_PAST_MESSAGE = 'This time has already passed today'
  TIME_ALREADY_BOOKED_MESSAGE = 'This time has already been booked'
  VISIT_TYPE_MESSAGE = "Visit type must be one of: #{Appointment::VISIT_TYPES.join(', ')}".freeze
  REASON_REQUIRED_MESSAGE = 'Reason is required'
  NOT_FOUND_MESSAGE = 'Not found'
  ALREADY_FINAL_MESSAGE = 'This appointment can no longer be cancelled'
  PATCHABLE_STATUSES = %w[arrived completed no_show].freeze
  VISIT_NOTES_TOO_LONG_MESSAGE = 'Visit notes must be 255 characters or fewer'

  # The statuses that represent a doctor's actual worklist of visits they
  # still need to close out or already have: `approved` (booked, upcoming
  # or today), `arrived` (checked in, awaiting the visit), `completed`, and
  # `no_show`. `pending`/`declined`/`cancelled` never occupy a doctor's
  # time and are deliberately excluded. Shared by every doctor-facing query
  # in this file that counts or lists a doctor's appointments, so
  # `GET /doctor/appointments` and `GET /doctor/dashboard/stats` can never
  # drift apart on what "a doctor's appointment" means — which is exactly
  # how the dashboard stat cards once double-counted a `pending`/`declined`/
  # `cancelled` row that `GET /doctor/appointments` had already excluded.
  DOCTOR_WORKLIST_STATUSES = %w[approved arrived completed no_show].freeze

  ISO_DATE = /\A\d{4}-\d{2}-\d{2}\z/

  # Path-scoped rather than a blanket `before`, for the same Rack::Cascade
  # reason explained in doctors.rb's header comment: a request for a path
  # this file doesn't define must still be able to fall through to the next
  # mounted app's 404 rather than being intercepted here with a 401.
  before('/appointments') { authenticate!; require_role!('patient') }

  # Sinatra's `before 'path'` only matches that exact path string, never as a
  # prefix, so the filter above (scoped to the bare `/appointments`) does NOT
  # also run for `/appointments/:id` — it has to be listed separately.
  # Following doctors.rb's own precedent for this exact situation
  # (`/doctors/:id/availability` and `/doctors/:id/slots` each get their own
  # `before`, rather than one regex covering every `/doctors/...` path):
  # explicit per-path filters are the established house style here, and they
  # read unambiguously at every call site, so this file keeps using them
  # instead of switching to a regex filter. Task 4 adds its own filter here
  # for `/appointments/:id/cancel` the same way.
  #
  # Task 2 adds `PATCH /appointments/:id` for doctors to this same path.
  # `before 'path'` filters match on path alone, regardless of HTTP verb —
  # Sinatra's filter-dispatch runs every registered filter whose path
  # matches, independent of the request's method — so a
  # `require_role!('patient')` here would also fire for a doctor's PATCH
  # and 403 it before the handler below ever ran. So this filter now only
  # authenticates; the role check for `GET /appointments/:id` moved to be
  # the first line inside that handler instead, leaving its own externally
  # observable behavior unchanged.
  before('/appointments/:id') { authenticate! }

  # A third distinct literal path, per the same `before 'path'`-is-not-a-prefix
  # reasoning above: neither of the two filters above runs for this one.
  before('/appointments/:id/cancel') { authenticate!; require_role!('patient') }

  # A fourth distinct literal path, scoped to the doctor's own appointment
  # list — same Rack::Cascade and house-style reasoning as the filters
  # above.
  before('/doctor/appointments') { authenticate!; require_role!('doctor') }

  # Two more distinct literal paths, for Task 4's dashboard summary
  # endpoints. A single `before('/doctor/dashboard')` would NOT also cover
  # these — per the `before 'path'`-is-not-a-prefix comment above, that
  # filter only matches the bare `/doctor/dashboard` path, which this file
  # never routes — so each sub-path gets its own filter, same as every
  # other grouping in this file.
  before('/doctor/dashboard/stats') { authenticate!; require_role!('doctor') }
  before('/doctor/dashboard/emails') { authenticate!; require_role!('doctor') }

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

  # No existing body-parsing filter covers `/appointments/:id`: the one
  # above is scoped to the literal `/appointments` path only (the booking
  # route) and, per the same not-a-prefix rule, does not also run here. A
  # second `before` block on the same path is fine — Sinatra runs multiple
  # `before` blocks for one path in registration order — so this mirrors
  # the booking route's body-parser exactly, just for `PATCH
  # /appointments/:id`'s body.
  before('/appointments/:id') do
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

    # A same-day booking must still be ahead of the clock: the date check
    # above only rejects a *date* already in the past, so without this a
    # patient booking this afternoon could still pick a slot from this
    # morning. Only applies when `date == today` — any other accepted date
    # is necessarily in the future, so the comparison would be a no-op (and
    # `parse_time_of_day(Time.now...)` would be comparing against the wrong
    # day's clock anyway).
    if date == today && parse_time_of_day(time_param) <= current_minute_of_day
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, time: TIME_IN_PAST_MESSAGE
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

  # The patient's own appointments, optionally narrowed by `status`,
  # `search`, and/or `from`/`to`. No pagination: `total` is simply the count
  # of the (filtered) rows returned, so a future paginated version would be
  # a breaking change to this contract, not an additive one.
  get '/appointments' do
    dataset = Appointment.where(patient_id: current_user.id)
    dataset = filter_by_status(dataset, params['status'])
    dataset = filter_by_search(dataset, params['search'])
    dataset = filter_by_date_range(dataset, params['from'], params['to'])

    appointments = dataset.eager(:doctor).order(Sequel.desc(:date), Sequel.desc(:time)).all
    departments_by_id = Department.where(id: appointments.map(&:department_id).uniq).as_hash(:id)
    json(appointments: appointments.map { |a| appointment_json(a, department: departments_by_id[a.department_id]) }, total: appointments.size)
  end

  # Ownership mismatch and "doesn't exist" are deliberately indistinguishable
  # from the caller's side — both 404 with the same body — mirroring
  # `GET /doctors/:id/availability`'s locked-doctor precedent in doctors.rb.
  get '/appointments/:id' do
    require_role!('patient')
    appointment = Appointment.where(id: params['id'], patient_id: current_user.id).first
    halt_json_error 404, NOT_FOUND_MESSAGE unless appointment

    json(appointment_json(appointment))
  end

  # Same ownership-scoped lookup (and therefore the same 404 for "doesn't
  # exist" and "belongs to someone else") as `GET /appointments/:id` above.
  # Cancelling is allowed from either `Appointment::CANCELLABLE_STATUSES`
  # status — `pending` or `approved` — per this plan's sequencing decision
  # to not add a pre-visit cutoff yet; it's refused with 422 from any other
  # status, terminal (`declined`/`cancelled`/`completed`/`no_show`) or not
  # (`arrived` — already at the clinic, so cancelling no longer applies).
  post '/appointments/:id/cancel' do
    appointment = Appointment.where(id: params['id'], patient_id: current_user.id).first
    halt_json_error 404, NOT_FOUND_MESSAGE unless appointment

    halt_json_error 422, ALREADY_FINAL_MESSAGE unless Appointment::CANCELLABLE_STATUSES.include?(appointment.status)

    appointment.update(status: 'cancelled')
    json(appointment_json(appointment))
  end

  # The doctor's own appointments, restricted to `DOCTOR_WORKLIST_STATUSES`
  # above — this is not the same list as a patient's `GET /appointments`,
  # which shows every status. No pagination, same
  # `total`-is-just-the-filtered-count contract as `GET /appointments`
  # above.
  get '/doctor/appointments' do
    dataset = Appointment.where(doctor_id: current_user.id, status: DOCTOR_WORKLIST_STATUSES)
    dataset = filter_by_patient_name(dataset, params['search'])
    dataset = filter_by_date_range(dataset, params['from'], params['to'])

    # `.eager(:patient)` plus one bulk `approved_by_by_id` hash built up
    # front, so this doesn't introduce an N+1 the same way Task 1's `GET
    # /appointments` and records.rb's `GET /records/queue` already avoid one
    # for their own per-row associations — see those routes' own comments on
    # this exact pattern.
    appointments = dataset.eager(:patient).order(:date, :time).all
    approved_by_ids = appointments.map(&:decided_by_user_id).compact.uniq
    approved_by_by_id = User.where(id: approved_by_ids).as_hash(:id)

    json(
      appointments: appointments.map { |a| doctor_appointment_json(a, approved_by: approved_by_by_id[a.decided_by_user_id]) },
      total: appointments.size
    )
  end

  # Same ownership-scoped lookup (and therefore the same 404 for "doesn't
  # exist" and "belongs to another doctor") as the patient-facing routes
  # above. No concurrency guard is needed here, unlike booking/approving:
  # marking an already-`approved` appointment `completed`/`no_show` never
  # contends for a slot — two doctors can't both own the same appointment,
  # and this ownership-scoped lookup already makes the read-then-update
  # safe.
  patch '/appointments/:id' do
    require_role!('doctor')
    appointment = Appointment.where(id: params['id'], doctor_id: current_user.id).first
    halt_json_error 404, NOT_FOUND_MESSAGE unless appointment

    new_status = @payload['status']
    unless new_status.is_a?(String) && PATCHABLE_STATUSES.include?(new_status)
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, status: "Status must be one of: #{PATCHABLE_STATUSES.join(', ')}"
    end
    # Target-status-aware precondition, not one uniform check: marking an
    # appointment `arrived` requires it currently be `approved` (the
    # check-in step happens once, on arrival); marking it `completed` or
    # `no_show` accepts `approved` OR `arrived` as the current status, so
    # the doctor can close out a visit either straight from `approved`
    # (the original, still-supported path) or after having marked the
    # patient `arrived` first (this task's new path).
    required_current_statuses = new_status == 'arrived' ? %w[approved] : %w[approved arrived]
    unless required_current_statuses.include?(appointment.status)
      halt_json_error 422, VALIDATION_FAILED_MESSAGE,
                       status: "Only an #{required_current_statuses.join(' or ')} appointment can be marked #{new_status}"
    end

    # `Appointment#validate`'s `validates_max_length 255, :visit_notes` would
    # catch an over-length value too, but only by raising
    # `Sequel::ValidationFailed` out of `update` (since `raise_on_save_failure`
    # defaults to true) — and this app's `error 500` handler (api_base.rb) has
    # no handler for that exception, so it would surface as an unhandled 500
    # instead of a 422. A non-String value (e.g. an integer) would fare worse:
    # `validates_max_length` calls `.length` on it and raises `NoMethodError`,
    # also an unhandled 500. Pre-checking here, the same way `status` above
    # is pre-checked rather than left to the model, keeps this route's error
    # envelope consistent for every rejection reason.
    visit_notes = @payload['visit_notes']
    unless visit_notes.nil? || (visit_notes.is_a?(String) && visit_notes.length <= 255)
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, visit_notes: VISIT_NOTES_TOO_LONG_MESSAGE
    end

    appointment.update(status: new_status, visit_notes: visit_notes)
    approved_by_user = appointment.decided_by_user_id && User[appointment.decided_by_user_id]
    json(doctor_appointment_json(appointment, approved_by: approved_by_user))
  end

  # A dashboard summary of the doctor's own workload. `patients_today` and
  # `this_week` are restricted to `DOCTOR_WORKLIST_STATUSES` — the same
  # worklist-status definition `GET /doctor/appointments` above already
  # established — so these stat cards never count a `pending` request still
  # awaiting Records, nor a `declined`/`cancelled` one that will never
  # occupy the doctor's time; `pending` is reported separately by the
  # `pending` stat below, and double-counting it here as well would make
  # the same row show up in two cards on one screen. "This week" reuses the
  # frontend's existing Monday-Sunday `startOfWeek`/`endOfWeek` convention
  # (doctor-appointments.page.tsx's `dateRangeForPreset('this_week')`)
  # rather than inventing a second week-boundary definition server-side;
  # `Date#cwday` (ISO 8601 day-of-week, 1=Monday..7=Sunday) gives Monday
  # without a case split on Sunday the way `Date#wday` (0=Sunday) would
  # need.
  get '/doctor/dashboard/stats' do
    today = Date.today
    week_start = today - (today.cwday - 1)
    week_end = week_start + 6
    month_start = Date.new(today.year, today.month, 1)
    month_end = Date.new(today.year, today.month, -1)

    json(
      patients_today: distinct_patient_count(today..today),
      this_week: distinct_patient_count(week_start..week_end),
      pending: Appointment.where(doctor_id: current_user.id, status: 'pending').count,
      available_days_this_month: DoctorAvailabilityDay.where(user_id: current_user.id,
                                                              date: month_start..month_end,
                                                              is_available: true).count
    )
  end

  # The doctor's own 5 most recently sent appointment-related emails,
  # newest first. Scoped to this doctor via their own appointment ids
  # first (the same select-ids-then-`where id:`-list shape already used by
  # `filter_by_search`/`filter_by_patient_name` below) rather than a SQL
  # join across `appointment_emails`/`appointments` — this file has no
  # existing join precedent to follow, and this shape does. An empty id
  # list is handled the same way Sequel always handles an empty `IN`
  # list — it matches zero rows rather than erroring — so a doctor with no
  # appointments at all gets `emails: []`, not a 500.
  get '/doctor/dashboard/emails' do
    appointment_ids = Appointment.where(doctor_id: current_user.id).select_map(:id)
    emails = AppointmentEmail.where(appointment_id: appointment_ids)
                              .order(Sequel.desc(:sent_at))
                              .limit(5)
                              .all

    # One bulk hash for the `ref` lookup below, same N+1-avoidance pattern
    # as `approved_by_by_id`/`departments_by_id` elsewhere in this file.
    appointments_by_id = Appointment.where(id: emails.map(&:appointment_id).uniq).as_hash(:id)

    json(emails: emails.map { |e| doctor_dashboard_email_json(e, appointments_by_id[e.appointment_id]) })
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

    # The current minute-of-day (0-1439), for comparing against a parsed
    # "HH:MM" slot when deciding whether a same-day booking/slot is still
    # ahead of the clock. Uses `Time.now` (wall clock), not `Date.today`.
    def current_minute_of_day
      now = Time.now
      (now.hour * 60) + now.min
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

    # `status` accepts one or more comma-separated values (e.g.
    # `status=declined,cancelled`) and matches rows whose status is any of
    # them — a single value and a list take the exact same code path, since
    # Sequel's `where` treats an array value as an IN clause. Absent/blank
    # applies no filter at all, rather than matching zero rows.
    def filter_by_status(dataset, raw_status)
      requested_statuses = raw_status.to_s.split(',').map(&:strip).reject(&:empty?)
      return dataset if requested_statuses.empty?

      dataset.where(status: requested_statuses)
    end

    # Case-insensitive substring match against the doctor's first/last name
    # or the department's name. `Sequel.ilike` degrades to a plain `LIKE` on
    # MySQL (whose default collation is already case-insensitive) rather
    # than the Postgres-only `ILIKE` operator, so this is portable as
    # written. An empty/blank `search` applies no filter.
    def filter_by_search(dataset, raw_search)
      term = raw_search.to_s.strip
      return dataset if term.empty?

      pattern = "%#{term}%"
      doctor_ids = User.where(Sequel.|(Sequel.ilike(:first_name, pattern), Sequel.ilike(:last_name, pattern)))
                        .select_map(:id)
      department_ids = Department.where(Sequel.ilike(:name, pattern)).select_map(:id)

      dataset.where(Sequel.|({ doctor_id: doctor_ids }, { department_id: department_ids }))
    end

    # The opposite direction of `filter_by_search` above: this is a doctor
    # searching their *own* appointment list by patient name, not a patient
    # searching for a doctor, so this matches `patient_id` instead of
    # `doctor_id`. Same shape otherwise — case-insensitive substring via
    # `Sequel.ilike` against first/last name, blank-is-no-filter.
    def filter_by_patient_name(dataset, raw_search)
      term = raw_search.to_s.strip
      return dataset if term.empty?

      pattern = "%#{term}%"
      patient_ids = User.where(Sequel.|(Sequel.ilike(:first_name, pattern), Sequel.ilike(:last_name, pattern)))
                         .select_map(:id)

      dataset.where(patient_id: patient_ids)
    end

    # `from` and `to` each independently narrow the `date` range when
    # present and parseable; an invalid or absent value is simply not
    # applied, matching this route's generally lenient (ignore rather than
    # 422) treatment of optional query filters.
    def filter_by_date_range(dataset, raw_from, raw_to)
      from_date = parse_booking_date(raw_from)
      dataset = dataset.where(Sequel[:date] >= from_date) if from_date

      to_date = parse_booking_date(raw_to)
      dataset = dataset.where(Sequel[:date] <= to_date) if to_date

      dataset
    end

    def appointment_json(appointment, department: nil)
      doctor = appointment.doctor
      department ||= Department[appointment.department_id]
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
        submitted_at: appointment.submitted_at.iso8601,
        decline_reason_code: appointment.decline_reason_code,
        decline_message: appointment.decline_message,
        decided_at: appointment.decided_at&.iso8601
      }
    end

    # `REQ-%05d` is the same reference convention the Records plan
    # established (`RecordsRoutes#ref_for`); duplicated here as a one-liner
    # rather than imported from `RecordsRoutes`, per this codebase's house
    # convention of small duplicated helpers across route files rather than
    # cross-class imports.
    def ref_for(appointment)
      format('REQ-%05d', appointment.id)
    end

    # The doctor-facing appointment shape for `GET /doctor/appointments`
    # and `PATCH /appointments/:id` — distinct from `appointment_json`
    # above (the patient-facing shape): it surfaces the patient's contact
    # and demographic details a doctor needs (`phone`, `sex`, `age`)
    # instead of the doctor/department identity a patient already knows,
    # and adds `approved_by`/`visit_notes`, which patients never see.
    def doctor_appointment_json(appointment, approved_by: nil)
      patient = appointment.patient

      {
        id: appointment.id,
        ref: ref_for(appointment),
        patient: {
          id: patient.id,
          first_name: patient.first_name,
          last_name: patient.last_name,
          phone: patient.phone,
          sex: patient.gender,
          age: age_for(patient.date_of_birth)
        },
        date: appointment.date.iso8601,
        time: appointment.time,
        duration_minutes: appointment.duration_minutes,
        visit_type: appointment.visit_type,
        reason: appointment.reason,
        status: appointment.status,
        approved_by: approved_by && { id: approved_by.id, first_name: approved_by.first_name, last_name: approved_by.last_name },
        visit_notes: appointment.visit_notes
      }
    end

    # Whole years between `date_of_birth` and today, or nil when the
    # patient has no recorded date of birth (an optional field at
    # registration — see auth.rb). Plain date arithmetic rather than
    # ActiveSupport (not a dependency of this Sinatra app): subtract birth
    # year from the current year, then back off one if this year's
    # birthday hasn't happened yet.
    def age_for(date_of_birth)
      return nil unless date_of_birth

      today = Date.today
      years = today.year - date_of_birth.year
      years -= 1 if today.month < date_of_birth.month ||
                    (today.month == date_of_birth.month && today.day < date_of_birth.day)
      years
    end

    # `COUNT(DISTINCT patient_id)` over this doctor's `DOCTOR_WORKLIST_STATUSES`
    # appointments in `date_range`, so a patient with two appointments the
    # same day counts once. The status filter matters just as much as the
    # date range: without it, a `pending` request still awaiting Records,
    # or one Records already `declined`/the patient `cancelled`, would
    # count toward "Patients today" even though it will never occupy this
    # doctor's time — and a `pending` one would then double-count against
    # the separate `pending` stat too. NOT the same as
    # `.distinct.count(:patient_id)`: in Sequel, a bare `.distinct` marks
    # `SELECT DISTINCT *` (every column), and `.count(:patient_id)` then
    # runs `COUNT(patient_id)` over THAT subquery — which, since `id` is
    # unique, is just the total row count, not a distinct-patient count.
    # Restricting the `SELECT` to `patient_id` first, THEN marking it
    # `.distinct`, makes the subquery itself `SELECT DISTINCT patient_id
    # ...`, so the outer `.count` correctly counts distinct patients.
    # Verified against the generated SQL for both forms before writing this.
    def distinct_patient_count(date_range)
      Appointment.where(doctor_id: current_user.id, date: date_range, status: DOCTOR_WORKLIST_STATUSES)
                 .select(:patient_id).distinct.count
    end

    # The `GET /doctor/dashboard/emails` shape: the raw `AppointmentEmail`
    # row plus its `ref`, reusing `ref_for` above via the row's parent
    # appointment rather than a second ref format — per this task's brief.
    def doctor_dashboard_email_json(email, appointment)
      {
        recipient_email: email.recipient_email,
        subject: email.subject,
        sent_at: email.sent_at.iso8601,
        ref: ref_for(appointment)
      }
    end
  end
end
