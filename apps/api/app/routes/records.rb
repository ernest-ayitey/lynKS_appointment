require 'json'
require 'date'
require_relative 'api_base'

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

  # Path-scoped rather than a blanket `before`, for the same Rack::Cascade
  # reason explained in doctors.rb's header comment: a request for a path
  # this file doesn't define must still be able to fall through to the next
  # mounted app's 404 rather than being intercepted here with a 401/403.
  before('/records/queue') { authenticate!; require_role!('records') }

  # Sinatra's `before 'path'` only matches that exact path string, never as a
  # prefix, so this has to be listed separately from the filter above — same
  # established house style as doctors.rb/appointments.rb.
  before('/records/requests/:id') { authenticate!; require_role!('records') }

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

  helpers do
    def ref_for(appointment)
      format('REQ-%05d', appointment.id)
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
