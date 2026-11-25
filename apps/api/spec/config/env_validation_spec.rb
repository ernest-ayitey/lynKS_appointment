require 'open3'
require 'tmpdir'
require_relative '../spec_helper'

RSpec.describe EnvValidation do
  def valid_env
    {
      'JWT_SECRET' => 'boot-spec-secret',
      'JWT_ACCESS_TTL_SECONDS' => '900',
      'REFRESH_TOKEN_TTL_DAYS' => '7',
      'REFRESH_TOKEN_TTL_DAYS_REMEMBER' => '30'
    }
  end

  it 'accepts a complete configuration' do
    expect(EnvValidation.validate!(valid_env)).to be true
  end

  described_class::REQUIRED_KEYS.union(described_class::REQUIRED_POSITIVE_INTEGER_KEYS).each do |key|
    it "rejects a missing #{key}" do
      expect { EnvValidation.validate!(valid_env.reject { |k, _| k == key }) }
        .to raise_error(EnvValidation::MissingConfiguration, /#{key} is required but is not set/)
    end

    it "rejects a blank #{key}" do
      expect { EnvValidation.validate!(valid_env.merge(key => '   ')) }
        .to raise_error(EnvValidation::MissingConfiguration, /#{key} is required but is blank/)
    end
  end

  described_class::REQUIRED_POSITIVE_INTEGER_KEYS.each do |key|
    ['0', '-1', 'abc', '15m', '1.5'].each do |bad|
      it "rejects #{key}=#{bad.inspect}" do
        expect { EnvValidation.validate!(valid_env.merge(key => bad)) }
          .to raise_error(EnvValidation::MissingConfiguration, /#{key} must be a positive integer/)
      end
    end
  end

  it 'reports every problem at once rather than only the first' do
    expect { EnvValidation.validate!('REFRESH_TOKEN_TTL_DAYS' => '7') }
      .to raise_error(EnvValidation::MissingConfiguration) { |error|
        expect(error.message).to include('JWT_SECRET', 'JWT_ACCESS_TTL_SECONDS', 'REFRESH_TOKEN_TTL_DAYS_REMEMBER')
      }
  end
end

RSpec.describe 'booting config/environment.rb' do
  API_ROOT = File.expand_path('../..', __dir__)

  # Runs config/environment.rb in a child process whose only .env is the one
  # written here, so a key left out of `env` really is absent at boot
  # (Dotenv never overrides an already-set variable, so the parent process's
  # own configuration has to be cleared explicitly).
  def boot(env)
    cleared = %w[
      DATABASE_URL DATABASE_TEST_URL JWT_SECRET JWT_ACCESS_TTL_SECONDS
      REFRESH_TOKEN_TTL_DAYS REFRESH_TOKEN_TTL_DAYS_REMEMBER
      FRONTEND_URL MAIL_DELIVERY_METHOD RACK_ENV
    ].to_h { |key| [key, nil] }

    Dir.mktmpdir do |dir|
      File.write(File.join(dir, '.env'), env.map { |k, v| "#{k}=#{v}" }.join("\n"))
      Open3.capture2e(
        cleared,
        RbConfig.ruby, '-e', "require #{File.join(API_ROOT, 'config', 'environment').inspect}",
        chdir: dir
      )
    end
  end

  def boot_env(overrides = {})
    {
      'DATABASE_URL' => ENV.fetch('DATABASE_TEST_URL'),
      'JWT_SECRET' => 'boot-spec-secret',
      'JWT_ACCESS_TTL_SECONDS' => '900',
      'REFRESH_TOKEN_TTL_DAYS' => '7',
      'REFRESH_TOKEN_TTL_DAYS_REMEMBER' => '30'
    }.merge(overrides)
  end

  it 'boots with a complete configuration' do
    output, result = boot(boot_env)
    expect(result).to be_success, output
  end

  it 'aborts loudly when JWT_SECRET is missing' do
    output, result = boot(boot_env.reject { |k, _| k == 'JWT_SECRET' })
    expect(result).not_to be_success
    expect(output).to include('JWT_SECRET is required but is not set')
  end

  it 'aborts loudly when a TTL does not parse to a positive integer' do
    output, result = boot(boot_env('JWT_ACCESS_TTL_SECONDS' => 'fifteen-minutes'))
    expect(result).not_to be_success
    expect(output).to include('JWT_ACCESS_TTL_SECONDS must be a positive integer')
  end
end
