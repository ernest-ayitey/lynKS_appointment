require 'sinatra/base'
require 'rack/cors'
require 'rack/urlmap'
require 'rack/cascade'
require_relative 'routes/health'
require_relative 'routes/auth'
require_relative 'routes/doctors'
require_relative 'routes/appointments'
require_relative 'routes/records'

# Each mounted route class defines its own routes relative to '/api/v1'
# (e.g. HealthRoutes#'/health' handles 'GET /api/v1/health'). Add new route
# classes here as they're created — no other change is needed to mount them.
MOUNTED_ROUTES = [
  HealthRoutes,
  AuthRoutes,
  DoctorRoutes,
  AppointmentRoutes,
  RecordsRoutes
].freeze

class App < Sinatra::Base
  use Rack::Cors do
    allow do
      origins ENV['FRONTEND_URL']
      resource '*', headers: :any, methods: %i[get post put patch delete options], credentials: true
    end
  end

  # Built once at load time, not per request. Sinatra's own dispatch (routes,
  # filters, settings, error handlers defined directly on App) still runs
  # first; only requests that match none of App's own routes fall through
  # here, so App keeps full access to native Sinatra features.
  API = Rack::URLMap.new('/api/v1' => Rack::Cascade.new(MOUNTED_ROUTES))

  not_found do
    halt API.call(request.env)
  end
end
