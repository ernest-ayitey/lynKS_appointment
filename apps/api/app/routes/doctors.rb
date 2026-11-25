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
  before('/doctors') { authenticate! }

  get '/departments' do
    json(Department.all.map { |d| { id: d.id, name: d.name, doctor_count: d.doctor_profiles_dataset.count } })
  end

  # Only doctors whose account is active are patient-facing: account
  # lockout after 5 failed logins is already live in the merged backend, so
  # a locked (or otherwise blocked) doctor must not appear here. The same
  # filter belongs on every other patient-facing doctor listing too.
  get '/doctors' do
    active_doctor_ids = User.where(role: 'doctor', status: 'active').select_map(:id)
    profiles = DoctorProfile.eager(:department, :user).where(user_id: active_doctor_ids)
    profiles = profiles.where(department_id: params['department_id']) if params['department_id']

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
end
