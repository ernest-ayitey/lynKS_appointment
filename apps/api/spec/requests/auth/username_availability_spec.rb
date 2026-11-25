require_relative '../../spec_helper'

RSpec.describe 'GET /api/v1/auth/username-availability' do
  it 'is available when unused' do
    get '/api/v1/auth/username-availability?username=freshuser'
    expect(JSON.parse(last_response.body)).to eq('available' => true)
  end

  it 'is unavailable case-insensitively when taken' do
    User.create(role: 'patient', username: 'Ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    get '/api/v1/auth/username-availability?username=ernesta'
    expect(JSON.parse(last_response.body)).to eq('available' => false)
  end

  it 'rejects an invalid format' do
    get '/api/v1/auth/username-availability?username=a'
    expect(last_response.status).to eq(422)
  end
end
