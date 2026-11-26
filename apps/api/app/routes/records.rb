require 'json'
require 'date'
require_relative 'api_base'
require_relative 'doctors'

# Routes mounted at '/api/v1' for the `records` staff role's approval queue.
# This task adds the two read-only routes (`GET /records/queue` and
# `GET /records/requests/:id`); Tasks 3 and 4 add the approve/decline/undo
# routes to this same file, reusing `request_json`/`NOT_FOUND_MESSAGE`/
# `ref_for` defined here — mirrors how `AppointmentRoutes` grew across
# Plan 4's tasks.
class RecordsRoutes < ApiRoutes
  helpers AuthHelpers

  NOT_FOUND_MESSAGE = 'Not found'
  QUEUE_STATUSES = %w[pending approved declined cancelled].freeze

  # Shared by every decision route (`approve`, `approve-alternate`, and
  # Task 4's `decline`/`undo`): the request has already left the `pending`
  # status, so there is nothing left for this decision to do.
  ALREADY_DECIDED_MESSAGE = 'This request has already been decided'

  # `undo`'s counterpart to `ALREADY_DECIDED_MESSAGE`: a `pending` request
  # has no decision on it yet, so there is nothing for `undo` to revert.
  NOTHING_TO_UNDO_MESSAGE = 'This request is still pending — there is nothing to undo'

  # Field-level message for `decline` when `decline_reason_code` is missing
  # or not one of the fixed, closed set in `Appointment::DECLINE_REASON_CODES`.
  REASON_REQUIRED_MESSAGE = "Select a reason: #{Appointment::DECLINE_REASON_CODES.join(', ')}"

  # Field-level validation messages for `approve-alternate`'s target
  # date/time. This file's own copies of appointments.rb's identically
  # worded constants, per the established duplication-over-sharing
  # convention between these route files (see the comment on
  # `parse_booking_date` below).
  ISO_DATE = /\A\d{4}-\d{2}-\d{2}\z/
  DATE_INVALID_MESSAGE = 'Enter a valid date (YYYY-MM-DD)'
  DATE_OUT_OF_RANGE_MESSAGE = "Date must be today or within #{DoctorRoutes::MAX_BOOKING_WINDOW_DAYS} days from today".freeze
  DATE_UNAVAILABLE_MESSAGE = 'Doctor is not available on this date'
  TIME_UNAVAILABLE_MESSAGE = 'This time is not available'
  TIME_IN_PAST_MESSAGE = 'This time has already passed today'
  TIME_ALREADY_BOOKED_MESSAGE = 'This time has already been booked'

  # Path-scoped rather than a blanket `before`, for the same Rack::Cascade
  # reason explained in doctors.rb's header comment: a request for a path
  # this file doesn't define must still be able to fall through to the next
  # mounted app's 404 rather than being intercepted here with a 401/403.
  before('/records/queue') { authenticate!; require_role!('records') }

  # Sinatra's `before 'path'` only matches that exact path string, never as a
  # prefix, so this has to be listed separately from the filter above — same
  # established house style as doctors.rb/appointments.rb.
  before('/records/requests/:id') { authenticate!; require_role!('records') }

  # Two more distinct literal paths, per the same `before 'path'`-is-not-a-
  # prefix reasoning above: neither of the two filters above runs for these.
  before('/records/requests/:id/approve') { authenticate!; require_role!('records') }
  before('/records/requests/:id/approve-alternate') { authenticate!; require_role!('records') }
  before('/records/requests/:id/decline') { authenticate!; require_role!('records') }
  before('/records/requests/:id/undo') { authenticate!; require_role!('records') }

  # Both decision routes above take a JSON body, so each gets its own copy
  # of the same body-parsing filter appointments.rb/doctors.rb use — one per
  # literal path, since (as above) `before 'path'` isn't a prefix match.
  before('/records/requests/:id/approve') do
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

  before('/records/requests/:id/approve-alternate') do
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

  # `decline` also takes a JSON body (`decline_reason_code`, `decline_message`,
  # optional `internal_note`); `undo` takes none, so it gets no such filter.
  before('/records/requests/:id/decline') do
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

  # The approval queue: defaults to `pending` requests, narrowable by
  # `status` (one of QUEUE_STATUSES), `doctor_id` (exact match), and
  # `search` (patient/doctor name substring). `stats` is always computed
  # across the full, unfiltered `Appointment` table — it answers "how is the
  # queue doing overall", not "how many rows does this filtered view have".
  get '/records/queue' do
    status_param = QUEUE_STATUSES.include?(params['status']) ? params['status'] : 'pending'

    dataset = Appointment.where(status: status_param)
    dataset = filter_by_doctor(dataset, params['doctor_id'])
    dataset = filter_by_search(dataset, params['search'])
    dataset = dataset.order(params['sort'] == 'newest' ? Sequel.desc(:submitted_at) : Sequel.asc(:submitted_at))

    # `.eager(:patient, :doctor)` before `.all`, and one `departments_by_id`
    # hash built up front, so this doesn't reintroduce the N+1 Task 1 fixed
    # in `GET /appointments` — same shape as that fix.
    appointments = dataset.eager(:patient, :doctor).all
    departments_by_id = Department.where(id: appointments.map(&:department_id).uniq).as_hash(:id)

    json(
      stats: queue_stats,
      requests: appointments.map { |a| request_json(a, department: departments_by_id[a.department_id]) },
      total: appointments.size
    )
  end

  # No ownership scoping — any `records` user sees any appointment,
  # regardless of which patient it belongs to. 404 for a nonexistent id,
  # nothing more nuanced.
  get '/records/requests/:id' do
    appointment = Appointment[params['id']]
    halt_json_error 404, NOT_FOUND_MESSAGE unless appointment

    json(
      request: request_json(appointment, detailed: true),
      patient_stats: patient_stats_for(appointment.patient_id, appointment.id)
    )
  end

  # Approves a pending request at its originally requested date/time —
  # see the file comment above `occupied_slot?`-style re-checks in
  # appointments.rb's `POST /appointments` for why the `status == 'pending'`
  # check has to happen twice: once here (a cheap early exit for the common
  # case), and once more below with a row lock held, inside the transaction,
  # which is the check that actually closes the race between two records
  # users deciding the same request at once. `halt` is deliberately called
  # *after* the transaction block, not inside it — same reasoning as
  # appointments.rb: `halt` works by `throw`, not by raising, so throwing
  # through a transaction would leave Sequel's commit/rollback decision to
  # chance.
  post '/records/requests/:id/approve' do
    appointment = Appointment[params['id']]
    halt_json_error 404, NOT_FOUND_MESSAGE unless appointment
    halt_json_error 422, ALREADY_DECIDED_MESSAGE unless appointment.status == 'pending'

    already_decided = false
    DB.transaction do
      appointment = Appointment.where(id: appointment.id).for_update.first
      if appointment.status == 'pending'
        appointment.update(status: 'approved', decided_at: Time.now, decided_by_user_id: current_user.id,
                            internal_note: @payload['internal_note'] || appointment.internal_note)
      else
        already_decided = true
      end
    end
    halt_json_error 422, ALREADY_DECIDED_MESSAGE if already_decided

    deliver_approved_emails(appointment)
    json(request: request_json(appointment))
  end

  # Approves a pending request onto a *different* date/time than originally
  # requested. The date/time validation below (well-formed, doctor available
  # that day, a real generated slot, not already past if same-day, within
  # the booking window) mirrors `POST /appointments`'s own validation
  # one-for-one and halts directly, the same way `POST /appointments` does
  # for these same checks — none of them depend on a row lock, so there is
  # no concurrency reason to defer them into the transaction below.
  #
  # The transaction below re-checks `status == 'pending'` under a row lock
  # (closing the double-decide race, same as `approve` above) and *also*
  # checks whether the target slot is already held by some other
  # appointment — `.exclude(id: appointment.id)` is what makes that check
  # safe to run even though this exact row already occupies its *old* slot;
  # without the exclusion it would always find itself and could never pass.
  # Both outcomes are captured as flags and only halted on after the
  # transaction closes, for the same `halt`-is-a-`throw` reason as above.
  post '/records/requests/:id/approve-alternate' do
    appointment = Appointment[params['id']]
    halt_json_error 404, NOT_FOUND_MESSAGE unless appointment
    halt_json_error 422, ALREADY_DECIDED_MESSAGE unless appointment.status == 'pending'

    date = parse_booking_date(@payload['date'])
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, date: DATE_INVALID_MESSAGE if date.nil?

    today = Date.today
    if date < today || date > today + DoctorRoutes::MAX_BOOKING_WINDOW_DAYS
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, date: DATE_OUT_OF_RANGE_MESSAGE
    end

    doctor = appointment.doctor
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, date: DATE_UNAVAILABLE_MESSAGE unless available_day?(doctor, date)

    settings = DoctorSessionSettings.first(user_id: doctor.id)
    slots = generate_slots(settings)
    time_param = @payload['time']
    unless time_param.is_a?(String) && slots.include?(time_param)
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, time: TIME_UNAVAILABLE_MESSAGE
    end

    if date == today && parse_time_of_day(time_param) <= current_minute_of_day
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, time: TIME_IN_PAST_MESSAGE
    end

    already_decided = false
    occupied = false
    DB.transaction do
      appointment = Appointment.where(id: appointment.id).for_update.first
      if appointment.status != 'pending'
        already_decided = true
      else
        occupied = !Appointment.where(doctor_id: appointment.doctor_id, date: date, time: time_param,
                                       status: Appointment::OCCUPYING_STATUSES)
                                .exclude(id: appointment.id)
                                .for_update
                                .empty?
        unless occupied
          appointment.update(date: date, time: time_param, status: 'approved', decided_at: Time.now,
                              decided_by_user_id: current_user.id,
                              internal_note: @payload['internal_note'] || appointment.internal_note)
        end
      end
    end
    halt_json_error 422, ALREADY_DECIDED_MESSAGE if already_decided
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, time: TIME_ALREADY_BOOKED_MESSAGE if occupied

    deliver_approved_emails(appointment)
    json(request: request_json(appointment))
  end

  # Declines a pending request. Same shape as `approve` above — the cheap
  # early-exit check, then a row-locked re-check inside a transaction to
  # close the double-decide race, with `halt` deferred until after the
  # transaction closes for the same `halt`-is-a-`throw` reason — except
  # there is no slot-occupancy complication here, since declining never
  # touches the slot (it stays released for someone else to book).
  post '/records/requests/:id/decline' do
    appointment = Appointment[params['id']]
    halt_json_error 404, NOT_FOUND_MESSAGE unless appointment
    halt_json_error 422, ALREADY_DECIDED_MESSAGE unless appointment.status == 'pending'

    reason_code = @payload['decline_reason_code']
    unless reason_code.is_a?(String) && Appointment::DECLINE_REASON_CODES.include?(reason_code)
      halt_json_error 422, VALIDATION_FAILED_MESSAGE, decline_reason_code: REASON_REQUIRED_MESSAGE
    end

    already_decided = false
    DB.transaction do
      appointment = Appointment.where(id: appointment.id).for_update.first
      if appointment.status == 'pending'
        appointment.update(status: 'declined', decided_at: Time.now, decided_by_user_id: current_user.id,
                            decline_reason_code: reason_code, decline_message: @payload['decline_message'],
                            internal_note: @payload['internal_note'] || appointment.internal_note)
      else
        already_decided = true
      end
    end
    halt_json_error 422, ALREADY_DECIDED_MESSAGE if already_decided

    deliver_declined_email(appointment)
    json(request: request_json(appointment))
  end

  # Reverts a declined or approved request back to `pending`, clearing the
  # decision fields a prior `approve`/`approve-alternate`/`decline` wrote.
  # `internal_note` is deliberately left alone — it's Records' own working
  # note on the request, not part of the decision being undone. No email
  # either — an undo is Records correcting their own mistake, not an event
  # the patient or doctor needs to hear about.
  #
  # `pending` is one of `Appointment::OCCUPYING_STATUSES`, so reverting to it
  # re-occupies this row's (doctor_id, date, time) slot — exactly the same
  # occupancy concern `approve-alternate` already has to guard against when
  # moving a row onto a different slot. Unlike that route, `undo` doesn't
  # pick a new slot; it's putting the row back on the slot it already has a
  # historical claim to. But between this request having been declined/
  # cancelled (which released the slot) and this undo call, some other
  # appointment may have booked that exact slot in the meantime — nothing
  # stops that, since declining frees the slot for anyone. So this needs the
  # same transactional re-check/re-lock pattern as every other decision
  # route here: re-read `status` under `for_update` (closing the same
  # double-decide race `approve`/`decline` close), and also check whether
  # some *other* row now occupies this slot (`.exclude(id: appointment.id)`
  # is what makes that check safe for an `approved` row, which already
  # legitimately occupies its own slot and must not find itself). Both
  # outcomes are captured as flags and halted on only after the transaction
  # closes, for the same `halt`-is-a-`throw` reason as every route above.
  post '/records/requests/:id/undo' do
    appointment = Appointment[params['id']]
    halt_json_error 404, NOT_FOUND_MESSAGE unless appointment
    halt_json_error 422, NOTHING_TO_UNDO_MESSAGE if appointment.status == 'pending'

    already_pending = false
    occupied = false
    DB.transaction do
      appointment = Appointment.where(id: appointment.id).for_update.first
      if appointment.status == 'pending'
        already_pending = true
      else
        occupied = !Appointment.where(doctor_id: appointment.doctor_id, date: appointment.date,
                                       time: appointment.time, status: Appointment::OCCUPYING_STATUSES)
                                .exclude(id: appointment.id)
                                .for_update
                                .empty?
        unless occupied
          appointment.update(status: 'pending', decided_at: nil, decided_by_user_id: nil,
                              decline_reason_code: nil, decline_message: nil)
        end
      end
    end
    halt_json_error 422, NOTHING_TO_UNDO_MESSAGE if already_pending
    halt_json_error 422, TIME_ALREADY_BOOKED_MESSAGE if occupied

    json(request: request_json(appointment))
  end

  helpers do
    def ref_for(appointment)
      format('REQ-%05d', appointment.id)
    end

    # Builds and sends the two emails an approval (original slot or
    # alternate) always triggers: one to the doctor whose schedule just
    # gained an appointment, one to the patient telling them it was
    # approved. Field lists per screen-specs.md:176-179 (EmailDoctor /
    # EmailPatient): the doctor's email names the patient/date/time/visit
    # type/reason/who approved it; the patient's names the doctor/date/
    # time/where/reference. Always reflects `appointment`'s *current*
    # date/time, so a caller that already moved it onto an alternate slot
    # before calling this (as `approve-alternate` does) emails the new
    # slot, not the original request's.
    def deliver_approved_emails(appointment)
      doctor = appointment.doctor
      patient = appointment.patient
      department = Department[appointment.department_id]

      Mailer.deliver(
        to: doctor.email,
        subject: 'New appointment added to your schedule',
        body: "Patient: #{patient.first_name} #{patient.last_name}\n" \
              "Date: #{appointment.date.iso8601}\n" \
              "Time: #{appointment.time}\n" \
              "Visit type: #{appointment.visit_type}\n" \
              "Reason: #{appointment.reason}\n" \
              "Approved by: #{current_user.first_name} #{current_user.last_name}"
      )

      Mailer.deliver(
        to: patient.email,
        subject: 'Your appointment has been approved',
        body: "Doctor: #{doctor.first_name} #{doctor.last_name}\n" \
              "Date: #{appointment.date.iso8601}\n" \
              "Time: #{appointment.time}\n" \
              "Where: #{department.name}\n" \
              "Reference: #{ref_for(appointment)}"
      )
    end

    # Sends `decline`'s single email, to the patient only — no doctor copy,
    # since a declined request never touched the doctor's schedule. Fields
    # per screen-specs.md:181-182 (EmailRejected): a "not approved" request
    # detail line, a "Reason from Records" callout using `decline_message`,
    # and a note that the requested slot has been released back for others
    # to book.
    def deliver_declined_email(appointment)
      doctor = appointment.doctor

      Mailer.deliver(
        to: appointment.patient.email,
        subject: 'Your appointment request was not approved',
        body: "Doctor: #{doctor.first_name} #{doctor.last_name}\n" \
              "Date: #{appointment.date.iso8601}\n" \
              "Time: #{appointment.time}\n" \
              "Reference: #{ref_for(appointment)}\n" \
              "Reason from Records: #{appointment.decline_message}\n" \
              'Your requested time has been released and is available to book again.'
      )
    end

    # Mirrors appointments.rb's `parse_booking_date` — kept as a small,
    # obviously-duplicated copy per this file's established convention
    # rather than a shared helpers module, since `AppointmentRoutes`'
    # version is a private instance method on a different route class.
    # Keep the two in sync by hand if either changes.
    def parse_booking_date(value)
      return nil unless value.is_a?(String) && ISO_DATE.match?(value)

      Date.iso8601(value)
    rescue ArgumentError
      nil
    end

    # Mirrors appointments.rb's `available_day?` — see the comment on
    # `parse_booking_date` above for why this is duplicated rather than
    # shared.
    def available_day?(user, date)
      !DoctorAvailabilityDay.where(user_id: user.id, date: date, is_available: true).empty?
    end

    # Mirrors appointments.rb's `generate_slots` — see the comment on
    # `parse_booking_date` above for why this is duplicated rather than
    # shared.
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

    # Mirrors appointments.rb's `parse_time_of_day` — see the comment on
    # `parse_booking_date` above for why this is duplicated rather than
    # shared.
    def parse_time_of_day(value)
      return nil unless value.is_a?(String)

      match = DoctorRoutes::TIME_OF_DAY.match(value)
      return nil unless match

      (match[1].to_i * 60) + match[2].to_i
    end

    # The current minute-of-day (0-1439), for comparing against a parsed
    # "HH:MM" slot when deciding whether a same-day alternate slot is still
    # ahead of the clock. Uses `Time.now` (wall clock), not `Date.today`.
    # Mirrors appointments.rb's `current_minute_of_day`.
    def current_minute_of_day
      now = Time.now
      (now.hour * 60) + now.min
    end

    # `department:` mirrors Task 1's `appointment_json(appointment,
    # department: nil)` optional-keyword pattern, so callers that already
    # looked departments up in bulk (the queue) can pass theirs in, while a
    # single-row caller (the detail endpoint) can leave it to look its own
    # up. `detailed:` adds the patient's email/phone — needed on the
    # single-request detail endpoint's patient card, but not on the queue
    # table, which doesn't show them.
    def request_json(appointment, department: nil, detailed: false)
      patient = appointment.patient
      doctor = appointment.doctor
      department ||= Department[appointment.department_id]

      patient_json = { id: patient.id, first_name: patient.first_name, last_name: patient.last_name }
      if detailed
        patient_json[:email] = patient.email
        patient_json[:phone] = patient.phone
      end

      {
        id: appointment.id,
        ref: ref_for(appointment),
        patient: patient_json,
        doctor: { id: doctor.id, first_name: doctor.first_name, last_name: doctor.last_name },
        department: { id: department.id, name: department.name },
        date: appointment.date.iso8601,
        time: appointment.time,
        duration_minutes: appointment.duration_minutes,
        visit_type: appointment.visit_type,
        reason: appointment.reason,
        status: appointment.status,
        submitted_at: appointment.submitted_at.iso8601,
        decided_at: appointment.decided_at&.iso8601,
        decline_reason_code: appointment.decline_reason_code,
        decline_message: appointment.decline_message,
        internal_note: appointment.internal_note
      }
    end

    # Counts/a max over the *unfiltered* `Appointment` table, per this
    # plan's Global Constraints — these never need eager-loading, since
    # none of them load full rows.
    def queue_stats
      today = Date.today
      today_range = today.to_time...(today + 1).to_time

      {
        pending: Appointment.where(status: 'pending').count,
        approved_today: Appointment.where(status: 'approved').where(decided_at: today_range).count,
        declined_today: Appointment.where(status: 'declined').where(decided_at: today_range).count,
        oldest_waiting_at: Appointment.where(status: 'pending').min(:submitted_at)&.iso8601
      }
    end

    # Other appointments belonging to the same patient, excluding the
    # request currently under review — so a patient's own in-progress
    # request never inflates its own stats.
    def patient_stats_for(patient_id, excluding_appointment_id)
      others = Appointment.where(patient_id: patient_id).exclude(id: excluding_appointment_id)
      completed = others.where(status: 'completed')
      {
        previous_visits_count: completed.count,
        last_visit_date: completed.max(:date)&.iso8601,
        no_show_count: others.where(status: 'no_show').count,
        other_pending_count: others.where(status: 'pending').count
      }
    end

    # An empty/blank `doctor_id` means "no filter", same lenient treatment
    # as `GET /doctors`' `department_id` param.
    def filter_by_doctor(dataset, raw_doctor_id)
      return dataset if raw_doctor_id.nil? || raw_doctor_id == ''

      dataset.where(doctor_id: raw_doctor_id)
    end

    # Case-insensitive substring match against the patient's or doctor's
    # first/last name. This file's own small duplicate of
    # `AppointmentRoutes#filter_by_search`'s `Sequel.ilike` approach, per
    # the established duplication-over-sharing convention between these
    # route files — this one matches patient OR doctor name, where that one
    # matches doctor/department, so the two aren't actually the same
    # method. An empty/blank `search` applies no filter.
    def filter_by_search(dataset, raw_search)
      term = raw_search.to_s.strip
      return dataset if term.empty?

      pattern = "%#{term}%"
      matching_user_ids = User.where(Sequel.|(Sequel.ilike(:first_name, pattern), Sequel.ilike(:last_name, pattern)))
                               .select_map(:id)

      dataset.where(Sequel.|({ patient_id: matching_user_ids }, { doctor_id: matching_user_ids }))
    end
  end
end
