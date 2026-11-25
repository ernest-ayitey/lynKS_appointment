require_relative '../spec_helper'

RSpec.describe 'GET /api/v1/health' do
  it 'returns ok' do
    get '/api/v1/health'
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq('status' => 'ok')
  end
end
