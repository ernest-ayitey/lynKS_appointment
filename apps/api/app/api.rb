require 'sinatra/base'
require 'rack/cors'
require 'rack/urlmap'
require_relative 'routes/health'

class App < Sinatra::Base
  use Rack::Cors do
    allow do
      origins ENV['FRONTEND_URL']
      resource '*', headers: :any, methods: %i[get post put patch delete options], credentials: true
    end
  end

  ROUTES = Rack::URLMap.new('/api/v1' => HealthRoutes)

  def call(env)
    ROUTES.call(env)
  end
end
