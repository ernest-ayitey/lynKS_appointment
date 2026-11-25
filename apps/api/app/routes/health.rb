require_relative 'api_base'

class HealthRoutes < ApiRoutes
  get('/health') { json(status: 'ok') }
end
