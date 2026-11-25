require_relative 'api_base'

# Routes mounted at '/api/v1' for departments, doctors, and their
# availability. Error responses all go through ApiRoutes#halt_json_error so
# the whole file shares one envelope; see ApiRoutes for its shape. Every
# route here needs at least a valid session — role restrictions, where
# needed, come per-route in later tasks (3, 4, 5, 6) that extend this file.
class DoctorRoutes < ApiRoutes
  helpers AuthHelpers

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

  # doctor_count is 0 until Task 3 adds the `doctor_profiles` table and
  # Department#doctor_profiles_dataset association; swap the hardcoded 0 for
  # `d.doctor_profiles_dataset.count` then — a one-line change, not a
  # redesign.
  get '/departments' do
    json(Department.all.map { |d| { id: d.id, name: d.name, doctor_count: 0 } })
  end
end
