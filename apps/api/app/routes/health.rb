require 'sinatra/base'
require 'sinatra/json'

class HealthRoutes < Sinatra::Base
  helpers Sinatra::JSON

  get('/health') { json(status: 'ok') }
end
