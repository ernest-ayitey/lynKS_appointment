ENV['RACK_ENV'] = 'test'

require_relative '../config/environment'
require_relative '../app/api'
require 'rack/test'

module RequestSpecHelpers
  def app
    App
  end
end

RSpec.configure do |config|
  config.define_derived_metadata(file_path: %r{spec/requests}) do |metadata|
    metadata[:type] = :request
  end

  config.include Rack::Test::Methods, type: :request
  config.include RequestSpecHelpers, type: :request
end
