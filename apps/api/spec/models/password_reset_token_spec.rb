require_relative '../spec_helper'

RSpec.describe PasswordResetToken do
  it 'knows if it is expired or used' do
    user = User.create(role: 'patient', username: 'u2', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    token = PasswordResetToken.create(user: user, token: 't', expires_at: Time.now - 1, used_at: Time.now)
    expect(token.expired?).to be true
    expect(token.used?).to be true
  end
end
