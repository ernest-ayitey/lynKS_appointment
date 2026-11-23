require_relative '../spec_helper'

RSpec.describe RefreshToken do
  it 'hashes a token deterministically' do
    expect(RefreshToken.hash_token('abc')).to eq(RefreshToken.hash_token('abc'))
    expect(RefreshToken.hash_token('abc')).not_to eq('abc')
  end

  it 'knows if it is revoked or expired' do
    token = RefreshToken.create(user: User.create(role: 'patient', username: 'u1',
      email: 'e@x.com', first_name: 'A', last_name: 'B', password: 'Sup3r!word'),
      token_hash: 'h', expires_at: Time.now - 1)
    expect(token.expired?).to be true
    expect(token.revoked?).to be false
  end
end
