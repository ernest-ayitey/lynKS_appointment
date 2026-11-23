require 'dotenv'
Dotenv.load

require 'sequel'
require 'sequel/extensions/migration'

database_url = if ENV['RACK_ENV'] == 'test'
                 ENV.fetch('DATABASE_TEST_URL')
               else
                 ENV.fetch('DATABASE_URL')
               end

DB = Sequel.connect(database_url)

%w[models services support].each do |dir|
  Dir[File.join(__dir__, '..', 'app', dir, '*.rb')].sort.each { |f| require f }
end
