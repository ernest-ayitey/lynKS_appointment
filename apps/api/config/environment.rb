require 'dotenv'
Dotenv.load

require 'sequel'
require 'sequel/extensions/migration'
require_relative 'env_validation'

# Before anything else — a process that can't issue a usable token should
# not come up at all, let alone open a database connection.
EnvValidation.validate!

database_url = if ENV['RACK_ENV'] == 'test'
                 ENV.fetch('DATABASE_TEST_URL')
               else
                 ENV.fetch('DATABASE_URL')
               end

DB = Sequel.connect(database_url)

%w[models services support].each do |dir|
  Dir[File.join(__dir__, '..', 'app', dir, '*.rb')].sort.each { |f| require f }
end
